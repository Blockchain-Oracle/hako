import { MS_PER_SECOND } from "./units.js";

/**
 * Kawase's state rules (plan §2 States, §1 card flow): how long the interface waits before it says something.
 */

/** An edit in a money card settles this long before it makes a new draft version (re-quote + re-rehearse). */
export const DRAFT_SETTLE_MS = 400;
/** A skeleton shaped like the real layout stays at least this long, so a fast answer never flickers. */
export const SKELETON_MIN_MS = 300;
/** A wait shows its elapsed seconds after this long. */
export const WAIT_SHOW_ELAPSED_AFTER_MS = 3 * MS_PER_SECOND;
/** A wait turns into "Still waiting · Retry" after this long. */
export const WAIT_STILL_WAITING_AFTER_MS = 15 * MS_PER_SECOND;
