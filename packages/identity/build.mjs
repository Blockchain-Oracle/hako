// Generates DOM React components from svg/*.svg (and the Hako mark from @hako/brand) into src/generated/, one file per
// stem plus an index that maps the stem to its component. Run: pnpm --filter @hako/identity build
// Kawase's identity build (tamion/packages/identity/build.mjs) used SVGR + SVGO; this one has no dependencies: it
// parses the plain SVG the sources publish, inlines `<style>` class rules, turns `style` and attribute names into JSX,
// and prefixes every id with the stem, because gradient and clip ids are global in a page. It never edits a shape.
// Files whose stem ends in "-mono" get their black/white fills and strokes replaced by currentColor so the app can
// tint them (and only them). Every source has a row in PROVENANCE.md.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const here = (file) => new URL(file, import.meta.url);
const SVG_DIR = here("svg/");
const OUT = here("src/generated/");
const HEADER = "// GENERATED from svg/ by build.mjs. Do not edit; replace the SVG and rebuild.\n";
/** Marks that live in another package: Hako's own (packages/brand, generated from mark.json). `hako` is the adaptive
 * file (body in the current colour, lid in the accent), so it reads on the dark card as on the light one. */
const EXTERNAL = {
  hako: here("../brand/assets/hako-mark-adaptive.svg"),
  "hako-mono": here("../brand/assets/hako-mark-ink.svg"),
};
const MONO_COLORS = new Set(["#000", "#000000", "#fff", "#ffffff", "black", "white"]);
const COLOR_ATTRS = ["fill", "stroke", "stop-color"];
const ELEMENTS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "linearGradient",
  "radialGradient", "stop", "clipPath", "mask", "use", "pattern", "filter", "feFlood", "feBlend", "feGaussianBlur",
  "feColorMatrix", "feOffset", "feComposite", "feMerge", "feMergeNode",
]);
/** Dropped wherever they appear: they carry no shape (the Mark sets its own accessible name). */
const DROPPED_ELEMENTS = new Set(["title", "desc", "metadata", "style"]);
const ROOT_DROP = new Set(["xmlns", "xmlns:xlink", "version", "width", "height", "class", "id", "style", "x", "y", "overflow", "role", "aria-label", "aria-labelledby", "enable-background", "xml:space", "preserveAspectRatio", "data-name"]);
const ANY_DROP = new Set(["class", "data-name", "enable-background"]);
/** SVG attributes spelled in camelCase in the markup itself: React takes them as they are. */
const NATIVE_CAMEL = new Set(["viewBox", "gradientUnits", "gradientTransform", "maskUnits", "maskContentUnits", "patternUnits", "patternTransform", "clipPathUnits", "stdDeviation", "filterUnits", "primitiveUnits", "preserveAspectRatio"]);
const SPECIAL = { "xlink:href": "xlinkHref", "xml:space": "xmlSpace" };
/** CSS properties that are SVG presentation attributes: a `style` or class rule becomes the attribute. */
const PRESENTATION = new Set(["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-dasharray", "opacity", "clip-rule", "stop-color", "stop-opacity", "mix-blend-mode", "isolation"]);

// ---- parse ----------------------------------------------------------------------------------------------------------

function parse(text, file) {
  const clean = text
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const token = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of clean.matchAll(token)) {
    const [, close, open, rawAttrs, selfClose, text] = m;
    const top = stack.at(-1);
    if (close) {
      if (top.tag !== close) throw new Error(`${file}: </${close}> closes <${top.tag}>`);
      stack.pop();
    } else if (open) {
      const attrs = {};
      for (const a of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
      const node = { tag: open, attrs, children: [] };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    } else if (text && text.trim()) {
      top.children.push({ text: text.trim() });
    }
  }
  const svg = root.children.find((n) => n.tag === "svg");
  if (!svg) throw new Error(`${file}: no <svg> root`);
  return svg;
}

const declarations = (css) =>
  Object.fromEntries(
    css
      .split(";")
      .map((d) => d.split(":"))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k.trim(), v.join(":").trim()]),
  );

/** `.a, .b { fill: #fff }` rules from every <style> block; anything but a plain class selector fails the build. */
function classRules(node, file, rules = {}) {
  for (const child of node.children ?? []) {
    if (child.tag === "style") {
      const css = child.children.map((c) => c.text ?? "").join(" ").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        for (const selector of selectors.split(",").map((s) => s.trim())) {
          if (!/^\.[\w-]+$/.test(selector)) throw new Error(`${file}: unsupported style selector "${selector}"`);
          rules[selector.slice(1)] = { ...rules[selector.slice(1)], ...declarations(body) };
        }
      }
    } else classRules(child, file, rules);
  }
  return rules;
}

// ---- transform ------------------------------------------------------------------------------------------------------

function transform(node, ctx, isRoot = false) {
  if (!ELEMENTS.has(node.tag)) throw new Error(`${ctx.file}: unsupported element <${node.tag}>`);
  const attrs = {};
  const style = {};
  // Class rules first, then the element's own attributes, then its inline style (the CSS cascade's order).
  for (const cls of (node.attrs.class ?? "").split(/\s+/).filter(Boolean)) Object.assign(attrs, ctx.rules[cls] ?? {});
  for (const [k, v] of Object.entries(node.attrs)) {
    if (ANY_DROP.has(k) || (isRoot && ROOT_DROP.has(k)) || k.startsWith("xmlns")) continue;
    if (k === "style") {
      for (const [prop, value] of Object.entries(declarations(v))) {
        if (value.startsWith("color(")) continue; // a display-p3 duplicate of an sRGB value set just before it
        if (PRESENTATION.has(prop)) attrs[prop] = value;
        else style[prop] = value;
      }
      continue;
    }
    attrs[k] = v;
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "id") attrs[k] = `${ctx.prefix}-${v}`;
    else if (typeof v === "string") attrs[k] = v.replace(/url\(#([^)]+)\)/g, `url(#${ctx.prefix}-$1)`).replace(/^#(?![0-9a-fA-F]{3,8}$)([\w-]+)$/, `#${ctx.prefix}-$1`);
    if (ctx.mono && COLOR_ATTRS.includes(k) && MONO_COLORS.has(String(attrs[k]).toLowerCase())) attrs[k] = "currentColor";
  }
  const children = [];
  for (const child of node.children) {
    if (child.text !== undefined) throw new Error(`${ctx.file}: text inside <${node.tag}>`);
    if (DROPPED_ELEMENTS.has(child.tag)) continue;
    children.push(transform(child, ctx));
  }
  return { tag: node.tag, attrs, style, children };
}

// ---- emit JSX -------------------------------------------------------------------------------------------------------

const camel = (name) => SPECIAL[name] ?? (NATIVE_CAMEL.has(name) || name.startsWith("data-") || name.startsWith("aria-") ? name : name.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase()));
const jsxValue = (value) => (/["\\]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`);

function emit(node, rootExtras = "") {
  const parts = Object.entries(node.attrs).map(([k, v]) => `${camel(k)}=${jsxValue(String(v))}`);
  if (Object.keys(node.style).length) {
    const entries = Object.entries(node.style).map(([k, v]) => `${JSON.stringify(camel(k))}: ${JSON.stringify(v)}`);
    parts.push(`style={{ ${entries.join(", ")} }}`);
  }
  const open = `<${node.tag}${parts.length ? " " + parts.join(" ") : ""}${rootExtras}`;
  return node.children.length ? `${open}>${node.children.map((c) => emit(c)).join("")}</${node.tag}>` : `${open} />`;
}

const componentName = (stem) =>
  "Mark" +
  stem
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

function build(stem, url) {
  const file = url.pathname;
  const svg = parse(readFileSync(url, "utf8"), file);
  const mono = stem.endsWith("-mono");
  const ctx = { file, prefix: stem, mono, rules: classRules(svg, file) };
  const root = transform(svg, ctx, true);
  if (!root.attrs.viewBox) {
    const { width, height } = svg.attrs;
    if (!width || !height) throw new Error(`${file}: no viewBox and no width/height`);
    root.attrs.viewBox = `0 0 ${parseFloat(width)} ${parseFloat(height)}`;
  }
  // A mono file draws in the current colour even where the source left the fill to its black default.
  if (mono && !root.attrs.fill) root.attrs.fill = "currentColor";
  const name = componentName(stem);
  return (
    HEADER +
    `import type { SVGProps } from "react";\n\n` +
    `const ${name} = (props: SVGProps<SVGSVGElement>) => (\n  ${emit(root, ` width="100%" height="100%" {...props}`)}\n);\n\n` +
    `export default ${name};\n`
  );
}

const stems = [
  ...readdirSync(SVG_DIR)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.replace(/\.svg$/, "")),
  ...Object.keys(EXTERNAL),
].sort();
const source = (stem) => EXTERNAL[stem] ?? new URL(`${stem}.svg`, SVG_DIR);

// Files are overwritten in place and only stale ones removed: wiping the folder first makes a running dev server see
// the index missing for a moment and drop the hot update.
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) {
  const stem = file.replace(/\.tsx?$/, "");
  if (stem !== "index" && !stems.includes(stem)) rmSync(new URL(file, OUT));
}
for (const stem of stems) writeFileSync(new URL(`${stem}.tsx`, OUT), build(stem, source(stem)));

const index =
  HEADER +
  stems.map((stem) => `import ${componentName(stem)} from "./${stem}.tsx";`).join("\n") +
  "\n\n/** File stem → component. A stem that is absent has not been delivered (see PROVENANCE.md). */\n" +
  `export const MARKS = {\n${stems.map((stem) => `  "${stem}": ${componentName(stem)},`).join("\n")}\n} as const;\n\n` +
  "export type MarkStem = keyof typeof MARKS;\n";
writeFileSync(new URL("index.ts", OUT), index);
console.log(`identity: ${stems.length} mark(s) -> src/generated (DOM components)`);
