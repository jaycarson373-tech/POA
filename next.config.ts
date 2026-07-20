import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel type-checks the Next.js surface only. The default tsconfig remains
  // available to the existing Cloudflare/Vinext deployment.
  typescript: process.env.VERCEL
    ? { tsconfigPath: "./tsconfig.vercel.json" }
    : undefined,
};

export default nextConfig;
