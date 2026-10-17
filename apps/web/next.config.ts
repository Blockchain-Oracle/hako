import path from "node:path";

import type { NextConfig } from "next";

import { DOCS_URL } from "./src/lib/constants/site";

const REPO_ROOT = path.join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  // The workspace packages live above apps/web: trace from the repo root so the standalone server includes them.
  outputFileTracingRoot: REPO_ROOT,
  transpilePackages: ["@hako/brand"],
  // Next 16 writes AGENTS.md and CLAUDE.md on `next dev`; this repository carries no AI-tool files.
  agentRules: false,
  poweredByHeader: false,
  // One route file serves both spellings (macOS file systems are case-insensitive, so app/skill.md cannot coexist).
  rewrites: async () => [{ source: "/skill.md", destination: "/SKILL.md" }],
  redirects: async () => [
    { source: "/docs/:path*", destination: `${DOCS_URL}/docs/:path*`, permanent: false },
  ],
};

export default nextConfig;
