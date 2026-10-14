// Used by `cf deploy`: deploys this directory as a Worker with static assets
// (the current Cloudflare Pages) and binds the apex custom domain.
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "relaynet",
    compatibilityDate: "2026-10-06",
    observability: { enabled: true },
    assets: {
      notFoundHandling: "404-page",
      htmlHandling: "auto-trailing-slash",
    },
    domains: ["relaynet.network"],
    workersDev: false,
  },
});
