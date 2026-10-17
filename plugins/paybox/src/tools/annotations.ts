/** MCP tool annotations, one set per kind of tool. */

/** Free reads: nothing changes anywhere. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
/**
 * Paid runs, invoice payments and money moves: the tool only returns an unsigned proposal; PayBox pays or signs it
 * after the person approves, so the call itself changes nothing and repeating it makes a new proposal.
 */
export const PROPOSES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
/** Creates a record on Hako's side (an invoice) without moving money. */
export const CREATES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
