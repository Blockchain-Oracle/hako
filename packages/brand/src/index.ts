/**
 * @hako/brand: Hako's name, mark and design tokens (plan §6: Kawase's Senryo system with Hako's own accent).
 * tokens.json and mark.json are the sources; scripts/build.mjs generates generated/{web.css,tokens.ts,mark.ts} and the
 * SVG assets, and scripts/check-contrast.mjs fails the build when a text pair drops below 4.5:1.
 */
export const BRAND = {
  name: "Hako",
  kanji: "箱",
  meaning: "box",
} as const;

export { tokens } from "../generated/tokens.ts";
export type { ThemeName, TokenName } from "../generated/tokens.ts";
export { MARK, MARK_SVG } from "../generated/mark.ts";
