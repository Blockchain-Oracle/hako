import { BYTES_PER_MIB } from "./units.ts";

/** `hako_run_batch`: up to five tools, one payment, one approval (plan A4). */
export const BATCH_MAX_CALLS = 5;
/** An invoice note is plain text of at most this many characters (plan B13, `POST /v1/invoices`). */
export const INVOICE_NOTE_MAX_CHARS = 140;

/** PayBox plugin limits (plan §1 "How the plugin ships", §2 plugin limits). */
export const PLUGIN_BUNDLE_MAX_BYTES = 10 * BYTES_PER_MIB;
export const PLUGIN_MAX_NETWORK_HOSTS = 16;
/** A Solana proposal is at most one legacy packet (1,232 bytes) with exactly one signer, the sender (R15). */
export const SOLANA_TX_MAX_BYTES = 1_232;
export const SOLANA_TX_REQUIRED_SIGNERS = 1;
