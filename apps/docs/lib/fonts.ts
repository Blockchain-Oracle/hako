import { Inter, Roboto_Condensed } from "next/font/google";

/**
 * The same two faces as apps/web (packages/brand/tokens.json `fonts`): Inter for the interface, Roboto Condensed for
 * titles and figures. The variable names must match tokens.json; next/font takes literals only.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const robotoCondensed = Roboto_Condensed({ subsets: ["latin"], variable: "--font-roboto-condensed", display: "swap" });

export const fontVariables = [inter, robotoCondensed].map((f) => f.variable).join(" ");
