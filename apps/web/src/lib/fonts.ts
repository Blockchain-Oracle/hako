import localFont from "next/font/local";

/**
 * Monid's three faces (packages/brand/tokens/paint.css), self-hosted from packages/brand/assets/fonts (Fontsource
 * variable woff2, latin subset, OFL) so a build never depends on fonts.gstatic.com.
 */
const outfit = localFont({
  src: "../../../../packages/brand/assets/fonts/outfit-latin.woff2",
  weight: "100 900",
  variable: "--font-outfit",
  display: "swap",
});
const inter = localFont({
  src: "../../../../packages/brand/assets/fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = localFont({
  src: "../../../../packages/brand/assets/fonts/jetbrains-mono-latin.woff2",
  weight: "100 800",
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = [outfit, inter, jetbrains].map((f) => f.variable).join(" ");
