// Checks every text pair of both themes against WCAG AA (4.5:1) and every UI boundary against 3:1, and exits 1 on any
// failure, so `pnpm build` (turbo runs this package's build before the apps') fails when a token change breaks
// legibility. Kawase's check (tamion/packages/ui-tokens/check-contrast.mjs) with Hako's two themes.
// Run: node packages/brand/scripts/check-contrast.mjs
import { readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync(new URL("../tokens.json", import.meta.url), "utf8"));

const AA_TEXT = 4.5;
const AA_UI = 3;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const SRGB_THRESHOLD = 0.04045;
const SRGB_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };
const CONTRAST_OFFSET = 0.05;
const HEX_OPAQUE = 6;
const CHANNEL_DIGITS = 2;
const DECIMALS = 2;
const LUMINANCE_DECIMALS = 3;

const channel = (hex, index) => parseInt(hex.slice(index, index + CHANNEL_DIGITS), HEX_RADIX) / CHANNEL_MAX;
const linear = (c) => (c <= SRGB_THRESHOLD ? c / SRGB_DIVISOR : ((c + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA);
const rgb = (hex) => {
  const body = hex.replace("#", "");
  return { r: channel(body, 0), g: channel(body, 2), b: channel(body, 4), a: body.length > HEX_OPAQUE ? channel(body, HEX_OPAQUE) : 1 };
};
// Translucent tokens are composited on the theme background before measuring.
const over = (top, base) => ({
  r: top.r * top.a + base.r * (1 - top.a),
  g: top.g * top.a + base.g * (1 - top.a),
  b: top.b * top.a + base.b * (1 - top.a),
  a: 1,
});
const luminance = ({ r, g, b }) => LUMA.r * linear(r) + LUMA.g * linear(g) + LUMA.b * linear(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + CONTRAST_OFFSET) / (lo + CONTRAST_OFFSET);
};

const themes = { light: tokens.themes.light, dark: tokens.themes.dark };

// [text, surface] pairs that carry words.
const TEXT_PAIRS = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "popover"],
  ["foreground", "secondary"],
  ["foreground", "muted"],
  ["foreground", "raised-2"],
  ["foreground", "row-pressed"],
  ["foreground", "selected-row"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "raised-2"],
  ["text-3", "background"],
  ["text-3", "card"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-pressed"],
  // The accent is a fill with a black label (Senryo); text in the accent's family is `link`.
  ["accent-foreground", "accent"],
  ["link", "background"],
  ["link", "card"],
  ["link", "selected-row"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["destructive", "destructive-surface"],
  ["success", "background"],
  ["success", "card"],
  ["up", "background"],
  ["up", "card"],
  ["up", "up-surface"],
  ["down", "background"],
  ["down", "card"],
  ["down", "down-surface"],
  ["warn", "background"],
  ["warn", "card"],
  ["warn", "warn-surface"],
  ["on-fill", "up-fill"],
  ["on-fill", "down-fill"],
  ["up-foreground", "up"],
  ["down-foreground", "down"],
  ["foreground", "glass"],
  ["muted-foreground", "glass"],
  ["foreground", "glass-opaque"],
];
// The focus ring and the accent fill sit on cards and pages; the primary fill and the deep silver only need to be seen.
const UI_PAIRS = [
  ["ring", "card"],
  ["accent", "card"],
  ["primary", "background"],
  ["silver-deep", "background"],
];
// Hairlines and decorative silver are meant to be faint; inputs and cards also carry a fill, so these are reported
// for the eye, not enforced.
const HAIRLINE_PAIRS = [
  ["border", "background"],
  ["border", "card"],
  ["silver", "background"],
  ["skeleton", "background"],
  ["ring", "background"],
];

let failures = 0;
for (const [theme, values] of Object.entries(themes)) {
  const bg = rgb(values.background);
  const resolve = (name) => over(rgb(values[name]), bg);
  const report = (pairs, floor, kind, enforce = true) => {
    for (const [a, b] of pairs) {
      const ratio = contrast(resolve(a), resolve(b));
      const ok = ratio >= floor;
      if (!ok && enforce) failures += 1;
      const mark = ok ? "ok  " : enforce ? "FAIL" : "info";
      console.log(`${mark} ${theme.padEnd(6)} ${kind.padEnd(4)} ${a} on ${b}: ${ratio.toFixed(DECIMALS)}`);
    }
  };
  report(TEXT_PAIRS, AA_TEXT, "text");
  report(UI_PAIRS, AA_UI, "ui");
  report(HAIRLINE_PAIRS, AA_UI, "hair", false);
}

const accent = rgb(tokens.accent.value);
console.log(
  `\naccent ${tokens.accent.name} ${tokens.accent.value}: luminance ${luminance(accent).toFixed(LUMINANCE_DECIMALS)}, ` +
    `black label ${contrast(rgb("#000000"), accent).toFixed(DECIMALS)}, ` +
    `on white ${contrast(rgb("#FFFFFF"), accent).toFixed(DECIMALS)}, ` +
    `on the dark card ${contrast(rgb(tokens.themes.dark.card), accent).toFixed(DECIMALS)}`,
);

if (failures) {
  console.error(`\n${failures} pair(s) below the floor`);
  process.exit(1);
}
console.log("all pairs pass");
