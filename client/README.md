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
| `url` | `wss://relay.relaynet.network/` | Relay endpoint. With a token, `ws://` is refused except to `localhost`, `127.x.x.x` and `[::1]` |
| `onFrame`, `onOpen`, `onClose`, `onStateChange` | no-ops | Callbacks shown above |
| `heartbeatMs` | `20000` | Heartbeat interval; a tick probes only if nothing arrived for half of it |
| `heartbeatTimeoutMs` | `10000` | How long a probe may go unanswered |
| `initialBackoffMs`, `maxBackoffMs` | `1000`, `60000` | Reconnect backoff |
| `maxBufferedBytes` | `1048576` | Drop frames while the socket has more than this queued |
| `checkToken` | `true` | Ask `/api/me` after a refused upgrade (off without a `token` or a `fetch`) |
| `WebSocket` | `globalThis.WebSocket` | Constructor, e.g. from the `ws` package |

`relay.state` and `relay.stats` (`framesSent`, `framesReceived`,
`framesDropped`, `reconnects`) report progress; `relay.wake()` checks the
session or reconnects now.

Each reconnect is a new relay session: its TCP connections to the internet
are gone, while the address comes back if the stack reconnects within 60 s
with the same MAC. See [When a session
drops](https://relaynet.network/docs#when-a-session-drops) for what the relay
keeps and how to recover well.

## Interface

Everything lives in [`relaynet.js`](./relaynet.js), the only code file
published (`package.json` `files`, `exports`).

- `connectRelay(options)`: returns `new RelayConnection(options)`.
- `RelayConnection`: the constructor takes the options above, plus
  `fetch` (default `globalThis.fetch`, used for the `/api/me` check) and
  `window` (default `globalThis` when `document` exists, else `null`; used
  for wake listeners). Constructing it connects at once.
  - `send(frame)`: returns `true` if the frame was sent, `false` if it was
    dropped.
  - `wake()`: probes when `open`, reconnects now when `waiting`.
  - `suspend()`: closes the socket (`1000 "page hidden"`) and moves to
    `waiting` without scheduling a retry. Runs on `pagehide`.
  - `close()`: removes listeners and timers, closes the socket
    (`1000 "client closed"`) and moves to `closed`.
  - `state`: `idle`, `connecting`, `open`, `waiting` or `closed`.
  - `stats`: `{ framesSent, framesReceived, framesDropped, reconnects }`.
- Callbacks: `onFrame(Uint8Array)`, `onOpen({ reconnect })`,
  `onStateChange(state)`,
  `onClose({ code, reason, final, retryInMs, error })`. `retryInMs` is
  `null` and `error` may be set when `final` is `true`.
- `classifyClose(code, reason)`: returns `"final"` for `1008` and for
  `1000 "idle timeout"`, `"restart"` for `1001` and for
  `1000 "session expired"`, and `"retry"` for anything else.
- `RELAY_URL` (`wss://relay.relaynet.network/`) and `SUBPROTOCOL`
  (`relay.v1`).

## Invariants

- The constructor throws if there is no WebSocket implementation, or if a
  token would be sent over `ws://` to a host other than `localhost`,
  `127.x.x.x` or `[::1]`.
- The token is sent only as the `relay.token.<token>` subprotocol (with
  `relay.v1`) and as a `Bearer` header to `/api/me`. If the WebSocket
  constructor throws, the token is replaced with `[token]` in the error
  message passed to `onClose`.
- If the server picks a subprotocol and it is not `relay.v1`, the session
  ends as final. An empty `ws.protocol` is accepted.
- That close, and a WebSocket constructor that throws, are final and
  reach `onClose` with `code: 0` (no WebSocket close code exists for them).
- `closed` is terminal. A `RelayConnection` never reconnects after `close()`
  or after a final close; create a new one instead.
- `send` never queues. It drops the frame unless the state is `open`, the
  socket is `OPEN` and `bufferedAmount` is at most `maxBufferedBytes`.
- Text messages from the relay (`pong:` replies) are never passed to
  `onFrame`. Every message, text or binary, counts as a heartbeat reply.
- A heartbeat tick sends a `ping:` probe only if nothing was received for
  `heartbeatMs / 2`, or if the tick came more than `2 * heartbeatMs` after
  the last one (the page slept). While traffic flows, no probes are sent.
- At most one probe is in flight at a time. A probe with no reply within
  `heartbeatTimeoutMs` ends the session as a drop (`1006`
  `"heartbeat timeout"`). If the timeout fires more than
  `2 * heartbeatTimeoutMs` after the probe was sent (a throttled or frozen
  page), it sends a new probe instead.
- Backoff: `initialBackoffMs * 2^(failures - 1)`, capped at `maxBackoffMs`,
  with jitter between half and the full value. `failures` resets only
  after a session has stayed open for at least 10 s.
- A `restart` close reconnects early only if the session was stable: about
  1 to 3 s after `1001`, and at once after `1000 "session expired"`.
  Otherwise the first drop in a row reconnects at once and later ones back
  off. An upgrade that never opened always backs off.
- The token check (`checkToken`) runs at most once per streak of refused
  upgrades. A `401` or `403` makes the close final; any other answer, or a
  network or CORS error, is treated as transient.

## Side Effects

- Opens a WebSocket to `url` with `binaryType = "arraybuffer"`, and sends
  Ethernet frames and `ping:<ms>` text messages on it.
- May `fetch` `GET /api/me` on the relay's HTTP origin, with the token as
  a `Bearer` header.
- When `window` is set, listens on `window` for `online`, `pageshow` and
  `pagehide`, and on `document` for `visibilitychange` and `resume`. Only
  `close()` removes them, and a final close calls `close()`.
- Uses `setTimeout` for retries and probe timeouts, and `setInterval` for
  the heartbeat.
- Closes the socket with `1000` (`"client closed"`, `"page hidden"` or
  `"unexpected subprotocol"`) or with `4000 "heartbeat timeout"`.

## Verification

From `client/`:

- Run: `npm test` (unit tests, `node --test relaynet.test.js`)
- Run: `npm run test:e2e` (sets `RUN_NETWORK_TESTS=1` and starts a local
  rootlessRelay from `RELAY_JS`, default `../../rootlessRelay/relay.js`;
  skipped if that file is missing)

## License

MIT
