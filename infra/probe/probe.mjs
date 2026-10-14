// End-to-end probe for the hosted relay: authenticates with an API token,
// gets a DHCP lease, then resolves a name through the relay's UDP egress.
// Exercises auth, the WebSocket path, the virtual network and real egress.
// Node 22+ (built-in WebSocket); no dependencies.
//
//   RELAY_URL=wss://relay.relaynet.network RELAY_TOKEN=rr_... node probe.mjs
//
// Exits 0 on success, 1 with a reason on failure.

const RELAY_URL = process.env.RELAY_URL || "wss://relay.relaynet.network/";
const TOKEN = process.env.RELAY_TOKEN;
const QUERY_NAME = process.env.PROBE_NAME || "example.com";
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 20000);

if (!TOKEN) {
  console.error("probe: RELAY_TOKEN is required");
  process.exit(1);
}

const MAC = Buffer.from([0x02, 0x70, 0x72, 0x6f, 0x62, 0x65]); // 02:70:72:6f:62:65 ("probe")
const BROADCAST = Buffer.alloc(6, 0xff);

function ip(str) {
  return Buffer.from(str.split(".").map(Number));
}

function checksum(buf) {
  let sum = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) sum += buf.readUInt16BE(i);
  if (buf.length % 2) sum += buf[buf.length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

// Ethernet + IPv4 + UDP (UDP checksum 0, which IPv4 allows).
function udpFrame({ dstMac, srcIP, dstIP, srcPort, dstPort, payload }) {
  const udp = Buffer.alloc(8 + payload.length);
  udp.writeUInt16BE(srcPort, 0);
  udp.writeUInt16BE(dstPort, 2);
  udp.writeUInt16BE(udp.length, 4);
  payload.copy(udp, 8);
  const iph = Buffer.alloc(20);
  iph[0] = 0x45;
  iph.writeUInt16BE(20 + udp.length, 2);
  iph.writeUInt16BE(Math.floor(Math.random() * 0xffff), 4);
  iph[8] = 64;
  iph[9] = 17;
  ip(srcIP).copy(iph, 12);
  ip(dstIP).copy(iph, 16);
  iph.writeUInt16BE(checksum(iph), 10);
  const eth = Buffer.alloc(14);
  dstMac.copy(eth, 0);
  MAC.copy(eth, 6);
  eth.writeUInt16BE(0x0800, 12);
  return Buffer.concat([eth, iph, udp]);
}

function dhcpDiscover() {
  const d = Buffer.alloc(244);
  d[0] = 1; // BOOTREQUEST
  d[1] = 1;
  d[2] = 6;
  d.writeUInt32BE(0x70726f62, 4); // xid
  MAC.copy(d, 28);
  d.writeUInt32BE(0x63825363, 236); // magic cookie
  d[240] = 53; d[241] = 1; d[242] = 1; // DHCPDISCOVER
  d[243] = 255;
  return udpFrame({ dstMac: BROADCAST, srcIP: "0.0.0.0", dstIP: "255.255.255.255", srcPort: 68, dstPort: 67, payload: d });
}

function dnsQuery(id, name) {
  const labels = name.split(".").flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // recursion desired
  header.writeUInt16BE(1, 4);
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, 1, 0, 1])]); // A, IN
}

// Returns { srcMac, srcIP, srcPort, dstPort, payload } for IPv4/UDP frames.
function parseUdp(frame) {
  if (frame.length < 42 || frame.readUInt16BE(12) !== 0x0800 || frame[23] !== 17) return null;
  const ihl = (frame[14] & 0x0f) * 4;
  const u = 14 + ihl;
  return {
    srcMac: frame.subarray(6, 12),
    srcIP: [...frame.subarray(26, 30)].join("."),
    srcPort: frame.readUInt16BE(u),
    dstPort: frame.readUInt16BE(u + 2),
    payload: frame.subarray(u + 8, u + frame.readUInt16BE(u + 4)),
  };
}

function dhcpOption(payload, code) {
  for (let i = 240; i < payload.length;) {
    const c = payload[i];
    if (c === 255) break;
    if (c === 0) { i += 1; continue; }
    const len = payload[i + 1];
    if (c === code) return payload.subarray(i + 2, i + 2 + len);
    i += 2 + len;
  }
  return null;
}

const started = Date.now();
const fail = (reason) => {
  console.error(`probe: FAIL after ${Date.now() - started} ms: ${reason}`);
  process.exit(1);
};
const timer = setTimeout(() => fail(`timed out (stage: ${stage})`), TIMEOUT_MS);

let stage = "connect";
let lease = null;
const dnsId = Math.floor(Math.random() * 0xffff);

const ws = new WebSocket(RELAY_URL, ["relay.v1", `relay.token.${TOKEN}`]);
ws.binaryType = "arraybuffer";
ws.onerror = () => fail(`websocket error (stage: ${stage})`);
ws.onclose = (event) => {
  if (stage !== "done") fail(`websocket closed ${event.code} ${event.reason || ""} (stage: ${stage})`);
};
ws.onopen = () => {
  if (ws.protocol !== "relay.v1") fail(`unexpected subprotocol "${ws.protocol}"`);
  stage = "dhcp";
  ws.send(dhcpDiscover());
};
ws.onmessage = (event) => {
  const u = parseUdp(Buffer.from(event.data));
  if (!u) return;
  if (stage === "dhcp" && u.srcPort === 67 && u.dstPort === 68 && u.payload.length >= 240) {
    const yiaddr = [...u.payload.subarray(16, 20)].join(".");
    const dns = dhcpOption(u.payload, 6);
    lease = { ip: yiaddr, gatewayMac: Buffer.from(u.srcMac), dns: dns ? [...dns.subarray(0, 4)].join(".") : "8.8.8.8" };
    stage = "dns";
    ws.send(udpFrame({
      dstMac: lease.gatewayMac, srcIP: lease.ip, dstIP: lease.dns, srcPort: 40053, dstPort: 53, payload: dnsQuery(dnsId, QUERY_NAME),
    }));
  } else if (stage === "dns" && u.srcPort === 53 && u.dstPort === 40053 && u.payload.readUInt16BE(0) === dnsId) {
    const rcode = u.payload[3] & 0x0f;
    const answers = u.payload.readUInt16BE(6);
    if (rcode !== 0 || answers === 0) fail(`DNS answer rcode=${rcode} answers=${answers}`);
    stage = "done";
    clearTimeout(timer);
    console.log(`probe: OK in ${Date.now() - started} ms (lease ${lease.ip}, ${QUERY_NAME} resolved via ${lease.dns}, ${answers} answers)`);
    ws.close(1000, "probe done");
    setTimeout(() => process.exit(0), 200);
  }
};
