import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { RelayConnection, classifyClose } from "./relaynet.js";

// A WebSocket double the tests drive from the relay's side.
class FakeWebSocket {
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.protocol = "";
    this.bufferedAmount = 0;
    this.sent = [];
    this.closedWith = null;
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  // Relay side.
  accept(protocol = "relay.v1") {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.({});
  }

  deliver(data) {
    this.onmessage?.({ data });
  }

  drop(code, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  get pings() {
    return this.sent.filter((d) => typeof d === "string" && d.startsWith("ping:"));
  }
}

const latest = () => FakeWebSocket.instances.at(-1);

function setup(t, options = {}) {
  FakeWebSocket.instances = [];
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  t.after(() => mock.timers.reset());
  t.mock.method(Math, "random", () => 1); // backoff at its upper bound
  const events = { opens: [], closes: [], frames: [], states: [] };
  const relay = new RelayConnection({
    token: "rr_test_secret",
    WebSocket: FakeWebSocket,
    checkToken: false,
    onFrame: (frame) => events.frames.push(frame),
    onOpen: (info) => events.opens.push(info),
    onClose: (info) => events.closes.push(info),
    onStateChange: (state) => events.states.push(state),
    ...options,
  });
  t.after(() => relay.close());
  return { relay, events };
}

// Lets promise callbacks (the token check) run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("close codes: final, restart soon, or retry with backoff", () => {
  assert.equal(classifyClose(1008, "token revoked"), "final");
  assert.equal(classifyClose(1008, "quota exceeded"), "final");
  assert.equal(classifyClose(1000, "idle timeout"), "final");
  assert.equal(classifyClose(1000, "session expired"), "restart");
  assert.equal(classifyClose(1001, "server shutting down"), "restart");
  assert.equal(classifyClose(1006, ""), "retry");
});

test("opens with the token in the subprotocol list and passes frames both ways", (t) => {
  const { relay, events } = setup(t);
  const ws = latest();
  assert.deepEqual(ws.protocols, ["relay.v1", "relay.token.rr_test_secret"]);
  assert.equal(ws.binaryType, "arraybuffer");
  assert.equal(relay.send(new Uint8Array(60)), false, "nothing is sent before the session opens");

  ws.accept();
  assert.deepEqual(events.opens, [{ reconnect: false }]);
  assert.equal(relay.state, "open");
  assert.equal(relay.send(new Uint8Array(60)), true);
  ws.deliver(new Uint8Array([1, 2, 3]).buffer);
  ws.deliver("pong:1");
  assert.deepEqual(events.frames, [new Uint8Array([1, 2, 3])]);

  ws.bufferedAmount = 2 * 1024 * 1024;
  assert.equal(relay.send(new Uint8Array(60)), false, "a backed-up socket drops frames");
  assert.deepEqual(relay.stats, { framesSent: 1, framesReceived: 1, framesDropped: 2, reconnects: 0 });
});

test("a revoked token or exhausted quota ends the connection for good", (t) => {
  const { relay, events } = setup(t);
  latest().accept();
  latest().drop(1008, "token revoked");
  assert.equal(relay.state, "closed");
  assert.deepEqual(events.closes, [{ code: 1008, reason: "token revoked", final: true, retryInMs: null, error: null }]);
  mock.timers.tick(10 * 60 * 1000);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test("a relay restart reconnects within seconds and reports a reconnect", (t) => {
  const { relay, events } = setup(t);
  latest().accept();
  mock.timers.tick(15000);
  latest().drop(1001, "server shutting down");
  assert.equal(relay.state, "waiting");
  assert.ok(events.closes[0].retryInMs > 0 && events.closes[0].retryInMs <= 3000);
  mock.timers.tick(3000);
  assert.equal(FakeWebSocket.instances.length, 2);
  latest().accept();
  assert.deepEqual(events.opens.at(-1), { reconnect: true });
  assert.equal(relay.stats.reconnects, 1);
});

test("a restart notice right after opening backs off instead of looping", (t) => {
  const { events } = setup(t);
  const delays = [];
  for (let i = 0; i < 5; i += 1) {
    latest().accept();
    latest().drop(1000, "session expired");
    const delay = events.closes.at(-1).retryInMs;
    delays.push(delay);
    mock.timers.tick(delay);
  }
  assert.deepEqual(delays, [0, 2000, 4000, 8000, 16000]);
  assert.equal(FakeWebSocket.instances.length, 6);

  // After a session that lasted, an expiry reconnects at once again.
  latest().accept();
  mock.timers.tick(15000);
  latest().drop(1000, "session expired");
  assert.equal(events.closes.at(-1).retryInMs, 0);
});

test("a dropped session retries at once, then refused attempts back off up to the cap", (t) => {
  const { events } = setup(t);
  latest().accept();
  latest().drop(1006);
  assert.equal(events.closes[0].retryInMs, 0);
  mock.timers.tick(0);

  const delays = [];
  for (let i = 0; i < 9; i += 1) {
    latest().drop(1006); // refused before opening
    const delay = events.closes.at(-1).retryInMs;
    delays.push(delay);
    mock.timers.tick(delay);
  }
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000]);

  // A session that lasts resets the backoff.
  latest().accept();
  mock.timers.tick(15000);
  latest().drop(1006);
  assert.equal(events.closes.at(-1).retryInMs, 0);
});

test("a refused upgrade asks the account API whether the token is the problem", async (t) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    return { status: 401, json: async () => ({ error: "token-expired" }) };
  };
  const { relay, events } = setup(t, { checkToken: true, fetch });
  latest().drop(1006);
  await settle();
  assert.deepEqual(calls, [{ url: "https://relay.relaynet.network/api/me", auth: "Bearer rr_test_secret" }]);
  assert.equal(relay.state, "closed");
  assert.equal(events.closes.at(-1).reason, "token-expired");
  assert.equal(events.closes.at(-1).final, true);
});

test("when the account API cannot be asked (CORS), refused upgrades keep retrying", async (t) => {
  const fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const { relay, events } = setup(t, { checkToken: true, fetch });
  latest().drop(1006);
  await settle();
  assert.equal(relay.state, "waiting");
  assert.equal(events.closes.at(-1).final, false);
});

test("heartbeat: a silent socket is probed, and one that does not answer is replaced", (t) => {
  const { relay, events } = setup(t);
  const ws = latest();
  ws.accept();
  mock.timers.tick(20000);
  assert.equal(ws.pings.length, 1);
  ws.deliver("pong:x");
  mock.timers.tick(20000);
  assert.equal(ws.pings.length, 2);
  mock.timers.tick(10000); // no answer
  assert.deepEqual(ws.closedWith, { code: 4000, reason: "heartbeat timeout" });
  assert.equal(events.closes.at(-1).reason, "heartbeat timeout");
  mock.timers.tick(0);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(relay.state, "connecting");
});

test("busy sessions are not probed: received frames count as liveness", (t) => {
  setup(t);
  const ws = latest();
  ws.accept();
  for (let i = 0; i < 10; i += 1) {
    mock.timers.tick(5000);
    ws.deliver(new Uint8Array(60).buffer);
  }
  assert.equal(ws.pings.length, 0);
});

test("after the machine sleeps, the session is probed at once, and late timers do not kill it", (t) => {
  const { relay } = setup(t);
  const ws = latest();
  ws.accept();
  ws.deliver(new Uint8Array(60).buffer);

  mock.timers.setTime(Date.now() + 2 * 60 * 60 * 1000); // two hours asleep
  mock.timers.tick(0);
  assert.equal(ws.pings.length, 1, "probe on the first tick after waking");

  // The probe's own timer also fires late (throttled tab): probe again.
  mock.timers.setTime(Date.now() + 60000);
  mock.timers.tick(0);
  assert.equal(relay.state, "open");
  assert.equal(ws.pings.length, 2);
  ws.deliver("pong:x");
  mock.timers.tick(10000);
  assert.equal(relay.state, "open");
});

function fakeWindow() {
  const target = new EventTarget();
  target.document = new EventTarget();
  target.document.visibilityState = "visible";
  return target;
}

test("waking the page probes an open session and reconnects a waiting one", (t) => {
  const win = fakeWindow();
  const { relay } = setup(t, { window: win });
  latest().accept();
  win.document.visibilityState = "hidden";
  win.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(latest().pings.length, 0, "hiding does nothing");
  win.document.visibilityState = "visible";
  win.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(latest().pings.length, 1);

  latest().drop(1006);
  mock.timers.tick(0);
  latest().drop(1006); // refused; now waiting 2 s
  assert.equal(relay.state, "waiting");
  win.dispatchEvent(new Event("online"));
  assert.equal(relay.state, "connecting");
  assert.equal(FakeWebSocket.instances.length, 3);
});

test("close() ends the session and stops listening and reconnecting", (t) => {
  const win = fakeWindow();
  const { relay, events } = setup(t, { window: win });
  const ws = latest();
  ws.accept();
  relay.close();
  assert.deepEqual(ws.closedWith, { code: 1000, reason: "client closed" });
  assert.equal(relay.state, "closed");
  win.dispatchEvent(new Event("online"));
  mock.timers.tick(120000);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(events.closes, []);
});

test("a server that answers with another subprotocol is refused", (t) => {
  const { relay, events } = setup(t);
  latest().accept("something.else");
  assert.equal(relay.state, "closed");
  assert.match(events.closes[0].reason, /unexpected subprotocol/);
  assert.deepEqual(events.opens, []);
});

test("leaving the page closes the socket; coming back from the back/forward cache reconnects", (t) => {
  const win = fakeWindow();
  const { relay, events } = setup(t, { window: win });
  const ws = latest();
  ws.accept();
  win.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(ws.closedWith, { code: 1000, reason: "page hidden" });
  assert.equal(relay.state, "waiting");
  mock.timers.tick(120000);
  assert.equal(FakeWebSocket.instances.length, 1, "no reconnect while hidden");
  win.dispatchEvent(new Event("pageshow"));
  assert.equal(FakeWebSocket.instances.length, 2);
  latest().accept();
  assert.deepEqual(events.opens.at(-1), { reconnect: true });
});
