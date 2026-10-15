// Used by `cf deploy`: the scheduled relay probe (see src/index.ts).
// Secrets: PROBE_RELAY_TOKEN and BETTERSTACK_PROBE_HEARTBEAT_URL
// (`cf workers secrets update`, values from infra/.env.local).
import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "relaynet-probe",
    entrypoint,
    compatibilityDate: "2026-10-06",
    observability: { enabled: true },
    workersDev: false,
    env: {
      RELAY_URL: bindings.text("wss://relay.relaynet.network/"),
      PROBE_RELAY_TOKEN: bindings.secret(),
      BETTERSTACK_PROBE_HEARTBEAT_URL: bindings.secret(),
    },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
  },
});
