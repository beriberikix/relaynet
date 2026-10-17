# relaynet.js

A reconnecting WebSocket transport for the relaynet `relay.v1` protocol: one
dependency-free ES module for browsers and Node 22+. It owns the WebSocket
and passes Ethernet frames through to your TCP/IP stack unchanged; what it
adds is the session lifecycle:

- a `ping:` heartbeat that notices a dead socket, and an immediate check
  when the page becomes visible, comes back online or wakes from sleep
- reconnecting with jittered backoff (1, 2, 4 … 60 s), at once after a drop
  and within seconds after a relay deploy (`1001`)
- stopping on final closes (`1008`: revoked token, suspended account,
  quota; `idle timeout`), and, where the page may call it, asking
  `GET /api/me` whether a refused upgrade was the token's fault
- closing the socket on `pagehide` (a page in the back/forward cache can
  keep it open) and reconnecting on `pageshow`
- dropping frames instead of queueing them while disconnected or backed up
- `onOpen({ reconnect: true })` so the app can restart what depended on the
  old session

```js
import { connectRelay } from "https://relaynet.network/relaynet.js";

const relay = connectRelay({
  token,
  onFrame: (frame) => stack.receiveFrame(frame),
  onOpen: ({ reconnect }) => reconnect && restartWhatNeedsTheNetwork(),
  onStateChange: (state) => showStatus(state),
});
stack.onFrame = (frame) => relay.send(frame);
```

Documentation, including v86 and what the relay keeps across a reconnect:
[When a session drops](https://relaynet.network/docs#when-a-session-drops).

`web/docs/build.py` copies `relaynet.js` to `web/public/`, which serves it at
https://relaynet.network/relaynet.js with `Access-Control-Allow-Origin: *`.

## Tests

```sh
npm test            # unit tests, no network
npm run test:e2e    # against a local rootlessRelay checkout (RELAY_JS, default ../../rootlessRelay/relay.js)
```
