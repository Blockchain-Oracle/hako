# W0.4 foundation — notes

Branch `w04/foundation` (cut from `origin/main` 410591d). Gates green from the worktree root:
`pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build`, and the plugin gate
(`plugins/paybox`, Node 24.21: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build`).
Smoke: gateway (built `dist/server.mjs` and `tsx src/server.ts`) on 8190 with `HAKO_API_URL` pointing at nothing →
`/v1/health` 200, `/v1/version` 200 (CDP keys + payTo parsed, mainnet `eip155:8453`), `/mcp` `tools/list` 200,
error envelopes unchanged. Web (`next start` and the standalone server) on 3110 → `/`, `/agent`, `/tools`,
`/api/health` 200; `Host: sandbox.usehako.xyz` → rewritten to `app/sandbox` (404 until L4); `/dev` 404 in production.

## What exists now
| Path | What |
|---|---|
| `pnpm-workspace.yaml` | globs `apps/*`, `packages/*`, `services/gateway`; every plan §3 JS pin in the catalog (all checked ≥ 7 days old on npm, 2026-10-17); `minimumReleaseAgeExclude: [@paybox-sh/sdk]`. No rainbowkit/wagmi entries existed to remove. |
| `eslint.config.mjs`, `lint-rules/` | the one flat config (see "Lint" below); every package's `lint` is `eslint src` / `eslint .`; root `pnpm lint` = `turbo run lint` + `lint:root` (the config itself, `lint-rules/`, `plugins/paybox/src`). |
| `packages/config` (`@hako/config`) | units, hosts (usehako.xyz + api/docs/sandbox, PayBox api/app/OAuth/MCP/agent-key, LI.FI api/earn, plugin network hosts, app paths, local dev URLs), timeouts (GATEWAY 7 s, LIFI 4.5 s, REHEARSAL 1.5 s, plugin op 10 s, route race 4 s/8 s, proposal expiry < 5 min), polling (request 1 s → 5 s ×2, intent 2 s), waits (draft settle 400 ms, skeleton 300 ms, elapsed after 3 s, still-waiting 15 s), cache (quote 15 s, batch 15 min, files 24 h, logo 24 h, Artificial Analysis 1 h), limits (batch 5, invoice note 140, bundle 10 MiB, 16 hosts, Solana 1,232 bytes/1 signer), `BASE_FEE_MULTIPLIER = 2n`, OAuth (PayBox scope/resource, S256, token TTL, `TOKEN_REFRESH_SKEW_S` 60, Hako scopes, CLI config dir), rate limits (§2), product names, voice model `gpt-realtime-2.1`. |
| `packages/networks` (`@hako/networks`) | Base, Ethereum, Arbitrum, OP Mainnet, Polygon, Solana: CAIP-2 (`solana:mainnet` as PayBox uses it, genesis form as alias), LI.FI ids/keys, explorers + `explorerTxUrl`/`explorerAddressUrl`, public RPCs (no Alchemy), native coin, USDC; lookups; R17 `EXECUTABLE_NETWORK_KEYS = [base, solana]`; R15 `LIFI_CONTRACT_ALLOWLIST` (LiFiDiamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` on all five EVM chains) + `isLifiContract`. Source: `https://li.quest/v1/chains?chainTypes=EVM,SVM` (`diamondAddress`) and `/v1/token?chain=<id>&token=USDC`, fetched 2026-10-17. |
| `packages/money` (`@hako/money`) | `toAtomic`/`fromAtomic`/`parseAtomic`/`rescaleAtomic`, `formatAtomic`/`formatTokenAmount`/`formatPrice`/`formatUsd` (Intl over exact decimal strings, U+2212 minus), `shortenAddress`/`shortenHash`/`sameAddress`, bps math (`feeFromBps`, `minReceived`, `shortfallBps`, `mulDiv(Up)`, `sumAtomic`, `netAfterFees`, `maxFeePerGas`). |
| `packages/env` (`@hako/env`) | zod schemas per consumer, lazy + cached (`loadWebEnv`, `loadGatewayEnv`, `loadCliEnv`, `loadCatalogProviderEnv`). Root = `import 'server-only'` (Next); `@hako/env/node` = same exports without the guard (gateway, CLI; `server-only` throws outside React's server condition). |
| `packages/cards` (`@hako/cards`, `./contract`) | `src/contract/{phase,request-status,intent}.ts` + zod schemas. |
| `packages/paybox` (`@hako/paybox`, `./node`) | `src/intents/types.ts` only: `MoneyIntents`, draft inputs per kind, `DraftQuote`, `Rehearsal`, `DraftStore`, `PayboxCaller`, `DraftPricer`, `MoneyIntentDeps`, `CreateMoneyIntents`. |
| lane files | `src/lanes/l1..l6.ts` (`export {};`) re-exported from `config`, `networks`, `money`, `env` (`node.ts`) and `cards/src/contract`. |
| `apps/web` | `app/(landing)/page.tsx`, `app/(app)/{layout.tsx,agent,tools}`, `app/sandbox/page.tsx` (404), `app/dev/layout.tsx` (404 in production), `src/proxy.ts` (sandbox host → `/sandbox/**`), `@source` for `packages/{cards,ui}/src`, `transpilePackages` = every `@hako/*` in the manifest, `features/{agent,landing,tools}/index.ts`, `lib/server/env.server.ts` → `@hako/env`. |
| `services/gateway` | `server.ts` builds the app (CORS, body cap, error envelope, listener) + `registerRoutes(app)` (`routes/index.ts`, catalog state in `routes/catalog-state.ts`) + `registerMcp(app)` (`mcp/index.ts`; old `mcp.ts` → `mcp/server.ts`); `config.ts` reads `@hako/env/node`; `errors.ts` holds `jsonError`. Behaviour unchanged. |

## Decisions
- **`.ts` import suffixes in the shared packages.** Turbopack does not resolve `./x.js` → `x.ts` inside transpiled
  workspace packages (the first web build failed on it), and NodeNext consumers (the plugin, the gateway) refuse
  extensionless relative imports. `./x.ts` works everywhere (Turbopack, esbuild, tsx, Vite, Node type stripping);
  `tsconfig.base.json` sets `allowImportingTsExtensions`. **L1: add `"allowImportingTsExtensions": true` to
  `plugins/paybox/tsconfig.json` when its `include` adds the plugin-safe folders** (verified: config/networks/money
  typecheck under the plugin's NodeNext settings with that flag and bundle with esbuild 0.28.2).
- **PayBox request statuses are the SDK's real set** (8 values, incl. `pending_funding`, `pending_settlement`,
  `pending_confirmation`); PayBox has no `expired`/`cancelled`. Hako's own outcomes live in the intent state
  (`canceled`, `expired`, Kawase's spelling) and the card phase (`cancelled`). `requestStatusToPhase` and
  `intentStateToPhase` map them (expired → `cancelled`: no money moved).
- **R17 executable list = Base and Solana** (the source chains the runbook validates); the other four stay
  quotable/readable until validated. The coordinator widens it after a portal validation + one real run.
- **Permit2Proxy is not on the LI.FI allowlist** (Hako uses exact approve + transfer, R16), fail closed.
- **no-magic-numbers ignore list stays the repo's `[-1, 0, 1, 2]`** (the old web/docs configs' set); only two
  existing numbers needed names (plugin `USDC_ATOMIC_PER_UNIT`, CLI `MAX_DISCOVER_LIMIT`). The starter's
  `plugins/paybox/src/paybox.ts` is exempt from the rule as vendored code (plan §5 "unchanged").
- **Root lint toolchain only:** `eslint-config-next` and `typescript-eslint` moved to the root; `@eslint/js` was not
  added (not a §3 pin), so `js.configs.recommended` is not part of the set.
- **`@hako/model` counts as server-only** in the client bans (it imports `server-only` already).
- **Money intents** take `payboxFor(userId)` (one caller per Hako user) and a `DraftPricer` beside the
  `DraftStore`; draft kinds include `run` and `invoice_pay` so paid runs and invoice payments get the same
  one-request-per-version rule as moves. `DraftQuote` is the minimal shape R15 needs; `@hako/defi`'s normalised
  quote should satisfy it (fold or re-point at merge).
- **Gateway `publicBaseUrl` default kept as `http://localhost:8080`** regardless of PORT (unchanged behaviour).

## Lint (eslint.config.mjs)
- no-magic-numbers off in `packages/config/**`, `packages/networks/src/**`, `**/*.config.*`,
  `packages/ui/src/components/ui/**` (registry rules relaxed there like Kawase); `max-lines` 400.
- Server-only packages (`@hako/env|db|auth|paybox|agent|model`, `@hako/defi/server`, `server-only`) banned
  (type imports allowed) in `packages/{cards,ui,brand,identity}/**`, `apps/web/src/features/*/components/**`,
  `apps/docs/**`, and in every `"use client"` module anywhere (`hako/no-server-only-in-client`).
- `@hako/cards` may not import `next/*`; Next apps may not import the `/node` entries.
- `hako/feature-boundaries`: outside `features/<name>/`, only `@/features/<name>` (its `index.ts`); relative
  paths into another feature are caught too.
- Plugin-safe sources (`packages/{config,networks,money}/src`, `packages/defi/src/core`): `import type` only, no
  `../../` escapes. `plugins/paybox/src`: no bare `@hako/*`.
- Each rule was probed with throwaway files (all fired; type-only imports passed).

## Open
- Invoice amount min–max (plan B13 "within the configured min–max") has no value in the plan: L1 picks it in its
  lane file.
- Receipt TTLs: receipts are durable `@hako/db` rows; only `FILE_TTL_S` (24 h) and `BATCH_TTL_S` are timed.
- `apps/cli` still reads `HAKO_API_URL` itself; `loadCliEnv` (`@hako/env/node`) is ready for L6.
- `@hako/paybox` and `@hako/env` need a `/node` entry whenever a server-only package is used from the gateway or CLI;
  agent (c) should follow the same pattern for `@hako/db`/`@hako/auth` if the gateway imports them.
