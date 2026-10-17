import "server-only";

/**
 * Server-only settings: the web schema of @hako/env (the only process.env reader), validated on first use rather than
 * at import, so `next build` in CI does not need runtime secrets. Everything optional has a feature that degrades
 * without it.
 */
export { loadWebEnv as serverEnv, type WebEnv as ServerEnv } from "@hako/env";
