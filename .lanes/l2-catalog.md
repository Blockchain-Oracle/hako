# Lane L2 — Catalog connectors (plan C16–C18)

## Final tool ids (the gateway alias table must match)

All free (`price.tier = "free"`, `usd "0"`, `atomic "0"`, envelope `billable: false`), stable ids, POST `/v1/run/<id>` on
hako-api. Each id below is exactly what `READ_ALIAS_CONNECTORS` (packages/cards/src/contract/gateway/read-schemas.ts)
names; `check_samples.py` fails if they drift.

| Alias (gateway `/v1/...`) | EVM tool | Solana tool | Render kind |
| --- | --- | --- | --- |
| `chain/balance` | `chain-evm/balance` | `chain-solana/balance` | `balance` |
| `chain/token` | `chain-evm/token` | `chain-solana/token` | `token` |
| `chain/tx` | `chain-evm/tx` | `chain-solana/tx` | `tx_receipt` |
| `chain/block` | `chain-evm/block` | — | `block` |
| `chain/gas` | `chain-evm/gas` | `chain-solana/gas` | `gas` |
| `chain/call` | `chain-evm/call` | — | `contract_read` |
| `chain/logs` | `chain-evm/logs` | — | `logs` |
| `chain/name` | `chain-evm/name` | — | `chain_name` |
| `markets` | `hako/markets` (any) | | `market` |
| `earn/vaults` | `lifi-earn/vaults` (any) | | `yield` |
| `earn/positions` | `lifi-earn/positions` (any) | | `positions` |

Also new and free (not aliased, reachable by discover/inspect): `polymarket/markets` (`market`), `jupiter/events`
(`market`).

Paid (sold on `/v2`, plan C16):

| Tool | Price (tier) | Render | Available |
| --- | --- | --- | --- |
| `elevenlabs/tts-500` | $0.05 (`media-medium`) | `audio` | yes (key set) |
| `elevenlabs/tts-2000` | $0.20 (`media-large`) | `audio` | yes |
| `elevenlabs/sound-effect` | $0.02 (`media-small`) | `audio` | yes |
| `exa/search`, `exa/answer` | $0.01 (`premium`) | `search_results`, `answer` | no: `EXA_API_KEY` empty |
| `artificial-analysis/models` | $0.005 (`standard`) | `model_bench` | no: `ARTIFICIAL_ANALYSIS_API_KEY` empty |

Catalog: 80 → 103 endpoints.

## Done (branch `lane/l2-catalog`)

- **Framework:** `PriceTier.free` / `FREE` (`PRICE_FREE_USD = "0"`); the envelope's `billable` is false for free tools;
  discover hints say "free … never on /v2" for them. Render kinds added (`categories.py`): balance, token, tx_receipt,
  block, gas, contract_read, logs, chain_name, market, yield (`Render.yield_`), positions.
- **`framework/jsonrpc.py`:** JSON-RPC batch over interchangeable upstreams (`Rpc`), next RPC on HTTP failure, rate
  limit, deadline or node-trouble error objects; `units()` exact atomic → token units.
- **chain-evm** (`connectors/chain_evm/`): Base, Ethereum, Arbitrum, OP Mainnet, Polygon on the public RPCs of
  `@hako/networks` (no Alchemy); one upstream per RPC URL so a 429 never blocks another chain. `networks.py` mirrors
  registry.ts (checked by the script). ABI from human-readable signatures with `eth-abi` (`abi.py`); ERC-20 facts in
  one batch (`erc20.py`); symbols resolve through LI.FI `GET /token` (`connectors/lifi/tokens.py`, keyless 100/min).
  `name`: ENS registry on Ethereum, Basenames registry on Base; reverse via ENSIP-19 L2 reverse registrar, then the
  legacy `80002105.reverse` node; every reverse answer is checked forward. `gas`: `eth_feeHistory` p25/p50/p90 tips,
  max fee = 2 × next base + tip (`BASE_FEE_MULTIPLIER`). `logs`: ≤ 10,000 blocks, ≤ 200 rows (newest kept), needs a
  filter. `tx`: OP-stack L1 fee included in `fee_atomic`.
- **chain-solana** (`connectors/chain_solana/`): Helius first when `HELIUS_API_KEY` works, then
  `api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`. SPL balances read the owner's associated token
  accounts (`solders` derives them) with `getMultipleAccounts`, because publicnode refuses indexed calls
  (`getTokenAccountsByOwner`: "Indexed requests require a personal token"). `tx` asks for
  `maxSupportedTransactionVersion: 1` (v1 transactions are live). `gas`: Helius `getPriorityFeeEstimate`, else
  `getRecentPrioritizationFees` percentiles (pass `accounts` for a local estimate; global minimums are often 0).
- **polymarket/markets** (Gamma `/public-search`, one row per market, event link), **jupiter/events**
  (`/events/search`, micro-USD prices → mid of bid/ask; "team" events — Up/Down, team A/B — become one row with
  each option), **hako/markets** (both in parallel, Jupiter's `POLY-<id>` mirrors dropped, ≤ 3 Google News
  headlines from the last week; `provider` picks one source).
- **lifi-earn/vaults**, **lifi-earn/positions** (earn.li.fi/v1, `x-lifi-api-key`): `LIFI_API_KEY` is empty, so both
  are `available: false` and answer 503 `tool_unavailable` — never fake data. APY: the OpenAPI spec says fractions
  (`0.0534` = 5.34 %), converted to percent; **not verified live** (no key) — re-check one answer once the key is set.
- **`packages/tools/scripts/check_samples.py`:** runs every L2 tool's example live through the engine and validates
  `data` against `packages/cards/schemas/<render>.schema.json`; checks every `READ_ALIAS_CONNECTORS` id exists and is
  free, that each alias's zod body (per chain family, defaults applied) is accepted by the tool's pydantic input, and
  that the EVM/Solana mirrors equal `@hako/networks`.
- **ElevenLabs** (`connectors/elevenlabs/`): Flash v2.5 speech in two fixed tiers (≤ 500 / ≤ 2,000 characters) and
  sound effects (0.5–5 s), MP3 `mp3_44100_128`. R18: input caps per tier, a daily ceiling of 15,000 credits checked
  before each call (503 `tool_unavailable` past it, nothing charged), an 80 % spend alarm in the logs, real cost from
  the `character-cost` header (`budget.py`). Voices: George (default), Rachel, Alice, Liam, Matilda, Adam — each
  answered 200 for our key (Sarah 404s; the key lacks `voices_read`, so no listing). Music not built (generation
  exceeds the 8 s run).
- **Generated files** (`hako_tools/files.py` + hako-api `GET /v1/files/<id>`): bytes + JSON sidecar under
  `HAKO_DATA_DIR/files`, 24 h, swept on write; ids are 32 hex; unknown/expired → 404; `cache-control: immutable`.
  `data.url` = `HAKO_PUBLIC_BASE_URL` + `/v1/files/<id>`.
- **Exa** (`exa/search` with highlights, `exa/answer` with citations) and **Artificial Analysis**
  (`artificial-analysis/models`: LLM leaderboard by intelligence/speed/price, media by ELO; cached 1 h). Written
  from their API docs; not run live (no keys) — run `check_samples.py exa/search exa/answer
  artificial-analysis/models` once the keys are set.
- New Python deps (hako-tools): `eth-abi`, `pycryptodome` (keccak backend for eth-utils), `solders`.

## Evidence (2026-10-17, ~22:15 WAT)

- `uv run --env-file …/.env python packages/tools/scripts/check_samples.py` → 15/15 available tools `OK` (0 schema
  errors), `lifi-earn/*` UNAVAILABLE (no key), read aliases 11 OK, networks mirror OK.
- Local api `uvicorn hako_api.main:app --port 8120`: every new tool called once via `POST /v1/run/<id>` with a fresh
  real input (ETH+DAI on Ethereum, ARB on Arbitrum, a Base USDC transfer, OP block 140,000,000, Polygon gas, Uniswap
  V2 `getReserves`, Arbitrum USDC logs, `jesse.base.eth` reverse, SOL+BONK, USDC mint, a v1 Solana tx, Jupiter
  program fees, Polymarket "election", Jupiter "nba", hako/markets "fed rate cut") → all 200, `billable: false`,
  price 0; `lifi-earn/*` → 503 `tool_unavailable`. `/v1/version`: 97 endpoints. `/v1/discover` "wallet balance on
  base" → chain-evm/balance first.
- ElevenLabs on the local api: `tts-500` (Alice) and `sound-effect` (1 s) → 200, `data` valid against
  `audio.schema.json`, `GET` of the returned URL → 200 `audio/mpeg` (51 KB / 17 KB); unknown or malformed file id →
  404; 501 characters → 422 `invalid_input`. `check_samples.py elevenlabs/tts-2000` → OK.
- Gates: `uv sync --all-packages && uv run ruff check . && uv run pyright` green; JS gates green (no JS touched).

## Open (for the coordinator / L1)

- **Gateway (L1):** a free tool's price is `$0`; `runRoutes` (services/gateway/src/payments.ts) builds a `/v2` route
  for every available endpoint — skip `price.tier === "free"` there (x402 parses `$0` without error, but nothing free
  should be sold on `/v2`), and forward the aliases to `/v1/run/<id>` on hako-api.
- **Helius:** the dev `HELIUS_API_KEY` answers 429 "max usage reached" (credits exhausted); Solana tools fall back to
  public RPCs, so nothing breaks, but `getPriorityFeeEstimate` is unused until a working key is set.
- **LI.FI key:** set `LIFI_API_KEY` on Coolify (hako-api) and the Earn tools turn available; also raises the LI.FI
  token lookups above 100/min.
- **Brand:** catalog provider ids are `chain-evm`, `chain-solana`, `polymarket`, `jupiter`, `lifi-earn`, `hako`
  (`logo_domain`: ethereum.org, solana.com, polymarket.com, jup.ag, li.fi). W0.4 (a) assumed `lifi`/`helius` ids —
  alias `lifi-earn` → li.fi and the chain providers in the logo registry.
- **Files (L1 + ops):** the gateway must forward `GET /v1/files/:id` (endpoint table `file`) to hako-api, and
  hako-api on Coolify needs `HAKO_PUBLIC_BASE_URL` = the gateway's public URL (today
  `https://hako-api.84.46.247.92.sslip.io`, later `https://api.usehako.xyz`), else audio URLs point at localhost.
- **Web (L3):** `apps/web/src/lib/catalog/types.ts` types `price.tier` as `local | standard | premium`; the catalog
  now also has `free`, `media-small`, `media-medium`, `media-large` (type-only, nothing parses it at runtime).
- **Keys:** `EXA_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `LIFI_API_KEY` (Abu's free signups) turn those tools on
  with no code change; `ELEVENLABS_API_KEY` must be on hako-api in Coolify for the audio tools.
