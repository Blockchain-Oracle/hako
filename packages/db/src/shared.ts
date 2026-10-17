import { randomBytes, randomUUID } from "node:crypto";

import { BYTE_VALUES, DB_LIST_DEFAULT_LIMIT, DB_LIST_MAX_LIMIT, INVOICE_ID_LENGTH } from "./db.config.ts";

/** Where an action started: the CHECK constraints in 0002_hako_core.sql list the same values. */
export const SURFACES = ["web", "voice", "mcp", "cli", "plugin", "gateway"] as const;
export type Surface = (typeof SURFACES)[number];

/** Atomic amounts travel as base-10 integer strings (pg returns numeric as an exact string). */
export type AtomicString = string;

/** A new row id. */
export const newId = (): string => randomUUID();

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Bytes at or above the largest multiple of 62 (248) are rejected, so every base62 digit is equally likely. */
const BASE62_UNBIASED_LIMIT = Math.floor(BYTE_VALUES / BASE62.length) * BASE62.length;

/** A short, unguessable invoice id (the `/pay/<id>` path and its QR). */
export function newInvoiceId(): string {
  let id = "";
  while (id.length < INVOICE_ID_LENGTH) {
    for (const byte of randomBytes(INVOICE_ID_LENGTH * 2)) {
      if (byte < BASE62_UNBIASED_LIMIT && id.length < INVOICE_ID_LENGTH) id += BASE62[byte % BASE62.length];
    }
  }
  return id;
}

/** A keyset page: newest first, continuing strictly before `before` (a row's `createdAt`). */
export interface PageOptions {
  limit?: number;
  before?: Date;
}

/** Postgres SQLSTATE 23505: a unique index refused the row. */
const UNIQUE_VIOLATION = "23505";
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** The limit a list helper uses: the default when unset, clamped to [1, DB_LIST_MAX_LIMIT]. */
export function pageLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DB_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), DB_LIST_MAX_LIMIT);
}
