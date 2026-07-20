import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const isVercelBuild = Boolean(process.env.VERCEL) || process.env.npm_lifecycle_event === "build:vercel";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        assetPrefix: "/POA",
        basePath: "/POA",
        images: { unoptimized: true },
        output: "export" as const,
        trailingSlash: true,
      }
    : {}),
  // Vercel type-checks the Next.js surface only. The default tsconfig remains
  // available to the existing Cloudflare/Vinext deployment.
  typescript: isVercelBuild || isGitHubPages
    ? { tsconfigPath: "./tsconfig.vercel.json" }
    : undefined,
};

export default nextConfig;
