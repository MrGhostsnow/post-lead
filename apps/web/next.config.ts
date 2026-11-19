import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@post-lead/core", "@post-lead/db", "@post-lead/services"],
};

export default nextConfig;
