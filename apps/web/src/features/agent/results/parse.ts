/**
 * Loose readers for provider data. Every field is optional and may hold the wrong type (null fields are dropped by
 * the engine, and many providers feed the same card), so each reader returns a typed value or null, never throws.
 */

export type Rec = Record<string, unknown>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rec(value: unknown): Rec {
  return isRecord(value) ? value : {};
}

/** A non-empty string (finite numbers become strings), else null. */
export function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A finite number (numeric strings count), else null. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function records(value: unknown): Rec[] {
  return list(value).filter(isRecord);
}

/** Strings from an array, a comma list, or a single string. */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return list(value).map(str).filter((s): s is string => s !== null);
}

/** The first key of `o` holding a usable string. */
export function pickStr(o: Rec, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = str(o[key]);
    if (value !== null) return value;
  }
  return null;
}

export function pickNum(o: Rec, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = num(o[key]);
    if (value !== null) return value;
  }
  return null;
}

/** The first key of `o` holding an array of records. */
export function pickRecords(o: Rec, ...keys: string[]): Rec[] {
  for (const key of keys) {
    if (Array.isArray(o[key])) return records(o[key]);
  }
  return [];
}

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);
const GIT_PREFIX = /^git\+/i;
const GIT_SSH = /^git@([^:]+):(.+)$/i;
const DOT_GIT = /\.git$/i;

/** An http(s) URL safe to put in an href (git+https and git@host:path become https), else null. */
export function safeHref(value: unknown): string | null {
  let raw = str(value);
  if (!raw) return null;
  raw = raw.replace(GIT_PREFIX, "");
  const ssh = GIT_SSH.exec(raw);
  if (ssh) raw = `https://${ssh[1]}/${ssh[2]}`;
  if (raw.startsWith("git://")) raw = `https://${raw.slice("git://".length)}`;
  try {
    const url = new URL(raw);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (url.hostname === "github.com") url.pathname = url.pathname.replace(DOT_GIT, "");
    return url.toString();
  } catch {
    return null;
  }
}

/** A URL's host without "www.", for "from example.com" labels. */
export function hostOf(value: unknown): string | null {
  const href = safeHref(value);
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const DOI_PREFIX = /^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i;

export function doiHref(doi: unknown): string | null {
  const raw = str(doi);
  if (!raw) return null;
  return safeHref(`https://doi.org/${raw.replace(DOI_PREFIX, "")}`);
}

/** Authors as one line: a string, a list of strings, or a list of {name}. */
export function authorsOf(value: unknown): string | null {
  if (typeof value === "string") return str(value);
  const names = list(value)
    .map((a) => (isRecord(a) ? pickStr(a, "name", "display_name", "full_name") : str(a)))
    .filter((s): s is string => s !== null);
  return names.length ? names.join(", ") : null;
}

/** Map links: OpenStreetMap from coordinates (lat/lon in any of the usual spellings). */
export function coordsOf(o: Rec): { lat: number; lon: number } | null {
  const lat = pickNum(o, "lat", "latitude");
  const lon = pickNum(o, "lon", "lng", "longitude");
  if (lat === null || lon === null) return null;
  return { lat, lon };
}

/** A unique, stable key from a row's likely identifiers, falling back to its position. */
export function rowKey(o: Rec, index: number, ...keys: string[]): string {
  const id = pickStr(o, ...keys, "id", "url");
  return id ? `${id}-${index}` : String(index);
}
