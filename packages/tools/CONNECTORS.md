# Writing a Hako connector

A connector is one **provider** plus typed async **endpoints**. The engine does validation, deadlines, caching,
size caps, health, billing flags and the envelope; a handler only calls the upstream and maps its answer.
Worked example: `src/hako_tools/connectors/firecrawl/`.

## Layout

```
src/hako_tools/connectors/<provider>/
├── __init__.py      # one-line docstring
├── provider.py      # PROVIDER = Provider(...)
└── <group>.py       # @tool endpoints (≤ 400 lines per file; split by theme)
```
Modules are auto-imported by `connectors.load()`; nothing else needs registering.

## Provider

```python
SERPER = Provider(
    id="serper", display_name="Serper", summary="Google results as JSON: web, news, scholar, places.",
    homepage="https://serper.dev", docs_url="https://serper.dev/playground", base_url="https://google.serper.dev",
    categories=(Category.web_search, Category.news), terms=Terms.value_added,
    auth=Header("X-API-KEY", "SERPER_API_KEY"),   # or Bearer("ENV"), Query("param", "ENV"), NoAuth()
    rate="5/second", max_concurrency=4,              # the provider's published limits, never guesses
    licence=None, attribution=None,                  # set both for open data (e.g. "CC BY 4.0", "© OpenStreetMap")
)
```
Credentials are env names only (`hako/.env` locally, Coolify env in production). Never read a key yourself.

## Endpoint

```python
class SearchInput(ToolInput):           # extra="forbid": a typo fails before anyone pays
    query: str = Field(min_length=1, max_length=500, description="What to search for.")

class SearchOutput(ToolOutput):
    query: str
    results: list[Link]

@tool(provider=SERPER, slug="search", name="Serper Google Search",
      summary="One line an agent ranks on.",
      description="Written for an agent: what it does, what it will NOT do, and which endpoint to use instead.",
      categories=(Category.web_search,), render=Render.search_results, price=STANDARD,
      example={"query": "x402 payments"}, see_also=("firecrawl/search",), cache_ttl_s=TTL_SEARCH_S)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    data = await ctx.post_json(SERPER, "/search", json={"q": inp.query})
    return SearchOutput(query=inp.query, results=[Link(title=r["title"], url=r["link"], snippet=r.get("snippet"))
                                                  for r in data.get("organic", [])])
```

Rules:
- **`ctx` only**: `ctx.get_json / post_json / get_text(provider, path, params=…, json=…, headers=…)`. It injects
  credentials, applies rate limits and the deadline, records the source and maps errors (404 → "not found"
  answer, 429 → rate limited, other 4xx/5xx → provider error). `ctx.call("<id>", {...})` runs another endpoint
  (composites). `ctx.note("…")` adds a note for the agent.
- **Composites declare what they call**: `@tool(..., requires=(SERPER, JINA, GROQ))`. The endpoint is then
  unavailable unless those keys are set (never half-run), and the health probe skips it (it would spend keyed
  credits every 10 minutes).
- **Not found is an answer**: raise `ToolNotFoundResult("…")` when the thing does not exist (the run returns
  200, `found: false`, and is not billed).
- **Price**: `LOCAL` ($0.001) keyless or local compute · `STANDARD` ($0.005) keyed, cheap · `PREMIUM` ($0.01)
  when the upstream costs ≥ $0.005 or the endpoint chains several calls.
- **Render** picks the result card; match `data` to its shape (`categories.py` documents each).
- **Cache TTL** from `constants.py` (`TTL_SEARCH_S`, `TTL_PAGE_S`, `TTL_REFERENCE_S`, `TTL_LIVE_S`) or None.
- **No magic numbers** (ruff PLR2004): name limits as module constants with the reason.
- **Inputs are JSON bodies** (the gateway forwards bodies, not query strings), < 64 KiB; the run must finish < 8 s.
- **Keep outputs lean**: only fields an agent uses; the engine trims anything past 60 KB but do not rely on it.
- The `example` must be valid input and should succeed live: it is the probe and the docs example.

## Check

```bash
uv run hako-tools probe --provider <id>     # runs every example live through the engine
uv run ruff check packages/tools && uv run pyright packages/tools
```
