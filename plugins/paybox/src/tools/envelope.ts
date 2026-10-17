/**
 * Free reads answer with a catalog run envelope (`/v1/chain/*`, `/v1/markets`, `/v1/earn/{vaults,positions}`): the
 * structured content is the envelope as the gateway sent it; the text says what was found, or the connector's own
 * "nothing found" message, never an invented answer.
 */
import type { RunEnvelope } from "../wire/reads.js";

/** Keeps a text answer readable in PayBox's interface and far below the 256 KiB stdout cap. */
export const ENVELOPE_TEXT_MAX_CHARS = 12_000;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function notFoundMessage(envelope: RunEnvelope): string | null {
  if (envelope.found) return null;
  const message = isRecord(envelope.data) && typeof envelope.data.message === "string" ? envelope.data.message : "Nothing was found.";
  return message;
}

/** The envelope as an MCP result: the summary first (when one is given), then the data as JSON, bounded. */
export function envelopeResult(envelope: RunEnvelope, summarize?: (data: Record<string, unknown>) => string | null) {
  const missing = notFoundMessage(envelope);
  const source = envelope.sources.map((s) => s.name).join(", ");
  let text: string;
  if (missing !== null) {
    text = `${missing}${source ? ` (source: ${source})` : ""}`;
  } else {
    const summary = summarize && isRecord(envelope.data) ? summarize(envelope.data) : null;
    const json = JSON.stringify(envelope.data);
    const body = json.length > ENVELOPE_TEXT_MAX_CHARS ? `${json.slice(0, ENVELOPE_TEXT_MAX_CHARS)}… (truncated; full data in structured content)` : json;
    text = [summary, `Data${source ? ` from ${source}` : ""} as of ${envelope.as_of}: ${body}`].filter(Boolean).join("\n");
  }
  return { content: [{ type: "text" as const, text }], structuredContent: envelope };
}

/** Each row of `data[key]` as one line, when the data has that array. */
export function rows(data: Record<string, unknown>, key: string, line: (row: Record<string, unknown>) => string): string | null {
  const list = data[key];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.filter(isRecord).map(line).join("\n");
}
