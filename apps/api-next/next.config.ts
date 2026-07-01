import path from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), "../..");

/**
 * API route handlers MUST use `export const runtime = 'nodejs'` (not Edge).
 * This backend uses pg, argon2, and other Node-only packages.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "@node-rs/argon2",
    "@upstash/qstash",
    "dotenv",
    "jose",
    "argon2",
  ],
  turbopack: {
    root: monorepoRoot,
    resolveExtensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
  },
  webpack: (config, { isServer }) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };

    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        "dotenv",
        "dotenv/config",
        "pg",
      ];
    }

    return config;
  },
};

export default nextConfig;