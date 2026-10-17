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
  `generated/mark.ts` and the five mark assets. `scripts/check-contrast.mjs` runs in the package's `build`, so turbo
  runs it before web and docs (`^build`) and in the Docker build: it exits 1 when a text pair drops below 4.5:1 or the
  ring/accent fill below 3:1 on a card. `packages/brand/turbo.json` declares the generated outputs.
- Same export names as before: `.` (BRAND, `tokens`, `MARK`, `MARK_SVG`), `./react` (`HakoMark`, `HakoLockup`),
  `./paint.css` (now `generated/web.css`), `./assets/*` (`hako-mark.svg`, `hako-mark-ink.svg`, `hako-mark-inverse.svg`,
  `app-icon.svg`, `favicon.svg`).
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
- 116 SVGs in `svg/` + the Hako mark read from `packages/brand/assets` → `build.mjs` (dependency-free: no SVGR/SVGO, as
  those are not §3 pins) → `src/generated/*.tsx` DOM components + `MARKS`. It inlines `<style>` class rules, maps
  attributes and `style` to JSX, prefixes every id with the stem, and turns black/white into `currentColor` in `-mono`
  files. Every generated mark was rendered (react-dom/server) and compared with its source raster: identical.
  `build` runs in turbo after `@hako/brand` (devDependency).
- `PROVENANCE.md`: one row per file (117 incl. the Hako mark) + a "Not delivered yet" table. Kawase rows reused for
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
  `sidebar-001-utils/context.tsx`, moved unchanged), task-steps 23569, stepper primitive of 29815 (its demo file with
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
- Dependencies: catalog entries for everything in §3; `radix-ui ^1.6.7` (as apps/web) and `@base-ui/react 1.8.0` are
  the installs' own runtime deps (no catalog entry). No tabler, remixicon, hugeicons, framer-motion, clsx or
  tailwind-merge in `@hako/ui`.
- `apps/web/src/components/ui/*` (identical to the new installs apart from imports) and `lib/utils.ts` are deleted;
  19 web files import `@hako/ui/components/ui/*` and `@hako/ui/lib/utils`. `apps/web/components.json`: `ui` and `utils`
  aliases point at `@hako/ui` (style unchanged, radix-nova).

## Open (for the coordinator)
- `app/layout.tsx` (shared wiring): wrap with `<TooltipProvider>` (shadcn tooltip asks for it) and, where the gateway is
  not production, `<LogoProxyProvider gatewayUrl={GATEWAY_URL}>`; the default is `HAKO_GATEWAY_URL`
  (`api.usehako.xyz`, not resolving yet on 2026-10-17, so remote logos fall back to the disc until DNS is up).
- `LOGO_PROXY_PATH = "/v1/logo"` lives in `packages/identity/src/identity.config.ts`; fold it into `@hako/config`
  hosts (and the cards endpoint table) at merge if L1's route lands there.
- Provider ids for the C16 catalog providers are assumed `exa`, `artificial-analysis`, `elevenlabs`, `polymarket`,
  `jupiter`, `lifi`, `helius`; L2 uses these or the registry gets an alias.
- `apps/web/package.json` still lists `clsx`, `tailwind-merge`, `class-variance-authority`, `radix-ui` that only the
  moved components used (lanes add dependency lines only; the coordinator may drop them).
- `THIRD_PARTY_NOTICES.md` (root) was updated where it described the deleted brand files, fonts and raster logos.
- `public/agents/*.svg` (simple-icons host marks under the tools pages) are still used by L3's tools pages; L3 can move
  them to identity hosts later.
- The 21st registry returns `registryDependencies` URLs that embed the API key; my fetch printed one in a local tool
  output during the install (nothing written to the repo; `rg 21st_sk_` is clean). Rotating `API_KEY_21ST` is cheap.
