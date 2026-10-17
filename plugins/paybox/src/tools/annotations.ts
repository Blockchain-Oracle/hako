/** MCP tool annotations, one set per kind of tool. */

/** Free reads: nothing changes anywhere. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
/** Paid runs and invoice payments: an x402 proposal PayBox pays only after the person approves. */
export const PAYS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
/** Money moves: an unsigned transaction proposal that spends from the person's wallet once approved and signed. */
export const MOVES_MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;
/** Creates a record on Hako's side (an invoice) without moving money. */
export const CREATES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
