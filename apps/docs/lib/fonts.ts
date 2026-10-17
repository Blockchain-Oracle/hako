import localFont from "next/font/local";

/**
 * The paint's three faces (packages/brand/tokens/paint.css: Outfit display, Inter body, JetBrains Mono data),
 * self-hosted from packages/brand/assets/fonts, the same files and variables as apps/web.
 */
const outfit = localFont({
  src: "../../../packages/brand/assets/fonts/outfit-latin.woff2",
  weight: "100 900",
  variable: "--font-outfit",
  display: "swap",
});
const inter = localFont({
  src: "../../../packages/brand/assets/fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = localFont({
  src: "../../../packages/brand/assets/fonts/jetbrains-mono-latin.woff2",
  weight: "100 800",
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = [outfit, inter, jetbrains].map((f) => f.variable).join(" ");
