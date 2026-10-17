// Root ESLint config: one flat config for every workspace package (each package's `lint` script runs `eslint` from its
// own folder and ESLint finds this file by walking up). Modelled on Kawase's (tamion/eslint.config.mjs).
// Plan §5b: numbers live in @hako/config, @hako/networks and `*.config.*` (no-magic-numbers); import boundaries
// keep server-only packages out of client code, `next/*` out of @hako/cards, deep imports out of apps/web features
// and workspace packages out of the PayBox plugin.
import path from "node:path";

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import hako from "./lint-rules/index.mjs";

const ROOT = import.meta.dirname;
const NEXT_APPS = ["apps/web", "apps/docs"];
const ALL_CODE = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

/** Server-only packages (plan §5b): never in client components, the MCP view or anything the browser loads. */
const SERVER_ONLY_PACKAGES = [
  "@hako/env",
  "@hako/db",
  "@hako/auth",
  "@hako/paybox",
  "@hako/agent",
  "@hako/defi/server",
  "@hako/model",
];
const withSubpaths = (names) => names.flatMap((name) => [name, `${name}/*`]);
const SERVER_ONLY_BAN = {
  group: [...withSubpaths(SERVER_ONLY_PACKAGES), "server-only"],
  message: "Server-only package: not allowed in client code (plan §5b import boundaries).",
  allowTypeImports: true,
};
const NEXT_BAN = {
  group: ["next", "next/*"],
  message: "@hako/cards renders inside MCP hosts too: no next/* imports (pass links and images through CardHost).",
};
/** The gateway's and CLI's entry of @hako/env and @hako/paybox skip the `server-only` guard: Next code takes the guarded root. */
const NODE_ENTRY_BAN = {
  group: ["@hako/env/node", "@hako/paybox/node"],
  message: "The /node entries are for the gateway and the CLI; Next code imports the package root (it carries import 'server-only').",
};
const PLUGIN_BAN = {
  group: ["@hako/*"],
  message:
    "The PayBox plugin imports only the plugin-safe sources by relative path (packages/{config,networks,money}/src, packages/defi/src/core), never a workspace package.",
};
const PLUGIN_SAFE_BANS = [
  {
    regex: "^[^.]",
    allowTypeImports: true,
    message: "Plugin-safe sources have no runtime imports (the plugin bundles them by relative path): `import type` only.",
  },
  { regex: "(^|/)\\.\\./\\.\\./", message: "Plugin-safe sources don't import each other or anything outside their own src." },
];
const restrict = (...patterns) => ({
  "no-restricted-imports": "off",
  "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
});

/** eslint-config-next's flat config, scoped to the two Next apps (it defaults to every file). */
const nextForApps = nextCoreWebVitals
  .filter((config) => !(config.ignores && Object.keys(config).length === 1))
  .map((config) => ({
    ...config,
    files: NEXT_APPS.flatMap((app) => (config.files ?? [ALL_CODE]).map((pattern) => `${app}/${pattern}`)),
  }));
const reactHooksPlugin = nextCoreWebVitals.find((config) => config.plugins?.["react-hooks"])?.plugins["react-hooks"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/.source/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "apps/*/public/**",
    "context/**",
    "refs/**",
    "docs/**",
    ".firecrawl/**",
    ".claude/**",
    "**/.venv/**",
  ]),
  ...tseslint.configs.recommended,
  ...nextForApps,
  {
    // Both apps use the App Router only: there is no pages/ directory for this rule to read.
    files: NEXT_APPS.map((app) => `${app}/**`),
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    plugins: { hako },
    rules: {
      "no-magic-numbers": "off",
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "hako/no-server-only-in-client": ["error", { packages: SERVER_ONLY_PACKAGES }],
    },
  },
  {
    // Constant modules are where numbers live (plan §5b); feature-local numbers go in that feature's `*.config.ts`.
    files: ["packages/config/**", "packages/networks/src/**", "**/*.config.*"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
  {
    // Installed registry components (shadcn, 21st.dev) keep their authors' code style: layout numbers and loose types
    // are not rewritten. Code written for Hako next to them (one folder up) follows the full rule set.
    files: ["packages/ui/src/components/ui/**"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // PayBox's starter 1.0.2 proposal helpers, kept byte-for-byte (plan §5 "unchanged src/paybox.ts").
    files: ["plugins/paybox/src/paybox.ts"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
  {
    // React code outside the Next apps: hooks run in the same order on every render.
    files: ["packages/{cards,ui,brand,identity}/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooksPlugin },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // Next code takes the guarded package roots.
    files: ["apps/web/**", "apps/docs/**"],
    rules: restrict(NODE_ENTRY_BAN),
  },
  {
    // Client-only folders ("use client" files can't be found by glob; hako/no-server-only-in-client reads the directive).
    files: ["packages/ui/**", "packages/brand/**", "packages/identity/**", "apps/web/src/features/*/components/**", "apps/docs/**"],
    rules: restrict(SERVER_ONLY_BAN, NODE_ENTRY_BAN),
  },
  {
    // The card library runs in /agent and in the MCP Apps view inside Claude, ChatGPT, Cursor and VS Code.
    files: ["packages/cards/**"],
    rules: restrict(SERVER_ONLY_BAN, NODE_ENTRY_BAN, NEXT_BAN),
  },
  {
    files: ["apps/web/src/**"],
    rules: { "hako/feature-boundaries": ["error", { featuresDir: path.join(ROOT, "apps/web/src/features") }] },
  },
  {
    files: ["packages/config/src/**", "packages/networks/src/**", "packages/money/src/**", "packages/defi/src/core/**"],
    rules: restrict(...PLUGIN_SAFE_BANS),
  },
  {
    files: ["plugins/paybox/src/**"],
    rules: restrict(PLUGIN_BAN),
  },
]);
