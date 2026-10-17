# W0.4 (b) — cards contract, schemas, agent registry — notes

Branch `w04/b-cards` (cut from `origin/w04/foundation` ff56034). Owned: `packages/cards/**`, `packages/agent/**`.
Gates green from the worktree root: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build`
(13/13 lint, 13/13 typecheck, 4/4 build). No plugin-safe source touched, so no plugin gate. Python untouched.
`pnpm typecheck` now also runs `@hako/cards`' `schemas --check` (stale schema files fail) and `@hako/agent`'s
`tool-schemas` (a tool schema whose root is not a plain object fails).

## What exists now
| Path | What |
|---|---|
| `packages/cards/src/contract/primitives.ts` | CAIP-2 (template literal = `@hako/networks` `Caip2`), atomic / decimal / USD strings, ISO time, https URL, EVM + Solana address and tx hash, `TokenRef`, `TokenAmount` (`usd` null when unknown), `WalletRef`, `TxLink`, catalog `Price`. |
| `contract/{phase,request-status,intent}.ts` (extended, not duplicated) | `MOVE_STAGES` (approval → funding → signing → sending → sent → arriving → confirmed / reverted / refused), `MONEY_MOVED` (no/yes/unknown), `REQUEST_WAITS` + `requestWaitsOn`, `pendingRequestStage`, `payboxServiceOutputSchema` (`use_service`'s documented success output `value.response = {status, content_type, body}`), `DRAFT_KINDS` (= `@hako/paybox` `DraftKind`), `draftRefSchema`. |
| `contract/envelope.ts` | `structuredContent.envelope`: phase, intent, PayBox request ref (approvalUrl, `/sign/<id>` signUrl), catalog run source, receipt line (`payment`), blocked + one named fix (`CARD_FIXES`, incl. `change_network` for R17), `namedFixSchema` ({fix, action}), inside-your-limits chip, `suggestions[]` (≤ 3 chips), `updatedAt`. `cardActionSchema` (link / tool / prompt). |
| `contract/kinds/*` | 49 kinds. **Catalog (connector-made, snake_case, loose):** the 15 existing (`reading.ts`, `facts.ts`), C18 data kinds `market audio yield model_bench balance token tx_receipt block gas contract_read logs`, plus `positions` (Earn positions) and `chain_name` (ENS / Basename). **Hako-made (camelCase, strict):** `route`, `route_race`, `pay`, `send_draft`, `swap_draft`, `bridge_draft`, `earn_deposit_draft`, `earn_withdraw_draft`, `status`, `receipt` (with `surface`), `failure`, `invoice`, `activity` (rows from receipts or PayBox requests; `kind` null for a request, `fix`), `passport`, `contact` (`verified` action), `portfolio`, `receive`, `fund`, `limit`, `catalog` (discover), `tool` (inspect). `RECEIPT_STATUSES`, `ACTIVITY_SURFACES` live in `outcome.ts`. |
| `contract/registry.ts` | `CATALOG_SCHEMAS` / `HAKO_SCHEMAS` / `CARD_SCHEMAS`, `CardKind`, `CardData<K>`, `structuredContentSchema(kind)`, `structuredContentUnion(kinds)` (an **object** root: `{kind: enum, data: union, envelope}` + a refinement parsing `data` with the named kind's schema), `anyStructuredContentSchema`, `StructuredContent<K>`, `CARD_REGISTRY`, `DRAFT_CARD_KINDS`, `OUTCOME_CARD_KINDS` (status, failure, receipt, invoice, every catalog kind). |
| `contract/host.ts` | `CardHost` (runTool, sendPrompt, openLink, requote, complete, density), `CardDensity` `full | inline`, `draftEditSchema` (the in-place edit). |
| `contract/tools.ts` | `MODEL_TOOL_NAMES` (20), `APP_TOOL_NAMES` (4), `HakoToolName`, visibility and auth unions. |
| `contract/gateway/{endpoints,money-schemas,read-schemas}.ts` | `GATEWAY_ENDPOINTS`: 39 routes, each with method, path, zod params / query / body / response, response type (json / ndjson / binary), x402 flag, auth (`none` / `hako`). Covers health, version, catalog, discover, inspect, endpoints/:p/:s, validate, `/.well-known/x402`, `/v2/run`, `/v1/batch`, `/v2/batch/:batchId`, `POST/GET /v1/invoices`, `/v2/invoice/:id`, `/v1/files/:id`, `/v1/logo`, `/v1/quote`, `/v1/routes` (NDJSON snapshots), `/v1/bridge`, `/v1/bridge/status`, `/v1/earn/{deposit,withdraw,vaults,positions}`, `/v1/rehearse`, `/v1/broadcast` (optional `draft` expectation for CLI drafts), `GET/POST /v1/receipts` (filters kind/status/chain/surface/draftId), `GET /v1/receipts/shared` (anonymous), `GET /v1/receipts/:id`, `/v1/markets`, `/v1/chain/{balance,token,tx,block,gas,call,logs,name}`. `READ_ALIAS_CONNECTORS` fixes the connector id each read alias forwards to. |
| `packages/cards/src/client/` (`@hako/cards/client`) | `createGatewayClient({baseUrl = HAKO_GATEWAY_URL, fetch, bearer, timeoutMs})`: `call` (json), `stream` (NDJSON async generator), `bytes` (binary), `url`, `authenticated()` (a bearer is present). `endpointUrl(baseUrl, key, location)` builds a route URL on any origin (public paid URLs). `GatewayError`, `GatewayPaymentRequired` (402 + challenge; it never pays), `GatewayContractError`; `redirect: 'error'`. |
| `packages/cards/scripts/schemas.ts`, `schemas/` | `pnpm --filter @hako/cards schemas` writes `schemas/<kind>.schema.json` (zod JSON Schema, draft 2020-12, output shape, `$id ${HAKO_APP_URL}/schemas/cards/<kind>.schema.json`) + `schemas/index.json`; exports `./schemas/index.json` and `./schemas/*.schema.json`. 50 files committed. |
| `packages/agent` (`@hako/agent`, `./node`) | Root `import 'server-only'`; `./node` for the gateway's hosted MCP and `hako mcp`. `HAKO_TOOLS`, `listTools`, `getTool`, `streamTool` / `runTool`. `AgentDeps` (`deps.ts`), `AgentToolError` (codes incl. `stale_version` carrying the latest `card`), `card()` / `chip()`, `defineTool`. `outcomes.ts` (outcome cards), `activity.ts` (the ledger), `scripts/tool-schemas.ts` (root-type check). |

## The registry (plan E30)
Model-visible (20): `hako_discover`, `hako_inspect`, `hako_run` (pay card; validates the input free first), `hako_markets`,
`hako_chain_read` (`op`: balance, token, tx, block, gas, call, logs, name, earn_vaults, earn_positions), `hako_portfolio`,
`hako_activity` (filters kind / status / chain / surface), `hako_passport`, `hako_contacts` (list, add, rename, delete,
resolve, verify), `hako_fund` (buy / deposit / receive), `hako_limit`, `hako_draft_send`, `hako_draft_swap`,
`hako_draft_bridge`, `hako_draft_earn_deposit`, `hako_draft_earn_withdraw`, `hako_draft_invoice`, `hako_execute`,
`hako_receipt`, `hako_broadcast`. App-only (4): `hako_draft_update` (`{draftId, version, edit}`), `hako_routes`
(`{draftId, version}`, async generator of race snapshots), `hako_request_status`, `hako_refresh`. `hako_execute`,
`hako_request_status` and `hako_broadcast` answer with `OUTCOME_CARD_KINDS`; `hako_refresh` with pay, drafts and those.
Auth per E32: `required` on execute, request_status, receipt, broadcast, portfolio, activity, passport, contacts, fund,
limit; `optional` elsewhere. Annotations: drafts and reads `readOnlyHint`, `hako_execute` / `hako_broadcast` destructive
+ idempotent.

Deps (injected per request, scoped to the caller, nothing global): `gateway` (the client), `publicGatewayUrl` (paid URLs;
HAKO_GATEWAY_URL by default), `intents` (`MoneyIntents`, creating drafts owned by the caller), `drafts` (`DraftReader`:
`getDraft(id) → {view, ownerUserId} | null`, only the caller's drafts), `account` (`PayboxAccount`: list_credentials,
get_portfolio, check_operation_readiness, discover_plugins, get_buy_link, get_deposit_link, request_account_change,
resolve_username, get_request, list_requests), `contacts` (`ContactBook` incl. `verify`), `user`, `appUrl`, `now`.

## Verified
- The 15 existing kinds: synthetic outputs (every field, and required-only) generated from each of the 80 connectors'
  pydantic output schemas validate against the zod schemas **and** the generated JSON Schemas (160/160 both).
- Live gateway (`https://hako-api.84.46.247.92.sslip.io`): `health`, `version`, `catalog` (80 endpoints, 33 providers)
  parse; `hako_discover` / `hako_inspect` run end to end through `runTool`; a bad input → `GatewayError` 422; an unpaid
  valid `/v2/run` → `GatewayPaymentRequired` with the challenge; anonymous `hako_portfolio` → `auth_required`.
- Review round 1 (scratch harness against the real code, live gateway for the free tools, nothing committed):
  `tool-schemas` passes for all 24 tools (input io input, output io output); a union output accepts `failure` data under
  `kind: failure` and refuses it under `kind: status`; `hako_chain_read {op: balance}` without `address` is refused by the
  schema, `earn_vaults` parses without a chain, `block` on Solana and any `bip122:` chain are refused; an EVM sender on
  Solana and a bridge to an unknown name are refused with words; `hako_inspect`'s `paidUrl` is built on
  `publicGatewayUrl`; an anonymous `hako_draft_update` on a user's draft → `auth_required`; outcome cards from PayBox's
  documented `use_service` output: a paid run → its `weather` card with `envelope.payment` ($0.005) and `source`; a
  limit denial → `failure` "Your agent stopped at your limit", money moved `no`, fix `raise_limit`; a send `error` →
  money moved `unknown`; a swap sign `error` → `no`; `pending_approval` → status stage `approval`; send `success` →
  stage `confirmed`.
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
- **Activity** = `/v1/receipts` rows (with a Hako session) merged with PayBox `list_requests` rows that have no receipt;
  `list_requests` alone without a session (`hako mcp`); live rows re-read with `get_request` (≤ `ACTIVITY_LIVE_REFRESH_MAX`).
- No parameter properties in `@hako/cards` / `@hako/agent` classes. `@hako/money`'s `AmountError` has them, so the agent's
  `tool-schemas` check runs with `node --experimental-transform-types` (Node ≥ 22.7; the repo requires ≥ 24).

## Review fixes (round 1)
Each finding as the reviewer gave it, then what changed.

1. **Tool schemas without `type: "object"` at the root** (`hako_chain_read`, `hako_contacts`, `hako_refresh` inputs;
   `structuredContentUnion` outputs). — Every input is now one `z.object`: `hako_chain_read` takes `op` (enum) plus the
   alias fields (their own zod shapes from `read-schemas.ts`) with a `superRefine` naming the fields each op needs;
   `hako_contacts` takes `action` + optional fields, checked per action; `hako_refresh` takes `target` + the matching id.
   `structuredContentUnion` returns `z.object({kind: z.enum(kinds), data: z.union(<kinds' data schemas>), envelope})`
   with a `superRefine` that parses `data` with `CARD_SCHEMAS[kind]` and an `overwrite` that keeps that parse (typed as
   `StructuredContentUnionSchema<K>` = exactly one of the cards). `packages/agent/scripts/tool-schemas.ts` exports every
   tool's input and output and fails on a root `type` other than `"object"` or a root `oneOf`/`anyOf`/`allOf`; it runs in
   `@hako/agent`'s `typecheck`, so the gate runs it.
2. **Card flow unreachable: execute/status/broadcast only output `status`; no `failure`; no `envelope.payment`; receiptId
   always null; `moneyMoved` dropped.** — New `src/outcomes.ts`: `outcomeCard(deps, view, run)` is what `hako_execute`,
   `hako_request_status`, `hako_broadcast` and `hako_refresh` answer with (`OUTCOME_CARD_KINDS`: status | failure |
   receipt | invoice | every catalog kind, one object-rooted schema). A run at `success`: `getRequest(requestId).output` is
   read with `payboxServiceOutputSchema` (PayBox's documented `value.response = {status, content_type, body}`, body parsed
   when it is JSON text), `body` with `anyRunEnvelopeSchema`, and the render kind's card comes back (unknown kind or data
   that doesn't fit → `json`) with `envelope.source = sourceOf(env)` and `envelope.payment` = {the price frozen on the
   version in Base USDC, the receipt's tx when one exists, the request id}; a non-2xx paid answer is a failure with money
   moved `no` (the gateway settles x402 only on success). `invoice_pay` at success → the paid `invoice` card with its
   payment line. `denied` / `error` / failed / rejected → `failure` with `moneyMoved` (`no` for a denial; `unknown` for
   `unknown_outcome`, for a send's error (PayBox sends a transfer itself) or when a tx exists; `no` for a wallet-sign or
   x402 error) and one fix (raise limit for a limit denial, fresh quote for a move, run again for a payment).
   `hako_broadcast`'s `refused` → `failure` with the route's `moneyMoved` ("Signed but not sent"); `sent` → status at stage
   `sent`. `receiptsQuerySchema` gained `draftId` (and `kind`): a finished move looks up its own receipt
   (`?draftId=&kind=`) and turns into the `receipt` card once it confirms or reverts; while it settles the status card
   carries its `receiptId`.
3. **`hako_activity` reads only `/v1/receipts`; no `list_requests`; throws in `hako mcp`; no filters; no `surface`.** —
   `PayboxAccount.listRequests: PayboxCaller['listRequests']`. New `src/activity.ts`: receipts are read only when
   `gateway.authenticated()` (new client method); PayBox requests with no receipt are merged in (with a session,
   successful requests are left to their receipts; without one, `list_requests` is the whole ledger); a limit denial row
   reads "Your agent stopped at your limit" with fix `raise_limit` (`activityRowSchema.fix`); `kind` is null for request
   rows. One opaque cursor carries both sources' positions. `receiptDataSchema.surface` added (`toRow` uses it);
   `receiptsQuerySchema` gained optional `kind`, `status`, `chain`, `surface`; `hako_activity` takes them (request rows
   only match a status filter).
4. **No public listing of shared receipts for the landing proof.** — `receiptsShared: GET /v1/receipts/shared`, auth
   `none`, `{cursor, limit}` → `receiptsPageSchema`. It sits before `receiptGet` in the table with a note: L1 registers it
   before `/v1/receipts/:id`.
5. **`/v1/broadcast` can't check a CLI-signed tx against a draft it never stored.** — `broadcastExpectationSchema`:
   `{kind, tx: {family: evm, chainId, from, to, data, value} | {family: solana, signer, messageBase64}, reviewed:
   bridgeRequestSchema | earnMoveRequestSchema | null}`; `broadcastRequestSchema.draft` is optional, documented as used
   when `(draftId, version)` isn't in `@hako/db` and refused when missing there.
6. **Draft addresses never checked; `edit.to` used raw; `familyOf` treats every non-solana namespace as EVM.** —
   `familyOf` reads the CAIP-2 namespace (`eip155` → evm, `solana` → solana) and refuses any other; `resolveChain`
   refuses other namespaces too. `senderFor` checks a given address against the family's schema and, for a signed-in user,
   requires one of `account.credentials().wallets` (else `paybox_not_connected` / invalid input). `resolveRecipient`
   names the family mismatch. `nextRoute` resolves `edit.to` through `resolveRecipient`; a bridge's `to` goes through
   `resolveRecipient` too (contact, username or address of the destination family), the user's wallet when absent.
7. **R17 not applied: drafts from Ethereum/Arbitrum get an action button.** — `executableBlock(view)` in `draft-cards.ts`
   (source chain from `draftChains`, `isExecutableCaip2`): every draft card off the list carries `envelope.blocked`
   {"Hako can't move money from Ethereum yet", fix `change_network` (new in `CARD_FIXES`), action `hako_draft_update`
   with `{chain|fromChain: base}` at that version}. Drafts, edits and refreshes all draw through `draftCard`, and
   `hako_execute` refuses a blocked draft before calling the money core. The move tools' descriptions say it.
8. **Edits take only a draftId: anyone with an id edits someone's draft; no base version.** — `hako_draft_update` takes
   `{draftId, version, edit}` and `hako_routes` `{draftId, version}`; `loadDraftVersion` refuses a version that isn't the
   latest with `stale_version` ("This card is out of date") carrying the latest card (`AgentToolError.card`).
   `AgentDeps.drafts` is a `DraftReader` returning `{view, ownerUserId}` for the caller's drafts only; `loadDraft`
   refuses an anonymous caller on a user's draft (`auth_required`) and hides it from other users; `AgentDeps` documents
   that drafts and intents are scoped to the caller. Every tool that reads a draft goes through `loadDraft`.
9. **No tool produces `yield` / `positions`.** — `hako_chain_read` ops `earn_vaults` (`/v1/earn/vaults`: chain, token,
   sort, limit) and `earn_positions` (`/v1/earn/positions`: address, chain) → `yield` / `positions` cards with
   `envelope.source`.
10. **`hako_execute` checks only `requireUser`.** — `requireAccount` in `hako_execute`, `hako_request_status` and
    `hako_broadcast`, so PayBox-not-connected maps to the Connect PayBox gate.
11. **Unused `@paybox-sh/sdk` devDependency.** — Removed; `pnpm install` dropped 61 packages (lockfile −644 lines; the
    remaining additions are `@types/node` for the agent's script).
12. **`schemas/package.json` looks like a package manifest; `$id` hard-codes the domain.** — Files are
    `schemas/<kind>.schema.json`; `$id` = `${HAKO_APP_URL}/schemas/cards/<kind>.schema.json`; `index.json` lists the new
    names; exports `./schemas/index.json` and `./schemas/*.schema.json`; `schemas --check` runs in `typecheck`.
13. **Paid URLs built from the injected client's (maybe internal) baseUrl.** — `AgentDeps.publicGatewayUrl` (default
    HAKO_GATEWAY_URL) and `paidRunUrl(deps, doc)` over the new `endpointUrl(baseUrl, key, location)`; `deps.gateway` is
    used only for calls.
14. **Send at `success` read as `sent`.** — `confirmed`, like runs: PayBox documents `success` on an on-chain request as
    "confirmed on-chain, never merely broadcast" (context/01-paybox-platform/request-lifecycle.md). The comment on
    `stageOf` names SP5 (not yet recorded) as the check: if `request_transfer` turns out broadcast-only, sends move back
    to `sent`.
15. **Contacts can never become verified.** — `ContactBook.verify(id)`, `hako_contacts` action `verify` `{id, qrPayload}`
    (the text the scan read: a bare address or an `ethereum:`/`solana:` URI), verified only when the scanned address
    equals the saved one; `contactDataSchema.action` gained `verified`.
16. **(Coordinator) `@hako/agent/node` not in `NODE_ENTRY_BAN`.** — Outside this lane's paths: still open below.

## Open (for the coordinator / later lanes)
- **ESLint:** add `@hako/agent/node` to `NODE_ENTRY_BAN.group` in `eslint.config.mjs` (finding 16).
- **W0.6 / `@hako/db`:** drafts need an owner (Hako user id, or the anonymous session) so the surfaces can implement
  `DraftReader` (`getDraft → {view, ownerUserId}`, scoped to the caller) and `intents.createDraft` records it.
  `MoneyIntents.reviseDraft(id, patch)` takes no expected version: the agent refuses stale cards, but two edits racing
  between that check and the write can still both land; `reviseDraft` should pass the version to
  `DraftStore.appendVersion(id, expectedVersion, …)` (which already takes one).
- **A run's settlement tx on its receipt line:** PayBox's `use_service` output carries the paid body, not the x402
  settlement tx, and the gateway records the settlement without knowing the draft. `envelope.payment.tx` is filled when a
  receipt for the draft exists (`?draftId=`); L1 could link the two (e.g. record the PayBox request or draft on the
  settlement) so runs get their tx link too.
- **L1:** implement `GET /v1/receipts/shared` before `/v1/receipts/:id`, the receipt filters (`kind`, `status`, `chain`,
  `surface`, `draftId`) and `surface` on receipts, and the broadcast `draft` expectation for CLI drafts. **L6:** the CLI
  posts its signed tx with `draft` (`broadcastExpectationSchema`).
- **`PayboxAccount` lives in `@hako/agent/src/deps.ts`**; `@hako/paybox` (W0.6) implements it (or the coordinator moves
  the interface there at merge). `resolve_username`'s live output shape is unrecorded (SP5 / L4). SP5 also decides
  finding 14 (`request_transfer` success = confirmed).
- `@hako/paybox`'s `DraftQuote` / `Rehearsal` could become `z.output<typeof draftQuoteSchema>` / `rehearsalSchema` at merge
  (one source); today the compile-time checks keep them equal.
- `apps/web` does not list `@hako/cards` / `@hako/agent` yet (shared wiring: coordinator / L3).
- L1 implements every route in `GATEWAY_ENDPOINTS` (invoice min–max is L1's lane constant); L2 registers the connector ids
  in `READ_ALIAS_CONNECTORS` as free tools whose inputs accept the alias request schemas.
