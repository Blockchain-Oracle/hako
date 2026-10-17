/**
 * The gateway's own numbers for batches, invoices, receipts, the logo proxy and the file forward (plan B12, B13).
 * Shared limits (BATCH_TTL_S, BATCH_MAX_CALLS, INVOICE_NOTE_MAX_CHARS, LOGO_CACHE_TTL_S, FILE_TTL_S) stay in
 * @hako/config; these are feature-local (plan §5b).
 */

import { PAYMENT_TIMEOUT_S } from "../../constants.js";

/**
 * Status codes these routes answer that neither the gateway's shared constants nor @hako/cards/contract
 * (HTTP_UNAUTHORIZED, HTTP_PAYMENT_REQUIRED) name.
 */
export const HTTP_CONFLICT = 409;
export const HTTP_TOO_MANY_REQUESTS = 429;
/** 3xx: a redirect (the logo proxy follows one only to another allowlisted host). */
export const HTTP_FIRST_REDIRECT = 300;

/** Every key these routes keep in Redis starts here, so they never collide with @hako/paybox's keys. */
export const KV_PREFIX = "hako:gw";

/**
 * An invoice's Redis claim (`SET NX`) covers one settlement: the signed authorization is valid PAYMENT_TIMEOUT_S and
 * the facilitator may retry once. The database row (open → settling → paid) is the lasting record.
 */
export const INVOICE_CLAIM_TTL_S = PAYMENT_TIMEOUT_S * 2;

/** Invoice amounts in USDC atomic units (6 decimals): from one cent to one thousand dollars. */
export const INVOICE_MIN_ATOMIC = 10_000n;
export const INVOICE_MAX_ATOMIC = 1_000_000_000n;
/** `POST /v1/invoices` per client IP: this many creations per window. */
export const INVOICE_CREATES_PER_WINDOW = 20;
export const INVOICE_RATE_WINDOW_S = 60;

/** A batch id is this many random bytes, base64url (unguessable: the id is all a payer needs). */
export const BATCH_ID_BYTES = 16;

/** Dynamic price and payee lookups are immutable per id: this many are memoised per process. */
export const TERMS_CACHE_MAX_ENTRIES = 1_000;
/** The in-memory store (development without REDIS_URL) holds at most this many keys. */
export const MEMORY_STORE_MAX_KEYS = 10_000;

/** The allowlisted logo proxy (`GET /v1/logo?src=`): https only, these hosts only, images only, this big at most. */
export const LOGO_MAX_BYTES = 512 * 1_024;
/**
 * Only logos this small are kept in Redis (which also holds the batch and invoice claims): a bigger one is served with
 * its immutable Cache-Control and left to browsers.
 */
export const LOGO_CACHE_MAX_BYTES = 64 * 1_024;
/** Upstream logo fetches (cache misses) per client IP per window; cached logos don't count. */
export const LOGO_FETCHES_PER_WINDOW = 120;
export const LOGO_RATE_WINDOW_S = 60;
export const LOGO_FETCH_TIMEOUT_MS = 4_000;
/** IPFS gateways redirect to subdomain gateways: a few hops, each one allowlisted. */
export const LOGO_MAX_REDIRECTS = 3;
/**
 * Where token, chain and bridge logos live (LI.FI `logoURI` hosts measured 2026-10-17 over Base, Ethereum, Arbitrum,
 * Optimism, Polygon and Solana tokens, tools and chains; plus provider marks). Anything else is refused.
 */
export const LOGO_HOSTS = [
  "static.debank.com",
  "raw.githubusercontent.com",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
  "s2.coinmarketcap.com",
  "assets.geckoterminal.com",
  "xstocks-metadata.backed.fi",
  "cdn.ondo.finance",
  "ipfs.io",
  "cf-ipfs.com",
  "gateway.pinata.cloud",
  "arweave.net",
  "www.arweave.net",
  "gateway.irys.xyz",
  "node1.irys.xyz",
  "img-cdn.magiceden.dev",
  "image-cdn.solana.fm",
  "statics.solscan.io",
  "static-create.jup.ag",
  "storage.googleapis.com",
  "tokenlist.superfluid.org",
  "superfluid-finance.github.io",
  "ethereum-optimism.github.io",
  "lifinance.github.io",
  "cdn.dexscreener.com",
  "imagedelivery.net",
  "backpack.exchange",
] as const;
/** Image types the proxy passes on; SVG gets a sandboxing CSP so it can never run script on the gateway's origin. */
export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"] as const;
export const LOGO_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** `GET /v1/files/<id>`: ids are opaque tokens from hako-api; anything else could add path segments upstream. */
export const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const FILE_FORWARD_TIMEOUT_MS = 8_000;
