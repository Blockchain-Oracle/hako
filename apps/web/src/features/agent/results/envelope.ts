import { bool, hostOf, isRecord, num, type Rec, rec, records, str, strings } from "./parse";

/** One upstream the run touched (hako_core SourceRef). */
export interface SourceRef {
  name: string;
  status: string | null;
  url: string | null;
  attribution: string | null;
  licence: string | null;
}

/** The run envelope, read loosely: every field has a safe default. */
export interface Envelope {
  endpoint: string;
  provider: string;
  render: string;
  found: boolean;
  billable: boolean | null;
  cached: boolean;
  asOf: string | null;
  elapsedMs: number | null;
  notes: string[];
  sources: SourceRef[];
  data: unknown;
}

const UNKNOWN_ENDPOINT = "unknown/tool";
const PATH_SEPARATOR = "/";

function readSource(o: Rec): SourceRef | null {
  const name = str(o.name);
  if (!name) return null;
  return {
    name,
    status: str(o.status),
    url: str(o.url),
    attribution: str(o.attribution),
    licence: str(o.licence ?? o.license),
  };
}

/** One entry per upstream and host: a tool that calls the same API twice lists it twice. */
function readSources(value: unknown): SourceRef[] {
  const seen = new Set<string>();
  return records(value)
    .map(readSource)
    .filter((s): s is SourceRef => {
      if (s === null) return false;
      const key = `${s.name}|${hostOf(s.url) ?? ""}|${s.status ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Notes from the envelope and, for tools that keep their own, from `data.notes`; duplicates once. */
function readNotes(envelope: Rec, data: unknown): string[] {
  const all = [...strings(envelope.notes), ...(isRecord(data) && Array.isArray(data.notes) ? strings(data.notes) : [])];
  return [...new Set(all)];
}

export function readEnvelope(value: unknown): Envelope | null {
  if (!isRecord(value) || !("data" in value || "render" in value || "endpoint" in value)) return null;
  const endpoint = str(value.endpoint) ?? UNKNOWN_ENDPOINT;
  const provider = str(value.provider) ?? endpoint.split(PATH_SEPARATOR)[0] ?? endpoint;
  return {
    endpoint,
    provider,
    render: str(value.render) ?? "json",
    found: bool(value.found) ?? !(isRecord(value.data) && value.data.found === false),
    billable: bool(value.billable),
    cached: bool(value.cached) ?? false,
    asOf: str(value.as_of),
    elapsedMs: num(value.elapsed_ms),
    notes: readNotes(value, value.data),
    sources: readSources(value.sources),
    data: value.data,
  };
}

/** A failed run's body: `{error: {code, message, details}}`, the inner object, or a bare string. */
export function readError(error: unknown): { code: string | null; message: string | null; details: string[] } {
  if (typeof error === "string") return { code: null, message: str(error), details: [] };
  const outer = rec(error);
  const inner = isRecord(outer.error) ? outer.error : outer;
  return {
    code: str(inner.code),
    message: str(inner.message) ?? str(inner.detail) ?? (typeof inner.error === "string" ? str(inner.error) : null),
    details: Array.isArray(inner.details) ? strings(inner.details) : [str(inner.details)].filter((s): s is string => s !== null),
  };
}
