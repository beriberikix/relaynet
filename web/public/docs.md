# relaynet documentation

relaynet gives a virtual machine that runs in a web page (v86, a Linux or
Zephyr build compiled to WebAssembly, any emulator with a virtual network
card) a real network connection. The VM's network card sends Ethernet frames
over a WebSocket; the relay answers DHCP and ARP, forwards TCP and UDP to the
public internet, and sends the replies back as Ethernet frames.

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

## Quick start

1. Sign in at [relaynet.network](https://relaynet.network) and redeem your
   invite code.
2. In the dashboard, under **API tokens**, create a token. It looks like
   `rr_<prefix>_<secret>` and is shown once; copy it.
3. Open a WebSocket with the token and give it to your VM's network card:

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
| Client to relay | text | `ping:<anything>`: the relay answers `pong:<anything>`. Optional; useful for measuring latency. Other text messages are ignored. |

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
| Lease time | 3600 s; leases end when the session closes |
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
- **Broadcast and VM-to-VM**: sessions of the same account share the
  `10.0.2.0/24` network and can reach each other by address. Other accounts'
  sessions are invisible.

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
- A session with no messages from the client for 30 minutes is closed
  (`1000`, `idle timeout`). VM traffic counts; the relay's pings do not.
- A session lasts at most 12 hours (`1000`, `session expired`). Reconnect to
  continue; DHCP gives the VM a new lease.

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
not retry on 401 or 403.

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

## Notes for AI agents

- Treat this document as the specification for `relay.v1`. The protocol has
  no hidden control channel: binary messages are Ethernet frames, and text
  messages are only `ping:`/`pong:`.
- Never write a user's API token into source files, logs, commit messages or
  public pages; read it from an environment variable or user input.
- When a connection fails, call `GET /api/me` with the token to tell an
  authentication problem from a network problem before changing code.
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
