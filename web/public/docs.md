# relaynet documentation

relaynet gives code in a web page, or any program that can open a WebSocket,
raw IPv4 networking. The client sends Ethernet frames over a WebSocket; the
relay answers DHCP and ARP, forwards TCP and UDP to the public internet, and
sends the replies back as Ethernet frames. The client brings its own TCP/IP
stack: a virtual machine (v86, Linux or Zephyr compiled to WebAssembly), or a
user-space stack. Sessions of one account also share a private network.

This page is also available as plain Markdown at
[/docs.md](https://relaynet.network/docs.md), and an index for AI agents is at
[/llms.txt](https://relaynet.network/llms.txt).

## At a glance

| | |
|---|---|
| Endpoint | `wss://relay.relaynet.network/` |
| Subprotocol | `relay.v1` |
| Authentication | API token in a second subprotocol entry, `relay.token.<token>`, or `Authorization: Bearer <token>` outside browsers |
| Message format | Each binary WebSocket message is exactly one Ethernet II frame, without preamble or checksum (FCS) |
| Network | IPv4 only: `10.0.2.0/24`, gateway `10.0.2.2`, addresses from DHCP |
| Access | Invite-only beta; sign in at [relaynet.network](https://relaynet.network) and redeem an invite |

## What it is for

Browsers can open HTTP, WebSocket, WebTransport and WebRTC connections, but
not plain TCP or UDP sockets. relaynet fills that gap for protocols below
HTTP:

- **Browser VMs and emulators.** The guest's network card is the client. It
  runs DHCP and then uses the network as on real hardware.
- **Remote shells.** An SSH client compiled to WebAssembly connects to port
  22 of any public host. SSH encrypts end to end, so the relay only carries
  ciphertext.
- **USB/IP and device sharing.** A page that reads a device through WebUSB
  serves it over USB/IP (TCP port 3240) to a Linux machine on your account's
  network (see [Joining your own machines](#joining-your-own-machines)),
  which attaches it with `usbip attach`. Every USB transfer makes a round
  trip through the relay, so this suits low-rate devices (serial adapters,
  security keys, debug probes), not webcams or audio.
- **Debug protocols.** A web IDE talks to a GDB server, OpenOCD or a vendor
  debug server over TCP; or a page holding a probe through WebUSB serves the
  GDB remote protocol to `gdb` on one of your machines.
- **KVM and consoles.** VNC (RFB), IPMI (UDP 623) and serial-over-TCP
  consoles of hosts with public addresses. Most KVMs sit on private
  networks, which relaynet cannot reach directly; run relaynet-bridge on a
  machine on that network, such as `relaynet-bridge -expose
  5900=192.168.1.40:5900`.
- **Custom, encrypted and peer-to-peer protocols.** TCP and UDP to any public
  host and port except 25: WireGuard, QUIC, libp2p transports, Noise-based or
  proprietary protocols, game networking.

### When to use something else

relaynet adds a hop through California and requires an IP stack in the
client. Prefer another tool when one fits:

| If you need | Use instead | Why |
|---|---|---|
| A byte stream to a server you run | A plain WebSocket or WebTransport endpoint | No IP stack in the client, one hop fewer |
| Browser-to-browser data, audio or video | WebRTC | Peer to peer with NAT traversal and congestion control built for media; lower latency |
| HTTP APIs | `fetch` | Already in the browser |
| Your home or office LAN, or inbound connections from the internet | A VPN or tunnel (WireGuard, Tailscale, Cloudflare Tunnel) | relaynet has no inbound ports and blocks private addresses |
| Bulk transfer or low latency far from California | A server near your users | Sessions are capped at 1 MiB/s, and each TCP connection carries about 64 KiB per round trip |
| IPv6, ICMP to the internet, multicast, port 25 | Not available here | relaynet is IPv4 TCP and UDP only |

### Bringing your own TCP/IP stack

Every client needs something that turns sockets into Ethernet frames:

- **A virtual machine.** The guest kernel is the stack; connect its virtual
  network card (see [v86](#v86)).
- **A user-space stack compiled to WebAssembly**, such as lwIP, smoltcp
  (Rust) or gVisor's netstack (Go). Feed it the frames from the WebSocket
  and send the frames it emits; run its DHCP client, or give it a static
  address (see [DHCP](#dhcp)).
- **Your own minimal stack.** For a single UDP protocol, building IPv4 and
  UDP headers by hand is enough; the [minimal client
  example](#minimal-client-example) shows the format.

### Joining your own machines

All sessions of one account share `10.0.2.0/24` and can reach each other by
address, while other accounts' sessions are invisible. To put a regular
computer on that network, run
[relaynet-bridge](https://github.com/beriberikix/relaynet-bridge) on it. It
connects out to the relay with your token, so no inbound port is opened.

```sh
export RELAYNET_TOKEN=rr_...
# Let your sessions reach this machine's USB/IP server and SSH (no root):
relaynet-bridge -expose 3240 -expose 2222=127.0.0.1:22
# Reach port 3240 of the session at 10.0.2.15 as localhost:3240 (no root):
relaynet-bridge -forward 3240=10.0.2.15:3240
# Or give the machine an interface with the session address (root; Linux, macOS):
sudo -E relaynet-bridge -tun
```

The bridge logs the address it joined with, such as `10.0.2.17`. `-tun`
adds a route for `10.0.2.0/24` only, so the machine's default route stays on
its own network. `-ip 10.0.2.200` asks for a fixed address. After a
reconnect the bridge reclaims its address unless another session took it.

An account can hold 4 sessions at once, and the bridge uses one, so this
suits a few devices, not a fleet. Anything else that sends and receives
Ethernet frames over the WebSocket works too, such as a TAP interface
bridged by your own program.

## Quick start

1. Sign in at [relaynet.network](https://relaynet.network) and redeem your
   invite code.
2. In the dashboard, under **API tokens**, create a token. It looks like
   `rr_<prefix>_<secret>` and is shown once; copy it.
3. Open a WebSocket with the token and connect it to your VM's network card
   or your TCP/IP stack:

```js
const ws = new WebSocket("wss://relay.relaynet.network/", [
  "relay.v1",
  "relay.token." + token,
]);
ws.binaryType = "arraybuffer";
ws.onmessage = (event) => vm.receiveFrame(new Uint8Array(event.data)); // relay -> VM
vm.onFrame = (frame) => ws.send(frame);                                // VM -> relay
```

4. Boot the VM and let it run DHCP as usual. It gets an address such as
   `10.0.2.15`, a default route through `10.0.2.2` and a DNS server, and can
   then reach the internet.

## Connecting

### From a browser page

Browsers cannot set headers on a WebSocket, so the token goes in the
subprotocol list next to `relay.v1`, as in the quick start. The relay answers
with `Sec-WebSocket-Protocol: relay.v1`; check `ws.protocol === "relay.v1"`
after `open`.

Any web page may open a session; the token is what authorizes it. The
account API (`/api/me`) only answers browser requests from the relaynet
dashboard, so manage tokens there.

### v86

v86 opens the relay WebSocket itself and does not pass subprotocols, so wrap
`WebSocket` before creating the emulator. The wrapper adds the token only to
connections to the relay:

```js
function useRelayToken(relayUrl, token) {
  const Native = window.WebSocket;
  const relayHost = new URL(relayUrl).host;
  window.WebSocket = function (url, protocols) {
    if (new URL(String(url), location.href).host !== relayHost) {
      return protocols === undefined ? new Native(url) : new Native(url, protocols);
    }
    return new Native(url, ["relay.v1", "relay.token." + token]);
  };
  window.WebSocket.prototype = Native.prototype;
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) window.WebSocket[key] = Native[key];
}

useRelayToken("wss://relay.relaynet.network/", token);
const emulator = new V86({
  // ...
  net_device: { type: "virtio", relay_url: "wss://relay.relaynet.network/" },
});
```

### From Node.js, Python or other programs

Programs that can set headers may send the token as a bearer token instead of
a subprotocol entry. They still request `relay.v1`.

```js
// Node 22+ has WebSocket built in; with the "ws" package:
import WebSocket from "ws";
const ws = new WebSocket("wss://relay.relaynet.network/", ["relay.v1"], {
  headers: { Authorization: `Bearer ${process.env.RELAY_TOKEN}` },
});
```

## When a session drops

A session is one WebSocket. When it closes, for any reason, the relay ends
the session: its TCP connections to the internet are closed and its UDP
flows dropped. The page, the VM or stack in it, and any WebUSB device the
page holds are untouched, so recovering is a matter of reconnecting and
restarting what depended on the old session.

### What ends a session

| Cause | What happens |
|---|---|
| The tab is in the background | Usually nothing: the browser answers the relay's pings itself. Browsers throttle timers in hidden tabs (Chrome to about once a minute after five minutes), so a VM or stack in the page runs slowly and its peers may time out. |
| The tab is frozen or discarded (memory saving, a mobile browser in the background) | A frozen page runs no JavaScript. The session may stay open with frames for the page piling up, or end when the browser stops answering pings. A discarded page reloads from scratch. |
| The computer sleeps, or the network changes | The socket dies, often without a close event in the page until it next sends. The relay closes the session after about 60 s. |
| A relay deploy | Close code `1001`; reconnect after a few seconds. |
| 12 hours, or 30 minutes without frames | Close code `1000`, `session expired` or `idle timeout`. |
| A revoked token, a suspended account, an exhausted quota | Close code `1008`. Reconnecting will not work. |

### What a reconnect gets back

- **The address, for 60 seconds.** When a session closes, the relay holds
  its address for your account for 60 s. A client that reconnects in that
  time gets the same address back by running DHCP with the same MAC, or by
  sending from it. Other accounts cannot take it. If the old session still
  looks open (after a sleep or a network change the relay takes up to a
  minute to notice) and has sent nothing for 5 s, the new session takes over
  its MAC and address and the old one is closed.
- **Connections between your sessions.** Traffic between sessions of one
  account, such as USB/IP between a page and a machine running
  relaynet-bridge, passes as plain IP between the two TCP/IP stacks; the
  relay keeps no state for it. If the address comes back, those connections
  survive a gap shorter than the stacks' own TCP timeouts.
- **Not connections to the internet.** The relay terminates those, so they
  end with the session. After a reconnect, the relay answers any segment of
  such a connection with a TCP reset, so the stack fails it at once instead
  of retransmitting for minutes; the application then reconnects as it would
  after any network error.

### The client helper

[relaynet.js](https://relaynet.network/relaynet.js) is a small,
dependency-free ES module that owns the WebSocket and passes frames through
to your stack unchanged. It sends a heartbeat (`ping:`) to notice a dead
socket, checks the session as soon as the page becomes visible, comes back
online or wakes from sleep, reconnects with backoff, stops on `1008`,
closes the socket when the page is left (browsers can keep it open for a
page in the back/forward cache) and reconnects if it comes back, and drops
frames instead of queueing them while disconnected (TCP retransmits;
stale frames only confuse the stack). It works in browsers and in Node 22+.

```js
import { connectRelay } from "https://relaynet.network/relaynet.js";

const relay = connectRelay({
  token,
  onFrame: (frame) => stack.receiveFrame(frame),  // Uint8Array, relay -> stack
  onOpen: ({ reconnect }) => {
    if (reconnect) restartWhatNeedsTheNetwork();  // a new session (see below)
  },
  onStateChange: (state) => showStatus(state),    // connecting, open, waiting, closed
  onClose: ({ code, reason, final }) => {
    if (final) showError(reason);                 // e.g. "token revoked"
  },
});
stack.onFrame = (frame) => relay.send(frame);     // stack -> relay; false if dropped
// relay.close() ends the session and stops reconnecting.
```

Options include `url`, `heartbeatMs` (20 s), `heartbeatTimeoutMs` (10 s),
`maxBackoffMs` (60 s) and `WebSocket` (a constructor, for Node libraries such
as `ws`). Browsers hide why an upgrade was refused, so after a failed
connection the helper asks `GET /api/me` once whether the token is still
valid. Pages on other sites cannot read that answer (CORS) and keep
retrying with backoff; pass `checkToken: false` to skip the request.
Import from the URL above, or copy the file into your project to pin a
version.

With v86, leave out `relay_url` and connect the network card through the
helper instead of the WebSocket wrapper in [v86](#v86):

```js
const emulator = new V86({ /* ... */ net_device: { type: "virtio" } });
const relay = connectRelay({
  token,
  onFrame: (frame) => emulator.bus.send("net0-receive", frame),
});
emulator.add_listener("net0-send", (frame) => relay.send(frame));
```

### Recovering well

- **Keep the MAC.** VMs keep theirs. A user-space stack should pick a MAC
  once and reuse it (for example from `localStorage`), so DHCP after a
  reconnect returns the same address. Do not use one MAC in two pages at
  once: each would take over the other's session whenever it goes quiet.
- **Restart what used the old session** in `onOpen({ reconnect: true })`:
  open new connections to the internet, and re-run anything that could not
  survive (for example `usbip attach` on the Linux side if its connection
  was reset). A stack that runs DHCP itself needs nothing else.
- **Renew the lease after a long gap.** A VM guest keeps its address for the
  lease time (3600 s). If it was away for more than 60 s and another session
  took the address, the guest's packets are dropped until it renews; restart
  its DHCP client.
- **Show the state.** Tell the user when the page is reconnecting or has
  stopped, instead of letting connections fail silently.
- **Keep long device sessions visible.** A USB/IP or debug server in a
  hidden, throttled tab answers slowly enough for the other side to time
  out. Give it its own window and keep that window uncovered. A page keeps
  its WebUSB device claimed across reconnects; the device's own `disconnect`
  event (`navigator.usb`) is unrelated to the network.

## API tokens

- Create and revoke tokens in the dashboard. Creating or revoking needs a
  dashboard sign-in; a token cannot create or revoke tokens.
- Tokens expire after 90 days by default; choose 1 to 365 days, or none. An
  account can have up to 20 active tokens.
- Revoking a token closes its open sessions immediately (close code `1008`,
  reason `token revoked`).
- Anything in a public web page is visible to its visitors. Do not put your
  token in a page other people load; have each user paste their own token,
  or serve the page only to yourself.
- Check a token from a shell:

```sh
curl -s -H "Authorization: Bearer $RELAY_TOKEN" https://relay.relaynet.network/api/me
```

## Protocol

relaynet speaks the rootlessRelay WebSocket protocol, version `relay.v1`.

### Handshake

```http
GET / HTTP/1.1
Host: relay.relaynet.network
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <random>
Sec-WebSocket-Protocol: relay.v1, relay.token.rr_abcd1234_...
Origin: https://your-site.example
```

On success the relay answers `101 Switching Protocols` with
`Sec-WebSocket-Protocol: relay.v1`. On failure it answers with an HTTP status
and a JSON body such as `{"error":"invalid-token"}` and closes the connection
(see [Errors](#errors)). Any path works; use `/`.

### Messages

| Direction | Type | Content |
|---|---|---|
| Client to relay | binary | One Ethernet II frame from the VM: destination MAC, source MAC, EtherType, payload. No preamble, no FCS. At most 65,549 bytes. |
| Relay to client | binary | One Ethernet II frame for the VM, same format. |
| Client to relay | text | `ping:<anything>`: the relay answers `pong:<anything>`. Optional; useful for measuring latency and as a heartbeat. It does not count as activity for the idle timeout. Other text messages are ignored. |

There is no other framing, no handshake inside the WebSocket and no
per-message metadata. Messages are delivered in order. Frames are never
merged or split: one VM frame is one WebSocket message.

### Virtual network

| Item | Value |
|---|---|
| Subnet | `10.0.2.0/24` (netmask `255.255.255.0`) |
| Gateway and DHCP server | `10.0.2.2`, MAC `52:54:00:12:34:56` |
| VM addresses | `10.0.2.15` to `10.0.2.254`, one per session, from DHCP |
| DNS server offered | `8.8.8.8` (the VM may use any public resolver) |
| MTU | 1500 (DHCP option 26) |
| Lease time | 3600 s; when the session closes, the address is held for the account for 60 s (see [When a session drops](#when-a-session-drops)) |
| Protocols | ARP and IPv4. IPv6 and other EtherTypes are dropped. |

### DHCP

Send a normal DHCPDISCOVER (UDP `0.0.0.0:68` to `255.255.255.255:67`); the
relay answers with an offer and acknowledges the request. Replies carry:
message type (53), server identifier (54) `10.0.2.2`, lease time (51)
`3600`, subnet mask (1), router (3) `10.0.2.2`, DNS server (6) `8.8.8.8` and
interface MTU (26) `1500`.

A VM may also skip DHCP and use a static address in the range
`10.0.2.15`–`10.0.2.254`; the first source address it sends from becomes its
address for the session, if no other session holds it.

### What the relay does with each packet

- **ARP**: answers requests for `10.0.2.2`, and for the addresses of your
  account's other open sessions.
- **ICMP**: answers echo requests (ping) to `10.0.2.2`. ICMP to the internet
  is not forwarded, so `ping 8.8.8.8` fails even when the network works.
- **TCP**: the relay terminates TCP. A SYN from the VM makes the relay open a
  real connection to the destination; the VM's handshake completes when that
  connection does. Data is relayed in both directions; the relay advertises a
  maximum segment size of 1460.
- **UDP**: each source and destination pair becomes a flow on a real UDP
  socket; replies come back to the VM's source port. DNS is ordinary UDP to
  port 53 of any resolver. DNS over TCP, DoH and DoT also work.
- **Between your sessions**: sessions of the same account share the
  `10.0.2.0/24` network and can reach each other by address, including
  broadcast to `10.0.2.255`. Other accounts' sessions are invisible.

### Address and identity rules

- **One address per session.** The address from DHCP (or the first source
  address used) is locked for the session. Packets from any other source
  address are dropped.
- **One MAC per session.** The first source MAC is locked too. To change it,
  reconnect.

### Outbound rules

- Blocked destinations: private and reserved ranges (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `127.0.0.0/8`,
  `169.254.0.0/16` including cloud metadata, `0.0.0.0/8`, multicast, the
  documentation ranges, `240.0.0.0/4` and broadcast), except your own
  sessions on `10.0.2.0/24`.
- Blocked port: 25 (SMTP), TCP and UDP. Use your mail provider's submission
  port 587 or 465.
- A refused TCP connection gets an immediate RST (`connection refused`), not
  a timeout. Refused UDP is dropped silently.
- A TCP connection the destination does not answer within 15 seconds is reset.
- Traffic leaves from `209.71.113.1` (IPv4). Use this to allow-list relaynet
  on servers you control.

### Keepalive and timeouts

- The relay sends a WebSocket ping every 30 seconds; browsers and most
  libraries answer automatically. A session that misses two pings in a row is
  closed.
- A session with no frames from the client for 30 minutes is closed
  (`1000`, `idle timeout`). Only Ethernet frames count; `ping:` messages and
  the relay's pings do not.
- A session lasts at most 12 hours (`1000`, `session expired`). Reconnect to
  continue; DHCP with the same MAC gives the VM its address back.
- The browser, not the page, answers the relay's pings, so a session can
  outlive the JavaScript that uses it. In the other direction, a page may
  not notice a dead socket until it sends; a `ping:` heartbeat finds out
  sooner. See [When a session
  drops](#when-a-session-drops).

### Errors

Before the handshake completes, the relay answers with an HTTP status and a
JSON `error`. Browsers hide these and report a failed connection (close code
`1006`); use the `curl` check under [API tokens](#api-tokens), or a non-browser
client, to see the reason.

| Status | `error` | Meaning |
|---|---|---|
| 401 | `authentication-required` | No token was sent. |
| 401 | `invalid-token` | The token is wrong or was deleted. |
| 401 | `token-revoked`, `token-expired` | Create a new token. |
| 403 | `account-pending` | The account has not redeemed an invite. |
| 403 | `account-suspended` | The account is suspended; contact support. |
| 429 | `session limit reached for this account` | Close another session first. |
| 429 | `connection limit reached for this address` | Too many sessions from one client IP. |
| 429 | `quota exceeded` | Monthly data quota used up. |
| 503 | `address pool exhausted`, `server shutting down` | The relay is full or restarting; retry with backoff. |

After the handshake, the relay closes sessions with these codes:

| Code | Reason | Meaning |
|---|---|---|
| 1000 | `idle timeout`, `session expired` | Normal end; reconnect if needed. |
| 1001 | `server shutting down` | The relay is restarting (deploys). Reconnect after a few seconds. |
| 1008 | `token revoked` | The token was revoked. |
| 1008 | `account suspended`, `account deleted` | The account can no longer connect. |
| 1008 | `quota exceeded` | The monthly quota ran out during the session. |
| 1008 | `terminated by operator` | Closed by the relaynet operator. |

Reconnect with exponential backoff (for example 1, 2, 4 … 60 seconds), and do
not retry on 401 or 403 or after `1008`. The [client
helper](#the-client-helper) does this.

### Minimal client example

A complete Node 22+ program that connects, gets a DHCP lease and prints it.
It builds the frames by hand, which shows everything the protocol involves:

```js
const MAC = Buffer.from([0x02, 0, 0, 0, 0, 1]);
const ws = new WebSocket("wss://relay.relaynet.network/", ["relay.v1", "relay.token." + process.env.RELAY_TOKEN]);
ws.binaryType = "arraybuffer";

function sum16(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i += 2) s += buf.readUInt16BE(i);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  return ~s & 0xffff;
}

ws.onopen = () => {
  const dhcp = Buffer.alloc(244);                      // BOOTP request
  dhcp.set([1, 1, 6]);                                 // op, htype, hlen
  dhcp.writeUInt32BE(0x12345678, 4);                   // transaction id
  MAC.copy(dhcp, 28);
  dhcp.writeUInt32BE(0x63825363, 236);                 // magic cookie
  dhcp.set([53, 1, 1, 255], 240);                      // DHCPDISCOVER, end
  const udp = Buffer.alloc(8);
  udp.writeUInt16BE(68, 0); udp.writeUInt16BE(67, 2); udp.writeUInt16BE(8 + dhcp.length, 4);
  const ip = Buffer.alloc(20);
  ip.set([0x45]); ip.writeUInt16BE(20 + 8 + dhcp.length, 2); ip[8] = 64; ip[9] = 17;
  ip.set([255, 255, 255, 255], 16);                    // from 0.0.0.0 to broadcast
  ip.writeUInt16BE(sum16(ip), 10);
  const eth = Buffer.concat([Buffer.alloc(6, 0xff), MAC, Buffer.from([0x08, 0x00])]);
  ws.send(Buffer.concat([eth, ip, udp, dhcp]));
};

ws.onmessage = ({ data }) => {
  const f = Buffer.from(data);
  if (f.readUInt16BE(12) === 0x0800 && f[23] === 17 && f.readUInt16BE(34) === 67) {
    console.log("leased", [...f.subarray(58, 62)].join("."), "from", [...f.subarray(26, 30)].join("."));
    ws.close();
  }
};
```

## Limits

Beta accounts have these limits. They are per account unless noted.

| Limit | Value |
|---|---|
| Concurrent sessions | 4 per account, 4 per client IP address |
| Bandwidth | 1 MiB/s download and 1 MiB/s upload, per session |
| Data quota | 20 GiB per calendar month (UTC), both directions combined |
| Open TCP connections | 256 per session |
| New TCP connections | 50 per second per session |
| UDP flows | 256 per session |
| DNS queries | 100 per second per session |
| Session length | 12 hours; 30 minutes idle |
| Blocked ports | 25 |

Traffic over a limit is slowed down or dropped rather than causing an error:
TCP slows down, excess SYNs and UDP packets are dropped, and the VM's own
retransmissions recover. Use `GET /api/me` to see your limits and
`GET /api/me/usage` to see this month's usage.

## Account API

The account API is served by the relay at `https://relay.relaynet.network`,
uses `Authorization: Bearer <token>` with an API token or a dashboard sign-in,
and returns JSON. Everything is scoped to your own account.

| Method and path | Purpose |
|---|---|
| `GET /api/me` | Account, status and limits |
| `GET /api/me/usage` | Data used this month and the quota |
| `GET /api/me/sessions` | Open sessions: VM address, bytes, connections, start time |
| `DELETE /api/me/sessions/<sessionId>` | Close one of your sessions |
| `GET /api/me/tokens` | Token list (names, prefixes, dates; never the secret) |
| `POST /api/me/tokens` | Create a token; body `{"name": "...", "expiresInDays": 90}`. Dashboard sign-in only. |
| `DELETE /api/me/tokens/<id>` | Revoke a token. Dashboard sign-in only. |
| `POST /api/me/redeem` | Redeem an invite; body `{"code": "RLY-XXXX-XXXX-XXXX"}` |
| `DELETE /api/me` | Delete the account; body `{"confirm": "<username>"}`. Dashboard sign-in only. |

## Troubleshooting

- **The WebSocket closes immediately (1006).** Run the `curl` check under
  [API tokens](#api-tokens). If the token works, the account is probably at
  its session limit (4); close a session in the dashboard or wait for idle
  sessions to time out.
- **The VM gets no address.** Check that its network card sends frames to the
  WebSocket and that frames from the relay reach it. The first message from
  the VM is usually a DHCPDISCOVER of about 300 bytes; the reply comes within
  a second.
- **DHCP works but nothing else does.** `ping 8.8.8.8` is expected to fail
  (ICMP is not forwarded). Try `ping 10.0.2.2`, then a DNS lookup, then an
  HTTP request.
- **Connections to a private address are refused.** Private and reserved
  ranges are blocked by design; see [Outbound rules](#outbound-rules).
- **Downloads are slower from far away.** Each TCP connection can have at
  most 64 KiB in flight toward the VM, so its speed is about 64 KiB per round
  trip to the relay in California (roughly 250 KB/s at 250 ms), up to the
  1 MiB/s session limit. Use parallel connections for large transfers.
- **Mail does not send.** Port 25 is blocked; use 587 or 465.
- **Connections hang after the computer wakes or the network changes.** The
  socket died and the page has not noticed. Use a `ping:` heartbeat (the
  [client helper](#the-client-helper) has one) and reconnect when it goes
  unanswered.
- **After a reconnect the VM has no network.** If it was away for more than
  60 s, another session may have its address; restart the guest's DHCP
  client.

## Notes for AI agents

- relaynet suits protocols below HTTP for clients with their own TCP/IP
  stack. If the user controls the server, needs browser-to-browser media or
  only calls HTTP APIs, suggest the alternatives under [When to use something
  else](#when-to-use-something-else) instead.
- Treat this document as the specification for `relay.v1`. The protocol has
  no hidden control channel: binary messages are Ethernet frames, and text
  messages are only `ping:`/`pong:`.
- Never write a user's API token into source files, logs, commit messages or
  public pages; read it from an environment variable or user input.
- When a connection fails, call `GET /api/me` with the token to tell an
  authentication problem from a network problem before changing code.
- For browser clients, use the [client helper](#the-client-helper) for the
  WebSocket instead of writing reconnect logic, and restart what depended on
  the old session in `onOpen({ reconnect: true })`.
- Respect the limits above; back off on 429 and 503, and do not retry on 401
  or 403.

## Support and policies

- Support: [support@relaynet.network](mailto:support@relaynet.network)
- Abuse reports: [abuse@relaynet.network](mailto:abuse@relaynet.network)
- Security issues: [security@relaynet.network](mailto:security@relaynet.network)
- Service status: [status.relaynet.network](https://status.relaynet.network)
- [Terms of Service](/terms), [Acceptable Use Policy](/acceptable-use), [Privacy Policy](/privacy)

relaynet runs [rootlessRelay](https://github.com/obegron/rootlessRelay), an
open-source user-space network relay, in its hosted mode.
