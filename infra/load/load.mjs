// Load generator for the relay. Opens many sessions from one process; each
// gets a DHCP lease and sends a DNS query every few seconds. A subset also
// runs a minimal TCP client that downloads over plain HTTP in a loop, so the
// relay's TCP termination, pacing and rate limiting are exercised too.
// Node 22+ (built-in WebSocket); no dependencies.
//
//   RELAY_URL=wss://relay-staging.relaynet.network RELAY_TOKEN=rr_... \
//   SESSIONS=200 DOWNLOADERS=50 RAMP_PER_SEC=10 HOLD_S=120 node load.mjs
//
// One account and one client IP open every session, so the target needs its
// per-account and per-IP caps raised first (see "Load test" in the operator runbooks, relaynet-private).
// Prints a status line every 10 s and a summary at the end.

const RELAY_URL = process.env.RELAY_URL || "wss://relay-staging.relaynet.network/";
const TOKEN = process.env.RELAY_TOKEN;
const SESSIONS = Number(process.env.SESSIONS || 50);
const DOWNLOADERS = Number(process.env.DOWNLOADERS || 0);
const RAMP_PER_SEC = Number(process.env.RAMP_PER_SEC || 10);
const HOLD_S = Number(process.env.HOLD_S || 60);
const DNS_INTERVAL_MS = Number(process.env.DNS_INTERVAL_MS || 5000);
const DOWNLOAD_HOST = process.env.DOWNLOAD_HOST || "speed.cloudflare.com";
const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || "/__down?bytes=2000000";
// Delays every TCP segment the client sends, adding this much to the round
// trip between the relay and the "VM" (simulates a distant user).
const ACK_DELAY_MS = Number(process.env.ACK_DELAY_MS || 0);

if (!TOKEN) {
  console.error("load: RELAY_TOKEN is required");
  process.exit(1);
}

// --- packet helpers ---------------------------------------------------------

const BROADCAST = Buffer.alloc(6, 0xff);
const ipBytes = (s) => Buffer.from(s.split(".").map(Number));

function checksum(buf, initial = 0) {
  let sum = initial;
  for (let i = 0; i + 1 < buf.length; i += 2) sum += buf.readUInt16BE(i);
  if (buf.length % 2) sum += buf[buf.length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function ipv4Frame({ srcMac, dstMac, srcIP, dstIP, proto, body }) {
  const iph = Buffer.alloc(20);
  iph[0] = 0x45;
  iph.writeUInt16BE(20 + body.length, 2);
  iph.writeUInt16BE(Math.floor(Math.random() * 0xffff), 4);
  iph[8] = 64;
  iph[9] = proto;
  ipBytes(srcIP).copy(iph, 12);
  ipBytes(dstIP).copy(iph, 16);
  iph.writeUInt16BE(checksum(iph), 10);
  const eth = Buffer.alloc(14);
  dstMac.copy(eth, 0);
  srcMac.copy(eth, 6);
  eth.writeUInt16BE(0x0800, 12);
  return Buffer.concat([eth, iph, body]);
}

function udpBody(srcPort, dstPort, payload) {
  const udp = Buffer.alloc(8 + payload.length);
  udp.writeUInt16BE(srcPort, 0);
  udp.writeUInt16BE(dstPort, 2);
  udp.writeUInt16BE(udp.length, 4);
  payload.copy(udp, 8);
  return udp;
}

function tcpBody({ srcIP, dstIP, srcPort, dstPort, seq, ack, flags, payload = Buffer.alloc(0) }) {
  // SYNs carry MSS 1460; without it the relay falls back to 536-byte segments.
  const options = flags & SYN ? Buffer.from([2, 4, 0x05, 0xb4]) : Buffer.alloc(0);
  const tcp = Buffer.alloc(20 + options.length + payload.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = ((20 + options.length) / 4) << 4;
  tcp[13] = flags;
  tcp.writeUInt16BE(65535, 14);
  options.copy(tcp, 20);
  payload.copy(tcp, 20 + options.length);
  const pseudo = Buffer.concat([ipBytes(srcIP), ipBytes(dstIP), Buffer.from([0, 6, tcp.length >> 8, tcp.length & 0xff])]);
  let sum = 0;
  for (let i = 0; i < pseudo.length; i += 2) sum += pseudo.readUInt16BE(i);
  tcp.writeUInt16BE(checksum(tcp, sum), 16);
  return tcp;
}

const FIN = 0x01, SYN = 0x02, RST = 0x04, PSH = 0x08, ACK = 0x10;

function dhcpDiscover(mac, xid) {
  const d = Buffer.alloc(244);
  d[0] = 1; d[1] = 1; d[2] = 6;
  d.writeUInt32BE(xid, 4);
  mac.copy(d, 28);
  d.writeUInt32BE(0x63825363, 236);
  d[240] = 53; d[241] = 1; d[242] = 1; d[243] = 255;
  return d;
}

function dnsQuery(id, name) {
  const labels = name.split(".").flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, 1, 0, 1])]);
}

// First A record in a DNS response, or null.
function firstA(msg) {
  let off = 12;
  for (let q = msg.readUInt16BE(4); q > 0; q -= 1) {
    while (msg[off] !== 0) off += msg[off] >= 0xc0 ? 1 : msg[off] + 1;
    off += 5;
  }
  for (let a = msg.readUInt16BE(6); a > 0 && off + 12 <= msg.length; a -= 1) {
    if (msg[off] >= 0xc0) off += 2; else { while (msg[off] !== 0) off += msg[off] + 1; off += 1; }
    const type = msg.readUInt16BE(off);
    const len = msg.readUInt16BE(off + 8);
    if (type === 1 && len === 4) return [...msg.subarray(off + 10, off + 14)].join(".");
    off += 10 + len;
  }
  return null;
}

function dhcpOption(payload, code) {
  for (let i = 240; i < payload.length;) {
    const c = payload[i];
    if (c === 255) break;
    if (c === 0) { i += 1; continue; }
    if (c === code) return payload.subarray(i + 2, i + 2 + payload[i + 1]);
    i += 2 + payload[i + 1];
  }
  return null;
}

// --- stats -----------------------------------------------------------------

const stats = {
  opened: 0, leased: 0, open: 0, connectFailed: 0, closedEarly: 0,
  dnsSent: 0, dnsOk: 0, dnsLatency: [],
  downloadsOk: 0, downloadsFailed: 0, bytesDown: 0, outOfOrder: 0, downloadMs: [],
  closeCodes: new Map(),
};
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// --- session ---------------------------------------------------------------

let stopping = false;
const sessions = [];

function startSession(index, downloader) {
  const mac = Buffer.from([0x02, 0x6c, 0x6f, (index >> 8) & 0xff, index & 0xff, 0x01]);
  const s = { ws: null, lease: null, pendingDns: new Map(), tcp: null, timers: [] };
  sessions.push(s);
  const ws = new WebSocket(RELAY_URL, ["relay.v1", `relay.token.${TOKEN}`]);
  ws.binaryType = "arraybuffer";
  s.ws = ws;
  let opened = false;

  const send = (frame) => { if (ws.readyState === 1) ws.send(frame); };
  const sendUdp = (dstIP, srcPort, dstPort, payload) => send(ipv4Frame({
    srcMac: mac, dstMac: s.lease.gatewayMac, srcIP: s.lease.ip, dstIP, proto: 17, body: udpBody(srcPort, dstPort, payload),
  }));
  const sendTcpNow = (c, flags, payload) => send(ipv4Frame({
    srcMac: mac, dstMac: s.lease.gatewayMac, srcIP: s.lease.ip, dstIP: c.dstIP, proto: 6,
    body: tcpBody({ srcIP: s.lease.ip, dstIP: c.dstIP, srcPort: c.srcPort, dstPort: 80, seq: c.seq, ack: c.ack, flags, payload }),
  }));
  const sendTcp = (c, flags, payload) => {
    if (!ACK_DELAY_MS) { sendTcpNow(c, flags, payload); return; }
    const snapshot = { ...c };
    setTimeout(() => sendTcpNow(snapshot, flags, payload), ACK_DELAY_MS);
  };

  let dnsId = (index * 7919) & 0xffff;
  function resolve(name) {
    return new Promise((res) => {
      dnsId = (dnsId + 1) & 0xffff;
      const id = dnsId;
      const at = Date.now();
      stats.dnsSent += 1;
      const t = setTimeout(() => { s.pendingDns.delete(id); res(null); }, 5000);
      s.pendingDns.set(id, (msg) => {
        clearTimeout(t);
        stats.dnsOk += 1;
        stats.dnsLatency.push(Date.now() - at);
        res(msg);
      });
      sendUdp(s.lease.dns, 40000 + (index % 20000), 53, dnsQuery(id, name));
    });
  }

  async function downloadLoop() {
    let srcPort = 10000 + ((index * 37) % 40000);
    while (!stopping && ws.readyState === 1) {
      const msg = await resolve(DOWNLOAD_HOST);
      const dstIP = msg && firstA(msg);
      if (!dstIP) { stats.downloadsFailed += 1; await sleep(1000); continue; }
      srcPort = srcPort >= 60000 ? 10000 : srcPort + 1;
      const downloadStarted = Date.now();
      const ok = await new Promise((done) => {
        const c = { dstIP, srcPort, seq: Math.floor(Math.random() * 2 ** 31), ack: 0, state: "syn", got: 0, done };
        c.timer = setTimeout(() => { s.tcp = null; done(false); }, 60000);
        s.tcp = c;
        sendTcp(c, SYN);
        c.seq += 1;
      });
      if (ok) { stats.downloadsOk += 1; stats.downloadMs.push(Date.now() - downloadStarted); } else stats.downloadsFailed += 1;
    }
  }

  function onTcp(frame, ihl) {
    const c = s.tcp;
    const t = 14 + ihl;
    if (!c || frame.readUInt16BE(t + 2) !== c.srcPort) return;
    const flags = frame[t + 13];
    const seq = frame.readUInt32BE(t + 4);
    const payload = frame.subarray(t + (frame[t + 12] >> 4) * 4, 14 + frame.readUInt16BE(16));
    const finish = (ok) => { clearTimeout(c.timer); s.tcp = null; c.done(ok); };
    if (flags & RST) { finish(c.state === "fin"); return; }
    if (c.state === "syn" && (flags & (SYN | ACK)) === (SYN | ACK)) {
      c.ack = (seq + 1) >>> 0;
      c.state = "data";
      sendTcp(c, ACK);
      const req = Buffer.from(`GET ${DOWNLOAD_PATH} HTTP/1.1\r\nHost: ${DOWNLOAD_HOST}\r\nUser-Agent: relaynet-load\r\nConnection: close\r\n\r\n`);
      sendTcp(c, PSH | ACK, req);
      c.seq = (c.seq + req.length) >>> 0;
      return;
    }
    if (c.state === "syn") return;
    if (payload.length && seq === c.ack) {
      c.ack = (c.ack + payload.length) >>> 0;
      c.got += payload.length;
      stats.bytesDown += payload.length;
    } else if (payload.length) {
      stats.outOfOrder += 1;
    }
    if ((flags & FIN) && seq + payload.length === c.ack) {
      c.ack = (c.ack + 1) >>> 0;
      c.state = "fin";
      sendTcp(c, FIN | ACK);
      c.seq = (c.seq + 1) >>> 0;
      finish(c.got > 0);
      return;
    }
    if (payload.length || (flags & FIN)) sendTcp(c, ACK);
  }

  ws.onopen = () => {
    opened = true;
    stats.opened += 1;
    stats.open += 1;
    send(ipv4Frame({
      srcMac: mac, dstMac: BROADCAST, srcIP: "0.0.0.0", dstIP: "255.255.255.255", proto: 17,
      body: udpBody(68, 67, dhcpDiscover(mac, 0x10000000 + index)),
    }));
  };
  ws.onmessage = (event) => {
    const frame = Buffer.from(event.data);
    if (frame.length < 34 || frame.readUInt16BE(12) !== 0x0800) return;
    const ihl = (frame[14] & 0x0f) * 4;
    const proto = frame[23];
    if (proto === 6) { onTcp(frame, ihl); return; }
    if (proto !== 17) return;
    const u = 14 + ihl;
    const srcPort = frame.readUInt16BE(u);
    const payload = frame.subarray(u + 8, u + frame.readUInt16BE(u + 4));
    if (!s.lease && srcPort === 67 && payload.length >= 240) {
      const dns = dhcpOption(payload, 6);
      s.lease = {
        ip: [...payload.subarray(16, 20)].join("."),
        gatewayMac: Buffer.from(frame.subarray(6, 12)),
        dns: dns ? [...dns.subarray(0, 4)].join(".") : "8.8.8.8",
      };
      stats.leased += 1;
      s.timers.push(setInterval(() => resolve("example.com"), DNS_INTERVAL_MS));
      if (downloader) downloadLoop();
    } else if (srcPort === 53 && payload.length >= 12) {
      const handler = s.pendingDns.get(payload.readUInt16BE(0));
      if (handler) { s.pendingDns.delete(payload.readUInt16BE(0)); handler(payload); }
    }
  };
  ws.onerror = () => {};
  ws.onclose = (event) => {
    s.timers.forEach(clearInterval);
    if (!opened) { stats.connectFailed += 1; return; }
    stats.open -= 1;
    if (!stopping) {
      stats.closedEarly += 1;
      const key = `${event.code} ${event.reason}`.trim();
      stats.closeCodes.set(key, (stats.closeCodes.get(key) || 0) + 1);
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
let lastBytes = 0;

function report(label = "") {
  const mbps = ((stats.bytesDown - lastBytes) / 10 / 1024 / 1024).toFixed(1);
  lastBytes = stats.bytesDown;
  console.log(
    `${label}t=${Math.round((Date.now() - started) / 1000)}s open=${stats.open} leased=${stats.leased} ` +
    `connectFailed=${stats.connectFailed} closedEarly=${stats.closedEarly} ` +
    `dns=${stats.dnsOk}/${stats.dnsSent} p50=${pct(stats.dnsLatency, 50)}ms p95=${pct(stats.dnsLatency, 95)}ms ` +
    `downloads=${stats.downloadsOk} ok/${stats.downloadsFailed} failed ${mbps} MiB/s ooo=${stats.outOfOrder}`,
  );
  stats.dnsLatency = stats.dnsLatency.slice(-5000);
}

const reporter = setInterval(report, 10000);
for (let i = 0; i < SESSIONS; i += 1) {
  startSession(i, i < DOWNLOADERS);
  await sleep(1000 / RAMP_PER_SEC);
}
console.log(`load: ramped ${SESSIONS} sessions in ${Math.round((Date.now() - started) / 1000)} s, holding ${HOLD_S} s`);
await sleep(HOLD_S * 1000);
stopping = true;
clearInterval(reporter);
report("final ");
if (stats.closeCodes.size) console.log("close codes:", Object.fromEntries(stats.closeCodes));
console.log(`downloaded ${(stats.bytesDown / 1024 / 1024).toFixed(0)} MiB`);
if (stats.downloadMs.length) {
  console.log(`download time p50=${pct(stats.downloadMs, 50)}ms p95=${pct(stats.downloadMs, 95)}ms (${stats.downloadMs.length} downloads)`);
}
for (const s of sessions) { s.timers.forEach(clearInterval); try { s.ws.close(1000, "load done"); } catch {} }
await sleep(500);
process.exit(0);
