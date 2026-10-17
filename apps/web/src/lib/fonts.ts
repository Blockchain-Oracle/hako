import { Inter, Roboto_Condensed } from "next/font/google";

/**
 * Senryo's two faces (packages/brand/tokens.json `fonts`): Inter for the interface, Roboto Condensed (Black for money
 * and titles) for figures that roll. next/font downloads them at build time and serves them from this app, so no page
 * asks fonts.gstatic.com. The variable names must match tokens.json (`fonts.body.variable`, `fonts.display.variable`):
 * next/font takes literals only, and generated/web.css builds `--font-sans` and `--font-display` on them.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const robotoCondensed = Roboto_Condensed({ subsets: ["latin"], variable: "--font-roboto-condensed", display: "swap" });

export const fontVariables = [inter, robotoCondensed].map((f) => f.variable).join(" ");
