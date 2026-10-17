# Lane l1-plugin — PayBox plugin v2 (the frozen tool surface, plan §1 A1–A11)

Branch `lane/l1-plugin` (cut from `origin/main` 4f3d2e6). Owned: `plugins/paybox/**` (plus this note).
Plugin gate (Node 24.21.0, pnpm 11.11.0): `cd plugins/paybox && pnpm install --frozen-lockfile && pnpm test` →
unit tests (28 pass incl. the wire check with the workspace installed; skipped without it) + typecheck + two identical
builds + conformance against the live gateway: `status: passed`, 16 tools, sample `hako_discover`, bundle 442,813 bytes
(10 MiB cap). Verified on a fresh clone of the branch with no root install (same sha256).

## What exists now
| Path | What |
|---|---|
| `src/plugin.ts` | `new McpServer({name: HAKO_MCP_SERVER_NAME ('hako'), title: HAKO_NAME ('Hako') — both from @hako/config, the name the agent's passport matches — version:'2.0.0', description, websiteUrl:'https://usehako.xyz', icons:[{src:'https://usehako.xyz/icon', mimeType:'image/svg+xml'}]}, {supportedProtocolVersions:['2026-07-28'], instructions})`, text exactly as plan §1 A. The icon is the web's `/icon` route (the @hako/brand mark), linked, not copied. |
| `src/shared.ts` | The only door into shared code: relative imports of `packages/{config,networks,money}/src`, `packages/defi/src/core` and `packages/defi/src/rules.ts` (`.ts` suffixes; `tsconfig.json` adds them + `allowImportingTsExtensions`). |
| `src/wire/{primitives,money,reads,endpoints,wire.config}.ts` | The plugin's zod 4.4.3 mirror of `packages/cards/src/contract/gateway` for the 21 routes it calls (same keys, methods, paths, schemas). `test/wire.test.ts` proves equality by JSON Schema per route (params, query, body, response); only the quote's optional `draft` is left out (no drafts in the plugin) and alias `data` passes through (cards checks each kind). |
| `src/gateway.ts` | `callGateway(key, {params,query,body})`: request checked against the mirror, one `fetch` with `AbortSignal.timeout(GATEWAY_TIMEOUT_MS)` (7 s, @hako/config) and `redirect:'error'`, response checked; `callAlias` for read aliases; `preflightRun` (live 402 price for `/v2/run`). Gateway URL = portal variable `HAKO_GATEWAY_URL`, default the sslip host. |
| `src/errors.ts` | Typed errors → `isError` results with the code first and "Nothing was signed, paid or moved.": `gateway_route_missing` (gateway 404 "no route …"), `gateway_unreachable`, `gateway_timeout`, `gateway_contract_mismatch`, `gateway_error:<gateway code>`, `r15_refused`, `r16_refused`, `quote_needs_review`, `quote_expired`, `chain_not_executable`, `invalid_input`, `invoice_already_paid`, `nothing_to_pay`. Never fake data, never a proposal in an error. |
| `src/proposals.ts` | Money proposals over the gateway's `proposalResponse`: **approve** (R16) — rebuilt with core `erc20ApproveCalldata(spender, exact amount)`, spender on `LIFI_CONTRACT_ALLOWLIST`, token = fromToken, not native, gateway call must equal it byte for byte, "Step 1 of 2 … call <tool> again with the same input"; **transfer** (R15) — route + tx normalised to core `NormalizedQuote`, `bindQuote` (chains, sender, recipient, tokens, amount, tool, target allowlist, value; Solana ≤ 1,232 bytes, one signer = sender, not pre-signed); **review** — a lower minimum, the gateway's own review, or an unreviewed minimum (`"0"`) returns `quote_needs_review` with the new minimum and the exact retry input. Expiry = min(4 min, quote expiry), whole seconds, refused under 20 s. R17: moves sign from Base/Solana only. `r15RulesFor`/`r16RulesFor` are the gateway's own, imported from `packages/defi/src/rules.ts`. |
| `src/tools/catalog.ts` | A1 `hako_discover` (price, health, successRate, p50/p95, hints), A2 `hako_inspect` (schema, example, notes, paid URL, how to pay with `use_service`), A3 `hako_run` (live 402 price → x402 POST), A4 `hako_run_batch` (free `POST /v1/batch` → x402 GET `/v2/batch/<batchId>`, no body, exact frozen price, expiry ≤ batch expiry). |
| `src/tools/money.ts` | A5 `hako_quote` (route + rehearsal line + the exact `hako_bridge` input to use), A6 `hako_bridge` (wire `bridgeRequest`: `fromAmountAtomic`, `tool`, `minReceivedAtomic`), A7 `hako_bridge_status`. "USDC"/native symbols resolve to registry addresses (`src/tokens.ts`); wallets must fit the chain family. |
| `src/tools/earn.ts` | A8 `hako_earn_vaults`, `hako_earn_positions` (aliases), `hako_earn_deposit` / `hako_earn_withdraw` (same approve → bound transfer; deposit binds token → vault, withdraw vault → token, recipient = sender; EVM only; R15 binds the input's `tool`, and with none the quote returns `quote_needs_review` naming its tool). `proposeEarnMove` is the pure step after the gateway call. |
| `src/tools/reads.ts` | A9 `hako_markets` (odds + news; trading via PayBox's World plugin), A10 `hako_chain_read` (`read`: balance, token, tx, block, gas, call, logs, name; each body validated against its mirrored alias schema). |
| `src/tools/invoice.ts` | A11 `hako_invoice_create` (decimal USDC → atomic via @hako/money `toAtomic`), `hako_invoice_status`, `hako_invoice_pay` (reads the live invoice, then x402 GET `/v2/invoice/<id>` for its exact amount; text repeats payee and note, "Created by an agent · check this address"). |
| `test/` | `proposals.test.ts` (plan §12: amount units, expiry, R17, R16 exact approve and its refusals, approve → fresh quote → transfer, every R15 mismatch, lower minimum → review, equal/higher bound, unreviewed minimum, expired quote, Earn with no reviewed tool → review / other tool → refused / reviewed tool → deposit / approve first, Solana size/signers/pre-signed/fee payer), `wire.test.ts`, `fixtures.ts`. `pnpm test` = `tsx --test test/*.test.ts` then the starter's `scripts/test.mjs` (unchanged). |

Annotations: reads `readOnlyHint`; proposal tools (run, batch, bridge, earn moves, invoice pay) `readOnlyHint:false,
destructiveHint:false` like v1's accepted `hako_run` (the call only returns an unsigned proposal); invoice create
non-destructive write.

## Live gateway today (https://hako-api.84.46.247.92.sslip.io, checked 2026-10-17 ~21:00)
`hako_discover`, `hako_inspect`, `hako_run` work end to end (run → x402 proposal 5000 atomic for openweather/current).
Not served yet → every other tool returns `gateway_route_missing` with the route named: `/v1/batch`, `/v1/quote`,
`/v1/bridge`, `/v1/bridge/status`, `/v1/earn/*`, `/v1/markets`, `/v1/chain/*`, `/v1/invoices`. They start answering
as soon as the gateway lanes deploy those routes to the table; no plugin upload needed.
Once, `/v1/discover` answered `gateway_error` ("Gateway error; you were not charged") for a few seconds and the
conformance sample failed; a rerun passed. The sample depends on the live gateway staying up during portal checks.

## Decisions
- **No viem.** The only calldata the plugin builds is the exact approve, and @hako/defi/core already has
  `erc20ApproveCalldata`; no A1–A11 tool encodes a transfer. Adding viem would duplicate it and grow the bundle.
- **Money tool output = exactly one proposal** (`io.paybox/transactionProposal`, EVM|Solana union for `hako_bridge`,
  EVM for Earn). Review and refusals are typed `isError` results, so no structured content ever sits beside a proposal.
- **Unreviewed minimum fails closed:** `minReceivedAtomic: "0"` never becomes a proposal; it returns the quote to
  review (this is how Earn moves, which have no separate quote tool, get a reviewed minimum).
- **Paid URLs use the plugin's configured gateway host** (the portal's network host), not the gateway's `paidUrl`.
- **Earn without a reviewed tool fails closed** (review fix 1): the quote comes back as `quote_needs_review` with its
  tool and minimum, like an unreviewed `"0"` minimum; the person's retry carries `tool` + `minReceivedAtomic`, and
  R15 then refuses any other tool. The approve step (R16) still comes first, since it binds no tool.

## Review fixes (branch fix-l1-plugin → lane/l1-plugin)
1. **R15 tool on Earn moves** (`src/tools/earn.ts`): the reviewed tool was filled from the fresh quote's own tool, so
   `bindQuote`'s tool check compared it with itself. Now `proposeEarnMove` throws `reviewError(...)` ("No LI.FI tool
   was reviewed yet, so this quote goes to the person first.") when `tool` is missing and the step isn't the approve;
   otherwise R15 binds `input.tool`. `reviewError` is exported from `src/proposals.ts`. Four new tests in
   `test/proposals.test.ts` (no tool → `quote_needs_review` naming the tool, gateway review too; other tool →
   `r15_refused tool_mismatch`; reviewed tool → deposit proposal; approve still first).
2. **Server name/title** (`src/constants.ts`, `src/plugin.ts`, `src/shared.ts`): the `"hako"`/`"Hako"` literals are
   gone; `plugin.ts` uses `HAKO_MCP_SERVER_NAME` and `HAKO_NAME` from `packages/config/src` (the value
   `packages/agent/src/tools/passport.ts` matches).
3. **R15/R16 rules duplicate** (`src/proposals.ts`): `packages/defi/src/server/rules.ts` moved to the plugin-safe
   `packages/defi/src/rules.ts` (relative `.ts` imports of `packages/{config,networks,money}/src` and `./core`),
   re-exported by `packages/defi/src/server/index.ts` (gateway import unchanged) and imported by defi's r15/r16 tests
   from the new path. The plugin's `tsconfig.json` includes the file, `src/shared.ts` re-exports `r15RulesFor` /
   `r16RulesFor`, and the copies in `proposals.ts` are deleted (with the now-unused `LIFI_CONTRACT_ALLOWLIST` /
   `SOLANA_TX_*` re-exports). **This one touched `packages/defi` outside the lane** (the finding said it needed the
   coordinator): one `git mv`, one export line, two test import paths; no other branch changes `packages/defi`.
Gates: root `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build && pnpm -r --if-present test`
green (defi 44/44); plugin gate green (28/28 unit incl. wire, tsc, two identical builds, conformance `passed`, 16 tools).

## Open
- Portal: upload `dist/plugin.mjs` as v2, network host = the gateway host, Load tools (16), Validate transaction for
  an x402 proposal (`hako_run`) now; EVM/Solana proposals once `/v1/bridge` and `/v1/earn/*` are live.
- `https://usehako.xyz/icon` resolves only when the domain does.
