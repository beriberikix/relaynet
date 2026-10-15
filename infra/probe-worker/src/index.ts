// Scheduled end-to-end probe of the hosted relay, run by Cloudflare's cron
// triggers (GitHub's scheduled workflows proved too unreliable for a
// heartbeat). Same checks as infra/probe/probe.mjs: authenticate with the
// "probe" account's API token, get a DHCP lease, resolve a name through the
// relay's UDP egress. Success pings the Better Stack heartbeat; failure
// reports to its /fail endpoint with the reason.

interface Env {
  RELAY_URL: string;
  PROBE_RELAY_TOKEN: string;
  BETTERSTACK_PROBE_HEARTBEAT_URL: string;
}

const TIMEOUT_MS = 20000;
const QUERY_NAME = "example.com";
const MAC = [0x02, 0x70, 0x72, 0x6f, 0x62, 0x66]; // 02:70:72:6f:62:66, unlike the GitHub probe's
const BROADCAST = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const ip = (s: string) => s.split(".").map(Number);

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < b.length; i += 2) sum += (b[i] << 8) | b[i + 1];
  if (b.length % 2) sum += b[b.length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

// Ethernet + IPv4 + UDP (UDP checksum 0, which IPv4 allows).
function udpFrame(dstMac: number[], srcIP: string, dstIP: string, srcPort: number, dstPort: number, payload: Uint8Array): Uint8Array {
  const f = new Uint8Array(14 + 20 + 8 + payload.length);
  const v = new DataView(f.buffer);
  f.set(dstMac, 0);
  f.set(MAC, 6);
  v.setUint16(12, 0x0800);
  f[14] = 0x45;
  v.setUint16(16, 20 + 8 + payload.length);
  v.setUint16(18, Math.floor(Math.random() * 0xffff));
  f[22] = 64;
  f[23] = 17;
  f.set(ip(srcIP), 26);
  f.set(ip(dstIP), 30);
  v.setUint16(24, checksum(f.subarray(14, 34)));
  v.setUint16(34, srcPort);
  v.setUint16(36, dstPort);
  v.setUint16(38, 8 + payload.length);
  f.set(payload, 42);
  return f;
}

function dhcpDiscover(): Uint8Array {
  const d = new Uint8Array(244);
  const v = new DataView(d.buffer);
  d.set([1, 1, 6], 0);
  v.setUint32(4, 0x70726f63);
  d.set(MAC, 28);
  v.setUint32(236, 0x63825363);
  d.set([53, 1, 1, 255], 240);
  return d;
}

function dnsQuery(id: number, name: string): Uint8Array {
  const labels = name.split(".").flatMap((l) => [l.length, ...new TextEncoder().encode(l)]);
  return new Uint8Array([id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, ...labels, 0, 0, 1, 0, 1]);
}

function dhcpOption(p: Uint8Array, code: number): Uint8Array | null {
  for (let i = 240; i < p.length;) {
    if (p[i] === 255) break;
    if (p[i] === 0) { i += 1; continue; }
    if (p[i] === code) return p.subarray(i + 2, i + 2 + p[i + 1]);
    i += 2 + p[i + 1];
  }
  return null;
}

async function probe(env: Env): Promise<string> {
  const started = Date.now();
  const res = await fetch(env.RELAY_URL.replace(/^ws/, "http"), {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `relay.v1, relay.token.${env.PROBE_RELAY_TOKEN}` },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error(`upgrade refused: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  if (res.headers.get("Sec-WebSocket-Protocol") !== "relay.v1") throw new Error("relay did not select relay.v1");
  ws.accept();

  return new Promise<string>((resolve, reject) => {
    let stage = "dhcp";
    let lease: { ip: string; gatewayMac: number[]; dns: string } | null = null;
    const dnsId = Math.floor(Math.random() * 0xffff);
    const finish = (error: Error | null, detail = "") => {
      clearTimeout(timer);
      stage = "done";
      try { ws.close(1000, "probe done"); } catch { /* already closed */ }
      if (error) reject(error); else resolve(detail);
    };
    const timer = setTimeout(() => finish(new Error(`timed out (stage: ${stage})`)), TIMEOUT_MS);

    ws.addEventListener("close", (e) => {
      if (stage !== "done") finish(new Error(`websocket closed ${e.code} ${e.reason} (stage: ${stage})`));
    });
    // Binary messages arrive as Blobs on an outbound WebSocket in Workers.
    // Frames are handled in arrival order.
    let queue = Promise.resolve();
    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") return;
      const data = e.data as ArrayBuffer | Blob;
      queue = queue.then(async () => {
        if (stage === "done") return;
        onFrame(new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data));
      });
    });
    const onFrame = (f: Uint8Array) => {
      if (f.length < 42 || ((f[12] << 8) | f[13]) !== 0x0800 || f[23] !== 17) return;
      const u = 14 + (f[14] & 0x0f) * 4;
      const v = new DataView(f.buffer, f.byteOffset);
      const srcPort = v.getUint16(u);
      const dstPort = v.getUint16(u + 2);
      const payload = f.subarray(u + 8, u + v.getUint16(u + 4));
      if (stage === "dhcp" && srcPort === 67 && dstPort === 68 && payload.length >= 240) {
        const dns = dhcpOption(payload, 6);
        lease = {
          ip: Array.from(payload.subarray(16, 20)).join("."),
          gatewayMac: Array.from(f.subarray(6, 12)),
          dns: dns ? Array.from(dns.subarray(0, 4)).join(".") : "8.8.8.8",
        };
        stage = "dns";
        ws.send(udpFrame(lease.gatewayMac, lease.ip, lease.dns, 40053, 53, dnsQuery(dnsId, QUERY_NAME)));
      } else if (stage === "dns" && lease && srcPort === 53 && dstPort === 40053 && ((payload[0] << 8) | payload[1]) === dnsId) {
        const rcode = payload[3] & 0x0f;
        const answers = (payload[6] << 8) | payload[7];
        if (rcode !== 0 || answers === 0) finish(new Error(`DNS answer rcode=${rcode} answers=${answers}`));
        else finish(null, `OK in ${Date.now() - started} ms (lease ${lease.ip}, ${QUERY_NAME} via ${lease.dns}, ${answers} answers)`);
      }
    };
    ws.send(udpFrame(BROADCAST, "0.0.0.0", "255.255.255.255", 68, 67, dhcpDiscover()));
  });
}

async function run(env: Env): Promise<string> {
  // One retry so a single dropped packet or a deploy restart does not page.
  let result: string;
  try {
    result = await probe(env);
  } catch (first) {
    console.warn(`probe attempt failed: ${(first as Error).message}`);
    await new Promise((r) => setTimeout(r, 15000));
    try {
      result = await probe(env);
    } catch (error) {
      const reason = `probe failed twice: ${(first as Error).message}; ${(error as Error).message}`;
      console.error(reason);
      await fetch(`${env.BETTERSTACK_PROBE_HEARTBEAT_URL}/fail`, { method: "POST", body: reason });
      return reason;
    }
  }
  console.log(`probe: ${result}`);
  await fetch(env.BETTERSTACK_PROBE_HEARTBEAT_URL, { method: "POST", body: result });
  return result;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
};
