// Build-time config consumed by Wrangler through `cf deploy`: only the asset
// source lives here. Runtime behavior and the custom domain are in
// cloudflare.config.ts.
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  assetsDirectory: "./public",
});
