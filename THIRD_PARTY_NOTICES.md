# Third-party notices

Hako starts from the same author's Akashi codebase ([Blockchain-Oracle/akashi](https://github.com/Blockchain-Oracle/akashi),
MIT); [README.md](README.md#pre-existing-code-and-where-it-came-from) records the exact commits. This file records
where parts of that design came from and the attribution for the data Hako serves. It does not grant a licence to
Hako as a whole, change any upstream terms, or imply endorsement by the projects named. File-level notices and each
dependency's own licence still apply.

## Monid: Akashi's look and the tool-router idea

The website Hako starts from is Akashi's, and Akashi's look followed [monid.ai](https://monid.ai): its palette, type
scale, radii and the layout of its landing page, tool catalog and docs, read from monid.ai's own stylesheet on
2026-10-07. Hako replaced that palette, type and radii with Senryo, the design system of Kawase, the owner's own
project (`packages/brand/tokens.json`, with Hako's own accent). The tool catalog and docs pages that still follow a
Monid layout name it in a comment. No code or asset from monid.ai is included.

Monid's open connector repository ([monid-ai/monid](https://github.com/monid-ai/monid), MIT) was read, for Akashi, as
a reference for the connector format. No files are copied from it; the connector framework is the author's own
Python code.

## The author's earlier projects

Parts of the chat interface, carried over from Akashi, are ported from the same author's own project, and each
file names its source in a comment: KeeperHub Copilot v2 (tool timeline, composer, conversation history). Some of
those components started from 21st.dev community components, named in their comments.

## Fonts

| Font | Terms | Where |
| --- | --- | --- |
| Inter | SIL Open Font License 1.1 | downloaded at build time by `next/font/google` and served by each app (`lib/fonts.ts`) |
| Roboto Condensed | SIL Open Font License 1.1 | the same |

The Hako mark is drawn from geometry (`packages/brand/mark.json`); no font is drawn into it.

## Data served by the tools

Every answer names its sources, with the licence and attribution each provider asks for (`sources[]` in the run
envelope; set per provider in `packages/tools/src/hako_tools/connectors/*/provider.py`). Among them:

- Wikipedia and Wikidata: CC BY-SA 4.0 and CC0, Wikipedia contributors.
- OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0; geocoding by Nominatim.
- Open-Meteo: weather data CC BY 4.0, Open-Meteo.com; geocoding from GeoNames (CC BY 4.0).
- Frankfurter: reference rates published by the European Central Bank and other central banks.
- CoinGecko: "Data provided by CoinGecko".
- NASA and USGS: US Government works, public domain (image credits as stated per image).
- OpenAlex (CC0), Crossref and arXiv metadata; Open Food Facts (ODbL); PubChem (NCBI).

Provider logos in `apps/web/public/logos/` are the providers' own icons, used only to identify each integration.

## Packaged libraries

Packaged libraries keep their own notices. Among them: React and Next.js (MIT), the AI SDK (Apache-2.0), x402
(Apache-2.0), viem (MIT), the Model Context Protocol SDK (MIT), Hono (MIT), FastAPI and pydantic (MIT), Fumadocs
(MIT) and Lucide (ISC). This list is a guide to attribution. It does not replace the lockfiles or the full licence
text shipped with each dependency.
