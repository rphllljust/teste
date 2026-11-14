import {defineConfig} from 'vite';
import vinext from 'vinext';
import {fileURLToPath} from 'node:url';

// Isolated Node build: NO Cloudflare Vite plugin, Sites auth plugin or Wrangler.
// D1 is intentionally unavailable; replacing it with a PostgreSQL adapter and
// independently verified sessions is mandatory before any business traffic.
const unsupportedCloudflareBinding = fileURLToPath(
  new URL('./infrastructure/railway/cloudflare-disabled.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [{find: 'cloudflare:workers', replacement: unsupportedCloudflareBinding}],
  },
  plugins: [vinext({nextConfig: {output: 'standalone'}})],
});
