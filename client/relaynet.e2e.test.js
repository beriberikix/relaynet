// End to end against a local rootlessRelay: a DHCP lease, a dropped
// socket, a reconnect that keeps the address. Needs a rootlessRelay checkout
// with address holds (RELAY_JS, default ../../rootlessRelay/relay.js).
//
//   RUN_NETWORK_TESTS=1 node --test relaynet.e2e.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRelay } from "./relaynet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY_JS = process.env.RELAY_JS || path.join(HERE, "..", "..", "rootlessRelay", "relay.js");
const SKIP = process.env.RUN_NETWORK_TESTS !== "1" || !existsSync(RELAY_JS);


function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startRelay(holdMs = "60000") {
  const wsPort = await freePort();
  const adminPort = await freePort();
  const child = spawn(process.execPath, [RELAY_JS], {
    cwd: path.dirname(RELAY_JS),
    env: {
      ...process.env,
      ENABLE_WSS: "false",
      LOG_LEVEL: "0",
      WS_BIND_ADDRESS: "127.0.0.1",
      WS_PORT: String(wsPort),
      ADMIN_BIND_ADDRESS: "127.0.0.1",
      ADMIN_PORT: String(adminPort),
      PROXY_BIND_ADDRESS: "127.0.0.1",
      PROXY_PORT: "0",
      ADMIN_AUTH_DB_PATH: path.join(os.tmpdir(), `relaynet-client-e2e-${process.pid}.sqlite`),
      ADMIN_SESSION_SECRET: "e2e-secret",
      ADDRESS_HOLD_MS: holdMs,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i += 1) {
    const up = await new Promise((resolve) => {
      const socket = net.connect(wsPort, "127.0.0.1", () => resolve(socket.end() && true));
      socket.on("error", () => resolve(false));
    });
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { url: `ws://127.0.0.1:${wsPort}/`, stop: () => child.kill("SIGTERM") };
}

async function until(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function sum16(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i += 2) s += buf.readUInt16BE(i);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  return ~s & 0xffff;
}

// The DHCPDISCOVER from the docs' minimal client.
function dhcpDiscover(mac) {
  const dhcp = Buffer.alloc(244);
  dhcp.set([1, 1, 6]);
  dhcp.writeUInt32BE(0x12345678, 4);
  mac.copy(dhcp, 28);
  dhcp.writeUInt32BE(0x63825363, 236);
  dhcp.set([53, 1, 1, 255], 240);
  const udp = Buffer.alloc(8);
  udp.writeUInt16BE(68, 0); udp.writeUInt16BE(67, 2); udp.writeUInt16BE(8 + dhcp.length, 4);
  const ip = Buffer.alloc(20);
  ip.set([0x45]); ip.writeUInt16BE(20 + 8 + dhcp.length, 2); ip[8] = 64; ip[9] = 17;
  ip.set([255, 255, 255, 255], 16);
  ip.writeUInt16BE(sum16(ip), 10);
  const eth = Buffer.concat([Buffer.alloc(6, 0xff), mac, Buffer.from([0x08, 0x00])]);
  return Buffer.concat([eth, ip, udp, dhcp]);
}

function leaseFrom(frame) {
  const f = Buffer.from(frame);
  if (f.readUInt16BE(12) !== 0x0800 || f[23] !== 17 || f.readUInt16BE(34) !== 67) return null;
  return [...f.subarray(58, 62)].join(".");
}

// Collects the DHCP leases of one client with its own MAC.
function client(url, macByte, options = {}) {
  const mac = Buffer.from([0x02, 0, 0, 0, 0, macByte]);
  const seen = { opens: [], leases: [] };
  seen.conn = connectRelay({
    url,
    ...options,
    onOpen: (info) => {
      seen.opens.push(info);
      seen.conn.send(dhcpDiscover(mac));
    },
    onFrame: (frame) => {
      const lease = leaseFrom(frame);
      if (lease) seen.leases.push(lease);
    },
  });
  return seen;
}

test("reconnecting after a dropped socket keeps the DHCP address", { skip: SKIP, timeout: 20000 }, async (t) => {
  const relay = await startRelay(process.env.E2E_HOLD_MS);
  t.after(relay.stop);

  // While the gate is shut, connections go to a closed port, as if the
  // network were down.
  let gateOpen = true;
  class GatedWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(gateOpen ? url : "ws://127.0.0.1:9/", protocols);
    }
  }
  const a = client(relay.url, 0x42, { WebSocket: GatedWebSocket });
  t.after(() => a.conn.close());
  await until(() => a.leases.length === 1);
  assert.deepEqual(a.opens, [{ reconnect: false }]);
  assert.match(a.leases[0], /^10\.0\.2\.\d+$/);

  gateOpen = false;
  a.conn.ws.close(4000, "simulated drop");
  await until(() => a.conn.state === "waiting" && a.conn.failures >= 2);

  // Another session asks for an address during the gap.
  const b = client(relay.url, 0x43);
  t.after(() => b.conn.close());
  await until(() => b.leases.length === 1);
  assert.notEqual(b.leases[0], a.leases[0], "the held address is not handed out");

  gateOpen = true;
  a.conn.wake();
  await until(() => a.leases.length === 2);
  assert.deepEqual(a.opens.at(-1), { reconnect: true });
  assert.equal(a.leases[1], a.leases[0], "the reconnect gets its address back");
  assert.equal(a.conn.stats.reconnects, 1);
});
