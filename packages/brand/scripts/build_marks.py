#!/usr/bin/env python3
"""Build the Hako 証 marks (SVG) from the real fonts, so no asset depends on a font being installed.

    uv run --with fonttools python packages/brand/scripts/build_marks.py

The 証 glyph comes from Shippori Mincho B1 ExtraBold and the wordmark from IBM Plex Sans Medium (variable font,
instanced at wght 500), both OFL, fetched from github.com/google/fonts into a cache directory on first run.
Colours are the oklch tokens of tokens/theme.css, converted to hex here because favicons and external tools do
not all read oklch.
"""

import math
import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BRAND_DIR = Path(__file__).resolve().parents[1]
ASSETS = BRAND_DIR / "assets"
FONT_CACHE = Path.home() / ".cache" / "hako-brand-fonts"
GOOGLE_FONTS = "https://github.com/google/fonts/raw/main/ofl"
MINCHO = ("shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf", "ShipporiMinchoB1-ExtraBold.ttf")
PLEX = ("ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf", "IBMPlexSans-var.ttf")
PLEX_MEDIUM_WEIGHT = 500
KANJI = "証"

# --- the seal, on a 240-unit square (specs/web.md §2) ---
SEAL = 240
OUTER_INSET, OUTER_STROKE = 12, 4.0  # the outer rule
INNER_INSET, INNER_STROKE = 22, 1.5  # the hairline inner rule
CORNER_GAP = 62  # both rules stop this far from the lower-right corner: the check closes it
GLYPH_BOX = 134  # 証 fits a square of this size, centred on the inner frame
CHECK = ((182, 203), (199, 220), (234, 176))  # in the open corner: short arm down, long arm out past the frame
CHECK_STROKE = 11.0

# --- wordmark: HAKO, +0.18em tracking, a rule, then 証 ---
WORD = "HAKO"
WORD_TRACKING_EM = 0.18
WORD_CAP_HEIGHT = 40.0  # units of the wordmark canvas
WORD_RULE_GAP = 22.0
WORD_RULE_STROKE = 1.5
WORD_KANJI_SCALE = 1.45  # 証 set a little taller than the caps, like a stamp beside a signature
WORD_PADDING = 4.0

APP_ICON = 512
APP_ICON_SEAL_SHARE = 0.72

# oklch tokens (tokens/theme.css): ink, paper, indigo light/dark
INK = (0.20, 0.010, 260)
PAPER = (0.975, 0.006, 85)
INDIGO = (0.45, 0.14, 265)
INDIGO_ON_DARK = (0.72, 0.12, 265)
SUMI = (0.16, 0.008, 260)
PAPER_ON_DARK = (0.95, 0.005, 85)


def oklch_hex(lightness: float, chroma: float, hue_deg: float) -> str:
    """OKLCH → sRGB hex (Björn Ottosson's OKLab matrices), clipped to gamut."""
    hue = math.radians(hue_deg)
    a, b = chroma * math.cos(hue), chroma * math.sin(hue)
    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b
    lc, mc, sc = l_**3, m_**3, s_**3
    linear = (
        4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
        -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
        -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
    )

    def gamma(x: float) -> int:
        x = min(max(x, 0.0), 1.0)
        v = 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055  # noqa: PLR2004 (sRGB transfer)
        return round(v * 255)

    return "#" + "".join(f"{gamma(c):02x}" for c in linear)


def font(spec: tuple[str, str]) -> Path:
    remote, local = spec
    path = FONT_CACHE / local
    if not path.exists():
        FONT_CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f"{GOOGLE_FONTS}/{remote}", path)
    return path


def glyph_path(tt: TTFont, char: str, box: tuple[float, float, float, float]) -> str:
    """The glyph's outline fitted (aspect kept, centred) into box = (x, y, width, height), y pointing down."""
    glyph_set = tt.getGlyphSet()
    name = tt.getBestCmap()[ord(char)]
    bounds = BoundsPen(glyph_set)
    glyph_set[name].draw(bounds)
    x_min, y_min, x_max, y_max = bounds.bounds
    bx, by, bw, bh = box
    scale = min(bw / (x_max - x_min), bh / (y_max - y_min))
    dx = bx + (bw - (x_max - x_min) * scale) / 2 - x_min * scale
    dy = by + (bh - (y_max - y_min) * scale) / 2 + y_max * scale
    pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, dx, dy)))
    return pen.getCommands()


def open_frame(inset: float) -> str:
    """A square frame that stops CORNER_GAP short of the lower-right corner on both edges."""
    lo, hi = inset, SEAL - inset
    stop = SEAL - CORNER_GAP
    return f"M{hi} {stop}V{lo}H{lo}V{hi}H{stop}"


def seal_body(glyph: str, frame: str, ink: str, check: str) -> str:
    """frame / ink / check are the attributes that colour each part (fill/stroke values, or a class)."""
    points = "".join(f"{'M' if i == 0 else 'L'}{x} {y}" for i, (x, y) in enumerate(CHECK))
    return (
        f'<g fill="none" stroke-linecap="square" {frame}>'
        f'<path d="{open_frame(OUTER_INSET)}" stroke-width="{OUTER_STROKE}"/>'
        f'<path d="{open_frame(INNER_INSET)}" stroke-width="{INNER_STROKE}"/></g>'
        f'<path d="{glyph}" {ink}/>'
        f'<path d="{points}" fill="none" stroke-width="{CHECK_STROKE}" stroke-linecap="square" {check}/>'
    )


def colours(ink: str, accent: str) -> tuple[str, str, str]:
    return f'stroke="{ink}"', f'fill="{ink}"', f'stroke="{accent}"'


def svg(width: float, height: float, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}" role="img" '
        f'aria-label="{title}"><title>{title}</title>{body}</svg>\n'
    )


def wordmark(plex: TTFont, mincho: TTFont, ink: str) -> tuple[str, tuple[str, str, str, float, float, str]]:
    """(svg body, (letters, rule, kanji, width, height, letters-only viewBox cropped to the caps))."""
    glyph_set = plex.getGlyphSet()
    cmap = plex.getBestCmap()
    units = plex["head"].unitsPerEm
    cap = plex["OS/2"].sCapHeight
    scale = WORD_CAP_HEIGHT / cap
    tracking = WORD_TRACKING_EM * units
    parts, x = [], WORD_PADDING
    baseline = WORD_PADDING + WORD_CAP_HEIGHT * (WORD_KANJI_SCALE - 1) / 2 + WORD_CAP_HEIGHT
    for i, char in enumerate(WORD):
        name = cmap[ord(char)]
        pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        parts.append(pen.getCommands())
        advance = glyph_set[name].width + (tracking if i < len(WORD) - 1 else 0)
        x += advance * scale
    rule_x = x + WORD_RULE_GAP
    kanji_size = WORD_CAP_HEIGHT * WORD_KANJI_SCALE
    kanji_x = rule_x + WORD_RULE_GAP
    top = WORD_PADDING
    kanji = glyph_path(mincho, KANJI, (kanji_x, top, kanji_size, kanji_size))
    width = kanji_x + kanji_size + WORD_PADDING
    height = top + kanji_size + WORD_PADDING
    rule = f"M{rule_x:.2f} {top}V{top + kanji_size}"
    body = (
        f'<path d="{"".join(parts)}" fill="{ink}"/>'
        f'<path d="{rule}" stroke="{ink}" stroke-width="{WORD_RULE_STROKE}"/>'
        f'<path d="{kanji}" fill="{ink}"/>'
    )
    caps_top = baseline - WORD_CAP_HEIGHT - WORD_PADDING
    letters_box = f"0 {caps_top:.2f} {x + WORD_PADDING:.2f} {WORD_CAP_HEIGHT + 2 * WORD_PADDING:.2f}"
    return body, ("".join(parts), rule, kanji, width, height, letters_box)


def ts_module(glyph: str, word: tuple[str, str, str, float, float, str]) -> str:
    """Path data for React components, so the seal and wordmark draw with live tokens (currentColor, --primary)."""
    letters, rule, kanji, width, height, letters_box = word
    check = " ".join(f"{x},{y}" for x, y in CHECK)
    return f"""// Generated by scripts/build_marks.py (Shippori Mincho B1 ExtraBold, IBM Plex Sans Medium). Do not edit.
export const SEAL = {{
  viewBox: "0 0 {SEAL} {SEAL}",
  outer: {{ d: "{open_frame(OUTER_INSET)}", strokeWidth: {OUTER_STROKE} }},
  inner: {{ d: "{open_frame(INNER_INSET)}", strokeWidth: {INNER_STROKE} }},
  glyph: "{glyph}",
  check: {{ points: "{check}", strokeWidth: {CHECK_STROKE} }},
}} as const;

export const WORDMARK = {{
  viewBox: "0 0 {width:.2f} {height:.2f}",
  lettersViewBox: "{letters_box}",
  letters: "{letters}",
  rule: {{ d: "{rule}", strokeWidth: {WORD_RULE_STROKE} }},
  kanji: "{kanji}",
}} as const;
"""


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    mincho = TTFont(font(MINCHO))
    plex = instantiateVariableFont(TTFont(font(PLEX)), {"wght": PLEX_MEDIUM_WEIGHT, "wdth": 100})
    offset = (SEAL - GLYPH_BOX) / 2
    glyph = glyph_path(mincho, KANJI, (offset, offset, GLYPH_BOX, GLYPH_BOX))
    ink, paper = oklch_hex(*INK), oklch_hex(*PAPER)
    indigo, indigo_dark = oklch_hex(*INDIGO), oklch_hex(*INDIGO_ON_DARK)
    sumi, paper_dark = oklch_hex(*SUMI), oklch_hex(*PAPER_ON_DARK)
    title = "Hako 証 seal"
    files = {
        # currentColor: the mark takes the text colour wherever it is placed; only the check is indigo
        "hako-mark.svg": svg(SEAL, SEAL, seal_body(glyph, *colours("currentColor", indigo)), title),
        "hako-mark-ink.svg": svg(SEAL, SEAL, seal_body(glyph, *colours(ink, indigo)), title),
        "hako-mark-inverse.svg": svg(SEAL, SEAL, seal_body(glyph, *colours(paper_dark, indigo_dark)), title),
    }
    # favicon: follows the browser's colour scheme
    scheme = (
        f"<style>.s{{stroke:{ink}}}.f{{fill:{ink}}}.c{{stroke:{indigo}}}@media (prefers-color-scheme:dark)"
        f"{{.s{{stroke:{paper_dark}}}.f{{fill:{paper_dark}}}.c{{stroke:{indigo_dark}}}}}</style>"
    )
    files["favicon.svg"] = svg(SEAL, SEAL, scheme + seal_body(glyph, 'class="s"', 'class="f"', 'class="c"'), title)
    # app icon: the ink seal on washi paper
    seal_px = APP_ICON * APP_ICON_SEAL_SHARE
    pad = (APP_ICON - seal_px) / 2
    placed = f'transform="translate({pad:g} {pad:g}) scale({seal_px / SEAL:g})"'
    files["app-icon.svg"] = svg(
        APP_ICON,
        APP_ICON,
        f'<rect width="{APP_ICON}" height="{APP_ICON}" fill="{paper}"/>'
        f"<g {placed}>{seal_body(glyph, *colours(ink, indigo))}</g>",
        title,
    )
    body, word = wordmark(plex, mincho, "currentColor")
    width, height = word[3], word[4]
    files["wordmark.svg"] = svg(width, height, body, "HAKO 証")
    body_ink, _ = wordmark(plex, mincho, ink)
    files["wordmark-ink.svg"] = svg(width, height, body_ink, "HAKO 証")
    for name, text in files.items():
        (ASSETS / name).write_text(text)
    (BRAND_DIR / "src" / "marks.generated.ts").write_text(ts_module(glyph, word))
    print(f"wrote {', '.join(files)} → {ASSETS}")
    print(f"ink {ink} · paper {paper} · indigo {indigo} / {indigo_dark} · sumi {sumi}")


if __name__ == "__main__":
    main()
