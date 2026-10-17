import { MS_PER_SECOND } from "./units.js";

/**
 * PayBox request status (approval, signature, settlement, confirmation): poll `get_request` from 1 s, backing off to
 * 5 s, and stop at a terminal status (plan D22). Each wait is the previous one times the factor, capped at the max.
 */
export const REQUEST_POLL_INITIAL_MS = MS_PER_SECOND;
export const REQUEST_POLL_MAX_MS = 5 * MS_PER_SECOND;
export const REQUEST_POLL_BACKOFF_FACTOR = 2;

/** A card following a live intent re-reads it this often, version-guarded, and never re-sends anything (plan D22). */
export const INTENT_POLL_MS = 2 * MS_PER_SECOND;
