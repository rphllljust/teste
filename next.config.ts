import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The isolated Railway build emits a self-hosted Node bundle. Do not
  // change the existing Sites/Cloudflare build behavior.
  ...(process.env.CISNE_BUILD_TARGET === 'railway' ? {output: 'standalone' as const} : {}),
};

export default nextConfig;
