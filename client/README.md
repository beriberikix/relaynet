# relaynet

A reconnecting WebSocket transport for [relaynet](https://relaynet.network)'s
`relay.v1` protocol: one dependency-free ES module for browsers and Node 22+.
It owns the WebSocket and passes Ethernet frames through to your TCP/IP
stack (a browser VM, lwIP, smoltcp…) unchanged. What it adds is the session
lifecycle:

- a `ping:` heartbeat that notices a dead socket, and an immediate check
  when the page becomes visible, comes back online or wakes from sleep
- reconnecting with jittered backoff (1, 2, 4 … 60 s), at once after a drop
  and within seconds after a relay deploy (`1001`); a relay that closes
  sessions right after they open gets backoff, not a reconnect loop
- stopping on final closes (`1008`: revoked token, suspended account,
  quota; `idle timeout`), and, where the page may call it, asking
  `GET /api/me` whether a refused upgrade was the token's fault
- closing the socket on `pagehide` (a page in the back/forward cache can
  keep it open) and reconnecting on `pageshow`
- dropping frames instead of queueing them while disconnected or backed up
- `onOpen({ reconnect: true })` so the app can restart what depended on the
  old session

## Install

```sh
npm install relaynet
```

Pages without a build step can import it from a CDN, pinned to a version:

```js
import { connectRelay } from "https://cdn.jsdelivr.net/npm/relaynet@0.1/relaynet.js";
```

## Use

```js
import { connectRelay } from "relaynet";

const relay = connectRelay({
  token,                                            // an API token from relaynet.network
  onFrame: (frame) => stack.receiveFrame(frame),    // Uint8Array, relay -> stack
  onOpen: ({ reconnect }) => {
    if (reconnect) restartWhatNeedsTheNetwork();    // a new relay session
  },
  onStateChange: (state) => showStatus(state),      // connecting, open, waiting, closed
  onClose: ({ code, reason, final }) => {
    if (final) showError(reason);                   // e.g. "token revoked"
  },
});
stack.onFrame = (frame) => relay.send(frame);       // stack -> relay; false if dropped
// relay.close() ends the session and stops reconnecting.
```

With v86, leave out `relay_url` and connect the network card through the
helper:

```js
const emulator = new V86({ /* ... */ net_device: { type: "virtio" } });
const relay = connectRelay({
  token,
  onFrame: (frame) => emulator.bus.send("net0-receive", frame),
});
emulator.add_listener("net0-send", (frame) => relay.send(frame));
```

## Options

| Option | Default | |
|---|---|---|
| `token` | | API token, sent as the `relay.token.<token>` subprotocol |
| `url` | `wss://relay.relaynet.network/` | Relay endpoint |
| `onFrame`, `onOpen`, `onClose`, `onStateChange` | no-ops | Callbacks shown above |
| `heartbeatMs` | `20000` | Heartbeat interval |
| `heartbeatTimeoutMs` | `10000` | How long a probe may go unanswered |
| `initialBackoffMs`, `maxBackoffMs` | `1000`, `60000` | Reconnect backoff |
| `maxBufferedBytes` | `1048576` | Drop frames while the socket has more than this queued |
| `checkToken` | `true` | Ask `/api/me` after a refused upgrade |
| `WebSocket` | `globalThis.WebSocket` | Constructor, e.g. from the `ws` package |

`relay.state` and `relay.stats` (`framesSent`, `framesReceived`,
`framesDropped`, `reconnects`) report progress; `relay.wake()` checks the
session or reconnects now.

Each reconnect is a new relay session: its TCP connections to the internet
are gone, while the address comes back if the stack reconnects within 60 s
with the same MAC. See [When a session
drops](https://relaynet.network/docs#when-a-session-drops) for what the relay
keeps and how to recover well.

## License

MIT
