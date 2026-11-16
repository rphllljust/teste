import { mkdirSync } from "node:fs";
import path from "node:path";
import { configureRestrictedRailwayWorkerBindings } from "./railway-wrangler-bindings.mjs";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime");

process.env.CLOUDFLARE_CF_FETCH_ENABLED ||= "false";
process.env.WRANGLER_SEND_METRICS ||= "false";
process.env.WRANGLER_WRITE_LOGS ||= "false";
process.env.WRANGLER_LOG_PATH ||= path.join(runtimeRoot, "wrangler/logs");
process.env.WRANGLER_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/registry");

process.chdir(projectRoot);
for (const directory of [
  path.dirname(process.env.WRANGLER_LOG_PATH),
  process.env.WRANGLER_REGISTRY_PATH,
  process.env.MINIFLARE_REGISTRY_PATH,
]) {
  mkdirSync(directory, { recursive: true });
}

// Opt-in applies only to the isolated, read-only Railway RC. Never write
// secrets into Wrangler JSON; it receives a scoped list of binding names.
if (process.env.CISNE_RAILWAY_WORKER_BINDINGS === 'restricted') {
  const count = configureRestrictedRailwayWorkerBindings(
    path.join(projectRoot, 'dist/server/wrangler.json'), process.env);
  console.info(JSON.stringify({ event: 'cisne.wrangler.bindings.scoped', count }));
}
