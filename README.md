# Hako

Hako (箱, "box") is building one box for your AI agent: 80+ paid tools (data, research, media) and real money moves (bridge, swap and earn across 66 chains through LI.FI, prediction-market odds, transfers, chain lookups), paid and signed with **your PayBox wallet**, and shown as clickable cards wherever your agent lives: Hako's web app, and inside Claude, ChatGPT, Cursor and VS Code. Today the 80+ paid tools, free discover and inspect, and paid `/v2` runs with PayBox's `use_service` work; everything else is listed under [What is being built](#what-is-being-built).

Hako is an entry for MoonPay's PayBox hackathon (Chapter 1). Its core deliverable is a PayBox marketplace plugin. Hako never holds a private key and never pays on anyone's behalf: every paid run and every money move is approved and signed in the user's own PayBox wallet.

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Tool catalog | [`packages/tools`](packages/tools), [`services/api`](services/api) | 80 tools from 33 providers (web search and page reading, cited answers, papers, news, weather, maps, crypto prices and FX, GitHub and packages, time zones and holidays…), each with an input schema, an output schema, a fixed price and a live example. |
| Gateway | [`services/gateway`](services/gateway) | Free reads: `GET /v1/catalog`, `POST /v1/discover`, `POST /v1/inspect`. Paid runs: `POST /v2/run/<provider>/<slug>`, x402 `exact` in USDC on Base mainnet (`eip155:8453`) through Coinbase's CDP facilitator, settled only when the run succeeds. A PayBox wallet pays it with PayBox's core `use_service`. |
| CLI and local MCP | [`apps/cli`](apps/cli) (npm `usehako`, bin `hako`) | `npx -y usehako discover`, `inspect`, `catalog` and `mcp` (stdio, `hako_discover` and `hako_inspect`). `inspect` prints each tool's paid `/v2` URL and how to pay it with PayBox. |
| Docs | [`apps/docs`](apps/docs) | Quickstarts, CLI and API reference, and one page per provider generated from the catalog snapshot. |
| Web app | [`apps/web`](apps/web) | Landing, the tool catalog and the `/agent` chat. A visitor is **Not connected**: discover and inspect work, and a paid run says it needs PayBox. |

## What is being built

These are planned and not finished; nothing here should be read as shipped:

- **The PayBox plugin** ([`plugins/paybox`](plugins/paybox), `hako_*` tools): it starts with `hako_discover`, `hako_inspect` and `hako_run` (an x402 proposal PayBox pays) and grows into batch runs, LI.FI quotes, bridge, swap and earn proposals, market odds, chain reads and pay-me invoices. It will be submitted for review in the PayBox developer portal; until PayBox approves a version, it is installable privately under Unofficial plugins.
- **Connect PayBox** in the web app, with editable money cards (route race, rehearsal, receipts), activity, contacts and voice.
- **Cards inside Claude, ChatGPT, Cursor and VS Code** (MCP Apps) from the hosted MCP server at `api.usehako.xyz/mcp`.
- **`hako login`** in the CLI (PayBox's own login and pairing) and paid runs and money moves from the terminal.
- The design moves to Senryo, the design system of Kawase (the owner's own project).

## Run it locally

Use **Python 3.13** with [uv](https://docs.astral.sh/uv/), **Node.js 24+** and **pnpm 11**.

```sh
uv sync --all-packages && pnpm install
cp .env.example .env                                     # provider keys; tools without a key are listed unavailable
cp services/gateway/.env.example services/gateway/.env.local
cp apps/web/.env.example apps/web/.env.local
uv run uvicorn hako_api.main:app --port 8000             # the tool backend on :8000
pnpm -C services/gateway dev                             # the gateway on :8080
pnpm -C apps/web dev                                     # the web app on :3100
pnpm -C apps/docs dev                                    # the docs on :3200
```

The example env files list every variable. Without CDP keys the gateway serves the free reads only and offers no paid `/v2` route.

```sh
uv run hako-tools list                          # every tool, with availability
uv run hako-tools probe --provider github       # run a provider's examples live
uv run ruff check . && uv run pyright           # Python checks
pnpm lint && pnpm typecheck && pnpm build       # TypeScript checks
cd plugins/paybox && pnpm install --frozen-lockfile && pnpm typecheck && pnpm build   # the plugin (own lockfile, Node 24)
```

## Repository layout

| Path | What lives here |
| --- | --- |
| [`packages/tools`](packages/tools) | The connector framework (`framework/`) and one folder per provider (`connectors/`). |
| [`packages/core`](packages/core) | The shared HTTP client with rate limits and deadlines, cache, settings, logging and the SSRF guard. |
| [`packages/now`](packages/now) | Hako's own computations: time zones, holidays, cross-checked FX and weather, current facts, news and job indexes. |
| [`services/api`](services/api) | The FastAPI tool backend and its scheduled jobs (health probe, news and job indexes). |
| [`services/gateway`](services/gateway) | The x402 seller (free `/v1` reads, paid `/v2` runs) and the hosted MCP server. |
| [`plugins/paybox`](plugins/paybox) | The PayBox plugin, from PayBox's starter 1.0.2 (own lockfile). |
| [`apps/web`](apps/web) | The Next.js app: landing, `/tools`, `/agent`, `/SKILL.md`. |
| [`apps/docs`](apps/docs) | The documentation site. |
| [`apps/cli`](apps/cli) | The `hako` CLI and local MCP server, bundled into one file. |

## Pre-existing code and where it came from

Hako starts from **Akashi** ([Blockchain-Oracle/akashi](https://github.com/Blockchain-Oracle/akashi), MIT), the same author's earlier project: an x402 gateway, the 80-tool catalog, the chat, the docs and the CLI.

- Everything up to Akashi commit [`bf5cb7a`](https://github.com/Blockchain-Oracle/akashi/commit/bf5cb7a) (2026-10-12) is **pre-existing**.
- The tree Hako was extracted from, Akashi [`227b7d9`](https://github.com/Blockchain-Oracle/akashi/commit/227b7d9), also holds five commits made in the Akashi repo during the event:
  - [`85b31cc`](https://github.com/Blockchain-Oracle/akashi/commit/85b31cc) restored Akashi's Pocket deploy;
  - [`7087541`](https://github.com/Blockchain-Oracle/akashi/commit/7087541) added a Pocket audit document;
  - [`2706dfe`](https://github.com/Blockchain-Oracle/akashi/commit/2706dfe) linked the web demo;
  - [`f210928`](https://github.com/Blockchain-Oracle/akashi/commit/f210928) added the `/v2` mainnet route;
  - [`227b7d9`](https://github.com/Blockchain-Oracle/akashi/commit/227b7d9) started the PayBox plugin.
- In the port to Hako, the Pocket Network relay, the demo payer and demo pages, the browser-wallet mode and every Base Sepolia payment path were removed, and everything was renamed from Akashi to Hako.
- [midl-ai](https://github.com/midl-ai/mcp-server) and Kawase are pattern references only: no code is copied from midl-ai, and any Kawase code reused later is the owner's own.

Third-party design and data attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Made by **Abubakr Jimoh**. [MIT licensed](LICENSE).
