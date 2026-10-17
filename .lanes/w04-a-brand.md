# W0.4 (a) — brand, identity, ui

Branch `w04/a-brand`, cut from `origin/w04/foundation` (ff56034). Commits, in order:
1. `chore: replace Akashi brand with Hako tokens` — the swap (tokens pipeline, mark, every `--ak-` use and paint
   utility rewritten, both `fonts.ts`, landing shell).
2. `chore(brand): delete the old Akashi brand leftovers` — the 証 seal builder and geometry, Monid `paint.css`,
   wordmark SVGs, self-hosted Outfit/Inter/JetBrains files, the dead landing constants; notices updated.
3. `feat(identity): …` — `@hako/identity`.
4. `feat(ui): …` — `@hako/ui`, the move of `apps/web/src/components/ui/*` and `lib/utils.ts`.
5. `docs(lanes): …` — this file.

## @hako/brand (`packages/brand`)
- Kawase's Senryo pipeline: `tokens.json` (+ `mark.json`) → `scripts/build.mjs` → `generated/web.css` (`:root` light,
  `.dark` dark, shadcn variable names, Tailwind 4 `@theme inline`, a `type-<role>` utility per Senryo type role,
  `money` utility, `--shadow-{button,dock,sheet,receipt}`, `--ease-*`, `--container-measure`), `generated/tokens.ts`,
  `generated/mark.ts` and the six mark assets. `scripts/check-contrast.mjs` runs in the package's `build`, so turbo
  runs it before web and docs (`^build`) and in the Docker build: it exits 1 when a text pair drops below 4.5:1 or the
  ring/accent fill below 3:1 on a card. `packages/brand/turbo.json` declares the generated outputs.
- Same export names as before: `.` (BRAND, `tokens`, `MARK`, `MARK_SVG`), `./react` (`HakoMark`, `HakoLockup`),
  `./paint.css` (now `generated/web.css`), `./assets/*` (`hako-mark.svg`, `hako-mark-adaptive.svg`, `hako-mark-ink.svg`,
  `hako-mark-inverse.svg`, `app-icon.svg`, `favicon.svg`).
- Token names are Kawase's (shadcn's variables plus Senryo's): `accent` is the hue, as in Kawase, so Kawase code ports
  without renames. Dropped Kawase-only tokens: `network*` (testnet capsule; Hako is mainnet only), orb and story fields.
  Senryo's corner steps ride along as `--radius-step-*` (`rounded-step-lg`): Kawase's `--radius-s-*` reads as Tailwind's
  start-corner utilities.
- **Accent: asagi (浅葱) `#009CA8`, black labels.** Chosen against the check: luminance 0.266 → black label 6.32:1,
  ring/accent on the white card 3.32:1, on the dark card 5.13:1. Text in its family is `link`: light `#006B74`
  (6.26 on card, 5.74 on page, 5.43 on `selected-row #DDF3F5`), dark `#5FD6E0` (9.89 on card, 10.95 on page, 7.14 on
  `selected-row #163A3D`). Every other value is Senryo's. Why not red/orange (vermilion was the first idea): `link` in
  that family would sit next to Senryo's destructive `#C83225` and down `#C8283F`; amber is `warn`, green is `up`,
  magenta is Kawase's, purple is MoonPay's, blue is Base's and the old brand's. All 95 enforced pairs pass.
- Mark: 箱 as an open box — the body carries 目's two bars (the right half of 箱), the lid flaps open like ⺮. 32-unit
  grid with the body and bars on even units (crisp at 16 px; rendered and checked at 16/32/256 px). Body = ink
  (currentColor in React), lid = accent. The favicon switches the body to paper under `prefers-color-scheme: dark`;
  the app icon is the mark in paper + accent on an ink tile. Both apps serve the icon from `MARK_SVG` (`app/icon.ts`),
  so no copy of the SVG lives in an app.
- Fonts: `next/font/google` Inter (`--font-inter`) and Roboto Condensed (`--font-roboto-condensed`) in both
  `lib/fonts.ts`; the variable names must match `tokens.json` (next/font takes literals only). Code uses the system
  monospace stack (no third web font). Money/titles: `font-display font-black` or `money` / `type-*` utilities, with
  tabular lining figures.
- Web: `styles/index.css` imports the tokens and `@hako/ui/styles.css`, `@source`s `packages/{cards,ui,brand,identity}/src`.
  Docs: `global.css` maps every `--color-fd-*` role onto the tokens once for both themes (fumadocs' `accent` is its
  hover surface, so it takes `row-pressed`; links use `link`); docs now default to light.
- Every `--ak-` variable and the paint's utilities (`text-ink-2`, `border-line`, `text-brand`, `bg-brand`, `bg-subtle`,
  `bg-dark`, `shadow-card`…) in `apps/web/src` and `apps/docs` were rewritten to token utilities (script-mapped, then
  the dark-slab cases fixed by hand: the user bubble and code blocks are quiet plates, the footer is a card plate, no
  shadows on content). The agent/tools/results files keep their layout; L3 rebuilds them.

## Landing shell (`apps/web/src/features/landing`, `app/(landing)/page.tsx`)
`components/{Hero,Standing}.tsx`, `lib/content.ts`, `landing.config.ts`. Hero: status line with the live tool count,
the title, the plan §1 promise with the live count and "66 chains through LI.FI" (li.quest/v1/chains EVM + SVM = 66,
read 2026-10-17), an honesty line, black primary + quiet secondary actions, the SKILL command, and "Built on PayBox ·
MoonPay" with their real marks. "Where Hako stands": live rows (tools on Base, agent chat) and being-built rows (the
PayBox plugin — "once submitted for review, installable privately under Unofficial plugins" (R19), money moves, cards
in AI hosts), each in words and shape. L6 finishes it (captures, ecosystem, proof).

## @hako/identity (`packages/identity`)
- 111 SVGs in `svg/` + the Hako mark (adaptive) and its ink file read from `packages/brand/assets` → `build.mjs` (dependency-free: no SVGR/SVGO, as
  those are not §3 pins) → `src/generated/*.tsx` DOM components + `MARKS`. It inlines `<style>` class rules, maps
  attributes and `style` to JSX, prefixes every id with the stem, and turns black/white into `currentColor` in `-mono`
  files. Every generated mark was rendered (react-dom/server) and compared with its source raster: identical.
  `build` runs in turbo after `@hako/brand` (devDependency).
- `PROVENANCE.md`: one row per file (112 incl. the Hako mark) + a "Not delivered yet" table. Kawase rows reused for
  its marks (chains, USDC, ETH, Aave, Morpho, Aero, Merkl, Exa, DefiLlama, Circle, Coinbase, Across, Relay, LI.FI,
  KyberSwap, Gas.zip, 28 currency flags). New: PayBox (first-party lockup paths, black as its app icon), MoonPay
  (first-party symbol, `--mp-brand-500 #7D00FF`), `@web3icons/react@4.1.24` (Jupiter, SOL, POL), `simple-icons@16.34.0`
  (arXiv, GitHub, Google News, Hacker News, NASA, npm, OpenStreetMap, PyPI, Wikidata, Wikipedia, YouTube, Wayback via
  Internet Archive, ElevenLabs), first-party site assets (Groq, Firecrawl, Helius, Polymarket, Artificial Analysis,
  OpenAlex, Frankfurter, IPinfo, Open Food Facts, OpenWeather, Open-Meteo, Serper). Not delivered (labelled disc):
  CoinGecko, Crossref, Datamuse, deps.dev, Free Dictionary, Jina, Open Library, PubChem, USGS, World Bank.
- Keys: `chain:<caip2>` (`chain:eip155:8453`, `chain:solana:mainnet`), `token:<caip2>:<address>` (lowercase on EVM,
  as-is on Solana; native coin and USDC of every `@hako/networks` chain), `provider:<catalog id>`, `venue:<LI.FI tool
  key>` (across, relaydepository, cctp, gasZipBridge, kyberswap, jupiter, lifidexaggregator, lifiIntents,
  lifiIntentsDex), `fiat:<ISO 4217>`.
- `Mark` (Kawase's web Mark, ported; Hako adds `logoUri` + `name`), `TokenMark` (identity SVG → LI.FI `logoURI`
  through `${HAKO_GATEWAY_URL}/v1/logo?src=` → labelled disc; never matches a mark by symbol), `LogoProxyProvider`,
  `logoProxyUrl`, `FallbackDisc`, lookups. `LogoImage` re-checks a server-rendered image after hydration (an image that
  failed before hydration never fires onError).
- `apps/web` `ProviderLogo` now draws `Mark` by catalog id: `public/logos/*.png`, `scripts/fetch-logos.mjs` and
  `lib/constants/logos.ts` are gone (raster favicons; the letter-tile fallback was a stand-in).

## @hako/ui (`packages/ui`)
- Own `components.json` (style `radix-nova`, aliases `@hako/ui/*`, css `src/styles.css`), tsconfig `paths` for the CLI,
  package `exports` for Next/Vite (the package imports itself by name, as Kawase's ui-web). shadcn CLI **4.21.4** (4.22.0
  and 4.21.5 are under 7 days old).
- Installed with the CLI: message-scroller, message, bubble, trace, code-block (+ `lib/highlighter.tsx`,
  `hooks/use-highlighted-code.ts`), marker, item, questionnaire, attachment; button, input, textarea, dialog, sheet,
  tooltip, accordion, collapsible, separator, skeleton (= 21st 1588), sonner (= 21st 886), empty.
- 21st (registry key from `.env`, never written to the repo): sidebar-001 21517 (split under 400 lines into
  `sidebar-001-utils/{context,parts}.tsx`, moved unchanged), task-steps 23569, stepper primitive of 29815 (its demo file with
  sample steps dropped), skeleton-swap 23557, drawer 31360 (tabler `IconX` → lucide `X`, bundled `cn` → ours,
  `@base-ui/react` pinned 1.8.0 = fumadocs' version), empty-state 1435 and text-shimmer 12336 written from their
  registry items (CLI refusals), empty-states-4 19376 served by its primitive `empty` (the block needs a shadcn style
  4.21.4 cannot resolve, `@remixicon/react`, and its body is sample toasts). Kawase as-is: number-flow (Odometer, 1444),
  slide-action-button 29304, hold-to-confirm 23527 (Kawase `bg-network` → `bg-primary`, equal on mainnet),
  segmented-control 23552, prompt-input, response-stream (+ "use client"). All recorded in `apps/web/.21st/design.json`.
- `src/styles.css`: maps the installed components' own variables onto tokens (`--accent-pro` → accent,
  `--an-foreground-*` → silver / muted-foreground); the CLI's overrides of `--success`/`--destructive-foreground` and its
  second dark variant were removed.
- `index.ts` exports all 165 names (checked by a throwaway page importing the barrel into a server component and
  building/rendering it; the page is not committed), plus `Mark`/`TokenMark` re-exported from `@hako/identity` (one
  implementation; Mark lives with the marks). `cn` = the `cn` package (catalog 0.4.0) via `@hako/ui/lib/utils`.
- Dependencies: catalog entries for everything in §3; `radix-ui 1.6.7` (pinned to the lockfile's version, as apps/web
  now is) and `@base-ui/react 1.8.0` are the installs' own runtime deps (no catalog entry); `shadcn 4.21.4` is a
  devDependency for its `shadcn/tailwind.css`. No tabler, remixicon, hugeicons, framer-motion, clsx or
  tailwind-merge in `@hako/ui`.
- `apps/web/src/components/ui/*` (identical to the new installs apart from imports) and `lib/utils.ts` are deleted;
  19 web files import `@hako/ui/components/ui/*` and `@hako/ui/lib/utils`. `apps/web/components.json`: `ui` and `utils`
  aliases point at `@hako/ui` (style unchanged, radix-nova).

## Open (for the coordinator)
- `app/layout.tsx` (shared wiring): wrap with `<TooltipProvider>` (shadcn tooltip asks for it) and, where the gateway is
  not production, `<LogoProxyProvider gatewayUrl={GATEWAY_URL}>`; the default is `HAKO_GATEWAY_URL`
  (`api.usehako.site`, not resolving yet on 2026-10-17, so remote logos fall back to the disc until DNS is up).
- The logo route and the `proxy.ts` matcher: done in the third pass (review findings 5 and 6 below).
- Provider ids for the C16 catalog providers are assumed `exa`, `artificial-analysis`, `elevenlabs`, `polymarket`,
  `jupiter`, `lifi`, `helius`; L2 uses these or the registry gets an alias.
- `apps/web/package.json` still lists `clsx`, `tailwind-merge`, `class-variance-authority`, `radix-ui` that only the
  moved components used (lanes add dependency lines only; the coordinator may drop them).
- `THIRD_PARTY_NOTICES.md` (root) was updated where it described the deleted brand files, fonts and raster logos.
- `public/agents/*.svg` (simple-icons host marks under the tools pages) are still used by L3's tools pages; L3 can move
  them to identity hosts later.
- The 21st registry returns `registryDependencies` URLs that embed the API key; my fetch printed one in a local tool
  output during the install (nothing written to the repo; `rg 21st_sk_` is clean). Rotating `API_KEY_21ST` is cheap.

## Review fixes (2026-10-17, second pass)

Each finding of the W0.4 (a) review, in its order, with what was done.

1. **The radix-nova style base was missing** (`packages/ui/src/styles.css:1`). `packages/ui/package.json` has
   `"shadcn": "4.21.4"` in devDependencies (published 2026-10-07, over the 7-day rule; the CLI version that did the
   installs) and `packages/ui/src/styles.css` starts with `@import "shadcn/tailwind.css";` (apps/web imports tailwindcss
   and tw-animate-css before it). `pnpm install`, lockfile committed (149 new entries, the CLI's own tree; no existing entry removed).
   Rebuilt web: its CSS now has `.shimmer{`, `.scroll-fade-b{`, `.data-horizontal\:h-px:where([data-orientation=horizontal])`
   and `.data-open\:animate-in:where([data-state=open])`, so Separator/ItemSeparator draw, Dialog/Sheet/Tooltip/Accordion/
   Questionnaire animate, and Trace/Attachment shimmer and the scroll fades work. Recorded as a decision in design.json.
2. **Black-only marks vanished in dark** (`packages/identity/src/registry.ts:99`). PayBox, GitHub, Wikipedia, ElevenLabs
   and Wayback register only their `-mono` file (`glyph(undefined, undefined, "<slug>-mono")`), so `markFile` resolves
   to currentColor in every variant: their own single colour, drawn in the text colour, not a tint. Their fixed-colour
   copies (`svg/{paybox,github,wikipedia,elevenlabs,wayback}.svg`) are deleted, the mono rows in PROVENANCE.md carry
   the sources and why the mono file serves both variants. Hako's two-colour mark: `packages/brand/scripts/build.mjs`
   writes `assets/hako-mark-adaptive.svg` (body `currentColor`, lid the accent, as `HakoMark` draws it; also in
   `MARK_SVG`), and identity's `hako` stem is built from it (`hako-mono` stays the ink file). The landing's "Built on"
   renders PayBox and MoonPay with `variant="mono"` (both in the line's text colour). Checked with the built app
   (`next start`, catalog served from a local copy of the live catalog, headless Chrome at light and dark): the landing
   shows both partner marks in dark, /tools shows GitHub's glyph and Hako's body (paper) + asagi lid on the dark card,
   and both read in light; Wikipedia's and Wayback's markup is the same currentColor path.
3. **shadcn's `accent` used as a surface** (`sidebar-001-utils/context.tsx:145`, `stepper.tsx:283`). The rail's hover
   highlight is `bg-row-pressed` (Senryo's pressed/hover row) and the stepper's pending indicator is
   `bg-muted text-muted-foreground`. `rg 'bg-accent|text-accent-foreground'` over packages/ui and apps finds no other use
   (the `accent-pro` active bar stays the accent: the active row is the moment that matters). Both recorded as
   deviations in `apps/web/.21st/design.json` plus a decision entry.
4. **Two files over 400 lines.** `Sidebar001Separator`, `Sidebar001Header` and `Sidebar001Footer` moved unchanged to
   `sidebar-001-utils/parts.tsx` and are re-exported from `sidebar-001.tsx` (now 360 lines). The stepper's types, its two
   contexts and `useStepper`/`useStepItem` moved unchanged to `stepper-utils/context.tsx` and `stepper.tsx` (now 371)
   re-exports the hooks: moving the indicator or separator alone would have imported the hooks back from stepper.tsx
   (a cycle). Public names are unchanged (`index.ts` still `export *`s both files). design.json's deviation notes updated.
5. **Proxy matcher still excludes `icon.svg`** (`apps/web/src/proxy.ts:27`). Coordinator-owned shared wiring, so not
   edited in this lane. At merge, change the matcher to
   `["/((?!_next/static|_next/image|favicon.ico|icon).*)"]` so `/icon?<hash>` (served by `app/icon.ts` since this lane)
   is not rewritten to `/sandbox/icon` on the sandbox host.
   **Fixed (third pass, `w04/fix-a-brand`):** the matcher is now
   `["/((?!_next/static|_next/image|favicon.ico|icon).*)"]` and its comment names the favicon route. Checked with the
   built web (`next start`): `curl -H 'Host: sandbox.usehako.site' localhost:<port>/icon` returns 200 `image/svg+xml`
   (the review saw 404), the app host's `/icon` too, and `/` on the sandbox host still reaches `app/sandbox/page.tsx`
   (its placeholder 404 until L4 builds it, same as `/sandbox` on the app host).
6. **The logo route defined twice** (`packages/identity/src/identity.config.ts:18`). The package index no longer exports
   `LOGO_PROXY_PATH`/`LOGO_PROXY_PARAM` (index lists identity.config's geometry constants by name), so after the merge
   the only exported route contract is b-cards' `endpoints.logo`; only `logoProxyUrl` reads the two constants. At merge
   (after b-cards lands): put the path in `@hako/config` hosts (e.g. `HAKO_GATEWAY_PATHS.logo = "/v1/logo"`), make
   b-cards' `endpoints.logo.path` and `logoProxyUrl` read it, keep `src` as the one query key, and delete the two
   constants. Not reading `endpoints.logo.path` from @hako/cards directly: identity → cards would cycle as soon as the
   React cards draw `Mark` (cards → identity).
   **Fixed (third pass, `w04/fix-a-brand`):** `packages/config/src/hosts.ts` now owns the route:
   `HAKO_LOGO_PROXY_PATH = "/v1/logo"` and `HAKO_LOGO_PROXY_PARAM = "src"`, next to `HAKO_MCP_URL` (index re-exports
   hosts). `packages/cards/src/contract/gateway/endpoints.ts` uses `path: HAKO_LOGO_PROXY_PATH`, `read-schemas.ts` uses
   `z.object({ [HAKO_LOGO_PROXY_PARAM]: urlSchema })` (the inferred key is still `src`), and
   `packages/identity/src/logo-proxy.ts` imports both from `@hako/config`. `LOGO_PROXY_PATH`/`LOGO_PROXY_PARAM` and
   their comment are gone from `identity.config.ts`; `rg LOGO_PROXY packages apps` finds only the two config constants and their
   three readers. Typecheck of @hako/config, @hako/cards (incl. the schema check) and @hako/identity passes.
7. **`radix-ui` was a caret range** (`packages/ui/package.json:32`). Pinned to `1.6.7`, the version pnpm-lock.yaml
   resolves (and apps/web uses); lockfile committed. apps/web/package.json (not this lane's file) still says `^1.6.7`; the
   coordinator can pin it to `1.6.7` too (or add a catalog entry for both).
   **Fixed (third pass, `w04/fix-a-brand`):** `apps/web/package.json:30` is now `"radix-ui": "1.6.7"` (the first
   option: no catalog entry, so `pnpm-workspace.yaml` is untouched). `pnpm install` changed one lockfile line, the
   apps/web importer's specifier `^1.6.7` → `1.6.7` (same resolved version); pnpm-lock.yaml committed.
8. **tokens.json `_note` path** (`packages/brand/tokens.json:2`). Now says `generated/tokens.ts`.

Gates after the fixes, from the worktree root: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck &&
pnpm build` (lint: warnings only, all in installed author code). No plugin-safe source was touched.

Third pass (`w04/fix-a-brand`, findings 5, 6, 7): `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck &&
pnpm build && pnpm -r --if-present test` pass (lint: 5 warnings in @hako/ui author code, 0 errors). hosts.ts
is a plugin-safe source, so `plugins/paybox` ran `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build`
(node 24.21.0): passes.
