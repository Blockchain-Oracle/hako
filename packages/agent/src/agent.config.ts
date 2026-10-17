/** Numbers the tool registry uses (plan §5b: feature-local numbers live in a `*.config.ts`). */

/** The gateway's verdicts on a tool input (`/v1/validate`): bad JSON, fields that don't fit. */
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNPROCESSABLE = 422;

/** A paid re-fetch PayBox stored (`use_service` output): 2xx is an answer; the gateway settles x402 only then. */
export const HTTP_OK_MIN = 200;
export const HTTP_OK_END = 300;

/** The technical line behind a failure card's disclosure: the start of what the paid route answered. */
export const FAILURE_TECHNICAL_MAX_CHARS = 300;

/**
 * A PayBox denial that came from the person's grant limit ("Your agent stopped at your limit · Raise it", plan add-ons
 * "Agent passport"). PayBox gives a denial as words only, so the reason text is matched.
 */
export const LIMIT_DENIAL_PATTERN = /\b(limit|budget|exceed(s|ed)?|cap)\b/i;

/** Pending activity rows re-read from PayBox per page (`get_request`), so the ledger's live rows stay current. */
export const ACTIVITY_LIVE_REFRESH_MAX = 10;

/**
 * Gas top-up offered by the passport (plan add-ons "Agent passport", runbook step (0)): a small USDC → native swap
 * through PayBox `request_swap`, offered only when `check_operation_readiness` says it can run without native gas.
 */
export const GAS_TOP_UP_USDC = "0.10";
export const GAS_TOP_UP_SLIPPAGE_BPS = 100;
export const GAS_TOP_UP_VALUE_CENTS = 10;

/** `request_account_change` shows the note verbatim to the person: one short sentence. */
export const ACCOUNT_CHANGE_NOTE_MAX_CHARS = 200;
