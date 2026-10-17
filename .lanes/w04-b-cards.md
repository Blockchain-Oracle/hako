# W0.4 (b) — cards contract, schemas, agent registry — notes

Branch `w04/b-cards` (cut from `origin/w04/foundation` ff56034). Owned: `packages/cards/**`, `packages/agent/**`.
Gates green from the worktree root: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build`
(13/13 lint, 13/13 typecheck, 4/4 build). No plugin-safe source touched, so no plugin gate. Python untouched.

## What exists now
| Path | What |
|---|---|
| `packages/cards/src/contract/primitives.ts` | CAIP-2 (template literal = `@hako/networks` `Caip2`), atomic / decimal / USD strings, ISO time, https URL, EVM + Solana address and tx hash, `TokenRef`, `TokenAmount` (`usd` null when unknown), `WalletRef`, `TxLink`, catalog `Price`. |
| `contract/{phase,request-status,intent}.ts` (extended, not duplicated) | `MOVE_STAGES` (approval → funding → signing → sending → sent → arriving → confirmed / reverted / refused), `MONEY_MOVED` (no/yes/unknown), `REQUEST_WAITS` + `requestWaitsOn`, `pendingRequestStage`, `DRAFT_KINDS` (= `@hako/paybox` `DraftKind`), `draftRefSchema`. |
| `contract/envelope.ts` | `structuredContent.envelope`: phase, intent, PayBox request ref (approvalUrl, `/sign/<id>` signUrl), catalog run source, receipt line, blocked + one named fix (`CARD_FIXES`), inside-your-limits chip, `suggestions[]` (≤ 3 chips), `updatedAt`. `cardActionSchema` (link / tool / prompt). |
| `contract/kinds/*` | 49 kinds. **Catalog (connector-made, snake_case, loose):** the 15 existing (`reading.ts`, `facts.ts`), C18 data kinds `market audio yield model_bench balance token tx_receipt block gas contract_read logs`, plus `positions` (Earn positions) and `chain_name` (ENS / Basename). **Hako-made (camelCase, strict):** `route`, `route_race`, `pay`, `send_draft`, `swap_draft`, `bridge_draft`, `earn_deposit_draft`, `earn_withdraw_draft`, `status`, `receipt`, `failure`, `invoice`, `activity`, `passport`, `contact`, `portfolio`, `receive`, `fund`, `limit`, `catalog` (discover), `tool` (inspect). |
| `contract/registry.ts` | `CATALOG_SCHEMAS` / `HAKO_SCHEMAS` / `CARD_SCHEMAS`, `CardKind`, `CardData<K>`, `structuredContentSchema(kind)`, `structuredContentUnion(kinds)`, `anyStructuredContentSchema`, `StructuredContent<K>`, `CARD_REGISTRY` (kind → {kind, schema, origin}; L3 adds components), `DRAFT_CARD_KINDS`. |
| `contract/host.ts` | `CardHost` (runTool, sendPrompt, openLink, requote, complete, density), `CardDensity` `full | inline`, `draftEditSchema` (the in-place edit). |
| `contract/tools.ts` | `MODEL_TOOL_NAMES` (20), `APP_TOOL_NAMES` (4), `HakoToolName`, visibility and auth unions. |
| `contract/gateway/{endpoints,money-schemas,read-schemas}.ts` | `GATEWAY_ENDPOINTS`: 38 routes, each with method, path, zod params / query / body / response, response type (json / ndjson / binary), x402 flag, auth (`none` / `hako`). Covers health, version, catalog, discover, inspect, endpoints/:p/:s, validate, `/.well-known/x402`, `/v2/run`, `/v1/batch`, `/v2/batch/:batchId`, `POST/GET /v1/invoices`, `/v2/invoice/:id`, `/v1/files/:id`, `/v1/logo`, `/v1/quote`, `/v1/routes` (NDJSON snapshots), `/v1/bridge`, `/v1/bridge/status`, `/v1/earn/{deposit,withdraw,vaults,positions}`, `/v1/rehearse`, `/v1/broadcast`, `GET/POST /v1/receipts`, `GET /v1/receipts/:id`, `/v1/markets`, `/v1/chain/{balance,token,tx,block,gas,call,logs,name}`. `READ_ALIAS_CONNECTORS` fixes the connector id each read alias forwards to (`chain-evm/*`, `chain-solana/*`, `hako/markets`, `lifi-earn/{vaults,positions}`). |
| `packages/cards/src/client/` (`@hako/cards/client`) | `createGatewayClient({baseUrl = HAKO_GATEWAY_URL, fetch, bearer, timeoutMs})`: `call` (json), `stream` (NDJSON async generator), `bytes` (binary), `url` (paid URLs, file links). Requests and responses checked against the table; `GatewayError` (the gateway's error envelope), `GatewayPaymentRequired` (402 + challenge; it never pays), `GatewayContractError`; `redirect: 'error'`; GATEWAY_TIMEOUT_MS, route race 8 s + grace. |
| `packages/cards/scripts/schemas.ts`, `schemas/` | `pnpm --filter @hako/cards schemas` writes `schemas/<kind>.json` (zod JSON Schema, draft 2020-12, output shape, `$id https://usehako.xyz/schemas/cards/<kind>.json`) + `schemas/index.json` (kind, file, origin); `schemas:check` fails when a committed file is stale. 50 files committed. |
| `packages/agent` (`@hako/agent`, `./node`) | Root `import 'server-only'`; `./node` for the gateway's hosted MCP and `hako mcp`. `HAKO_TOOLS` keyed by the contract's names (missing / extra / misnamed tool fails typecheck), `listTools(visibility)`, `getTool`, `streamTool` / `runTool` (auth → input parse → execute → every card parsed by the output schema). `AgentDeps` (`deps.ts`), `AgentToolError` codes, `card()` / `chip()` builders, `defineTool`. |

## The registry (plan E30)
Model-visible (20): `hako_discover`, `hako_inspect`, `hako_run` (pay card; validates the input free first), `hako_markets`,
`hako_chain_read` (`op`: balance, token, tx, block, gas, call, logs, name), `hako_portfolio`, `hako_activity`,
`hako_passport`, `hako_contacts`, `hako_fund` (buy / deposit / receive), `hako_limit`, `hako_draft_send`, `hako_draft_swap`,
`hako_draft_bridge`, `hako_draft_earn_deposit`, `hako_draft_earn_withdraw`, `hako_draft_invoice`, `hako_execute`,
`hako_receipt`, `hako_broadcast`. App-only (4): `hako_draft_update`, `hako_routes` (async generator of race snapshots),
`hako_request_status`, `hako_refresh`. Auth per E32: `required` on execute, request_status, receipt, broadcast, portfolio,
activity, passport, contacts, fund, limit; `optional` elsewhere. Annotations: drafts and reads `readOnlyHint`,
`hako_execute` / `hako_broadcast` destructive + idempotent.

Deps (injected per request, nothing global): `gateway` (the client), `intents` (`MoneyIntents`), `drafts`
(`Pick<DraftStore,'getDraft'>`), `account` (`PayboxAccount`: list_credentials, get_portfolio, check_operation_readiness,
discover_plugins, get_buy_link, get_deposit_link, request_account_change, resolve_username, get_request — Hako-normalised
shapes), `contacts` (`ContactBook`), `user`, `appUrl`, `now`. Every execute calls one of these; none is stubbed.

## Verified
- The 15 existing kinds: synthetic outputs (every field, and required-only) generated from each of the 80 connectors'
  pydantic output schemas validate against the zod schemas **and** the generated JSON Schemas (160/160 both).
- Live gateway (`https://hako-api.84.46.247.92.sslip.io`): `health`, `version`, `catalog` (80 endpoints, 33 providers)
  parse; `hako_discover` / `hako_inspect` run end to end through `runTool` (paidUrl built from the table); a bad input
  → `GatewayError` 422; an unpaid valid `/v2/run` → `GatewayPaymentRequired` with the challenge; anonymous
  `hako_portfolio` → `auth_required`. The catalog check caught real drift (provider `licence` / `attribution` /
  `docsUrl` are null in hako-api) and the schema now accepts it.
- Every tool's input (io input) and output exports to JSON Schema (AI SDK / MCP `outputSchema`).
- Compile-time: `DraftQuote` = `draftQuoteSchema`, `Rehearsal` = `rehearsalSchema`, `DraftKind` = `DRAFT_KINDS`
  (`packages/agent/src/contract-checks.ts`).

## Decisions
- **Client in `@hako/cards/client`, not `./contract`:** `@hako/paybox` type-imports `@hako/cards/contract` under lib ES2022
  only; a fetch client in the contract entry broke its typecheck. The contract stays pure zod + types.
- **Connector kinds are loose and snake_case** (L2's Python models, `exclude_none` → absent = unknown); Hako kinds strict
  camelCase. JSON Schemas of connector kinds allow extra properties; Hako kinds don't.
- **Read aliases are POST with the connector input as body** (snake_case); money routes are Hako camelCase.
- **`route` carries every `DraftQuote` field under the same name**, so @hako/defi's normalised quote can be the route.
- **`hako_draft_invoice` creates the open invoice** (`POST /v1/invoices`): an unpaid invoice moves no money, like a draft
  row; it keeps the `readOnlyHint` drafts have.
- **Passport gas:** native balance on the executable chain (Base / Solana) from `get_portfolio`; "Top up gas" is offered as
  a PayBox `request_swap` prompt only when `check_operation_readiness` (SP12's swap object) says it can run, otherwise
  "Add ETH" via `get_buy_link`.
- **Activity** = `/v1/receipts` rows, pending rows re-read with `get_request` (≤ `ACTIVITY_LIVE_REFRESH_MAX`).
- No parameter properties in classes (Node type stripping can run these sources).

## Open (for the coordinator / later lanes)
- **ESLint:** add `@hako/agent/node` to `NODE_ENTRY_BAN` in `eslint.config.mjs` (Next code must take the guarded root).
- **`DraftStatus` has no result payload:** a paid run's or invoice payment's x402 response body (the result envelope) has
  no field in `@hako/paybox`'s `DraftStatus` / `ExecuteResult`; W0.6 should add one (or a receipt id) so the pay card can
  become its result card.
- **`PayboxAccount` lives in `@hako/agent/src/deps.ts`**; `@hako/paybox` (agent c / W0.6) implements it (or the
  coordinator moves the interface there at merge). `resolve_username`'s live output shape is unrecorded (SP5 / L4).
- `@hako/paybox`'s `DraftQuote` / `Rehearsal` could become `z.output<typeof draftQuoteSchema>` / `rehearsalSchema` at merge
  (one source); today the compile-time checks keep them equal.
- `apps/web` does not list `@hako/cards` / `@hako/agent` yet (shared wiring: coordinator / L3).
- L1 implements every route in `GATEWAY_ENDPOINTS` (invoice min–max is L1's lane constant); L2 registers the connector ids
  in `READ_ALIAS_CONNECTORS` as free tools whose inputs accept the alias request schemas.
