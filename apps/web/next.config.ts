import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// The repo keeps a single .env at the root; Next.js only reads apps/web/.env*.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@post-lead/core", "@post-lead/db", "@post-lead/services"],
};

export default nextConfig;
