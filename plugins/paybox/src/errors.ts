/**
 * Typed tool errors: every failure names a code, says what went wrong in words and that nothing was signed, paid or
 * moved. A tool never returns made-up data in place of an answer it didn't get, and never puts a proposal in an error.
 */

export type HakoErrorCode =
  /** The gateway doesn't serve this route yet (another lane is building it); the tool surface is ready for it. */
  | "gateway_route_missing"
  | "gateway_unreachable"
  | "gateway_timeout"
  /** The gateway answered outside the wire contract; the plugin refuses to guess. */
  | "gateway_contract_mismatch"
  /** The gateway's own error (`invalid_input`, `not_found`, `upstream_unavailable`…), passed through by code. */
  | "gateway_error"
  /** R15: the fresh quote doesn't bind to what was reviewed. */
  | "r15_refused"
  /** R15: the fresh quote's minimum received is lower than the reviewed one; the new quote goes back for review. */
  | "quote_needs_review"
  /** R16: the approve isn't the exact amount to an allowlisted spender. */
  | "r16_refused"
  /** R17: Hako signs only on executable source chains. */
  | "chain_not_executable"
  | "quote_expired"
  | "invalid_input"
  | "invoice_already_paid"
  | "nothing_to_pay";

export class HakoError extends Error {
  readonly code: HakoErrorCode;
  /** The gateway's own error code, when the gateway answered with one. */
  readonly upstreamCode: string | null;

  constructor(code: HakoErrorCode, message: string, upstreamCode: string | null = null) {
    super(message);
    this.name = "HakoError";
    this.code = code;
    this.upstreamCode = upstreamCode;
  }
}

const NOTHING_MOVED = "Nothing was signed, paid or moved.";

/** The MCP result of a failed tool call: `isError`, the code first, and no structured content. */
export function errorResult(error: unknown) {
  const known = error instanceof HakoError ? error : null;
  const code = known ? (known.upstreamCode ? `${known.code}:${known.upstreamCode}` : known.code) : "internal_error";
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: "text" as const, text: `Hako error [${code}]: ${message} ${NOTHING_MOVED}` }] };
}

/** Runs a tool handler and turns any failure into a typed error result instead of a bare exception. */
export function guarded<A extends unknown[], R>(handler: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | ReturnType<typeof errorResult>> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResult(error);
    }
  };
}
