/**
 * Receipts (plan B13, add-ons Activity ledger and shared receipts): `GET /v1/receipts` is the caller's own rows (a Hako
 * session, the Better Auth JWT as a bearer) with the Activity filters; `GET /v1/receipts/shared` is every receipt its
 * owner shared as `/r/<id>` (the landing's proof, anonymous); `GET /v1/receipts/<id>` is one receipt, to its owner or
 * to anyone once shared. Every x402 settlement is recorded by the payment layer (src/routes/x402/settlement.ts).
 */

import type { Context, Hono } from "hono";
import { z } from "zod";

import { GATEWAY_ENDPOINTS, receiptCreateRequestSchema, receiptsQuerySchema, sharedReceiptsQuerySchema } from "@hako/cards/contract";
import { getListedReceipt, listReceipts, type ListedReceipt, type PageCursor, type ReceiptScope } from "@hako/db/node";

import { HTTP_BAD_GATEWAY, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_UNAVAILABLE, HTTP_UNPROCESSABLE, RUN_PREFIX } from "../constants.js";
import { jsonError } from "../errors.js";
import { receiptCard } from "./x402/cards.js";
import type { X402Context } from "./x402/context.js";
import { refuse } from "./x402/http.js";
import { recordOnchainReceipt } from "./x402/onchain-receipt.js";
import { HTTP_CONFLICT, HTTP_UNAUTHORIZED } from "./x402/x402.config.js";

const { receipts, receiptsShared, receiptGet, receiptCreate } = GATEWAY_ENDPOINTS;

/** Where the next page starts: the last row read (`{createdAt, id}`), opaque to the caller (base64url JSON). */
const cursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.string().min(1) });

const encodeCursor = (row: ListedReceipt): string =>
  Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");

function decodeCursor(text: string): PageCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
    return parsed.success ? { createdAt: new Date(parsed.data.createdAt), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}

const queryDetails = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`);

export function registerReceipts(app: Hono, ctx: X402Context): void {
  const { pool } = ctx;
  const unavailable = (c: Context) => jsonError(c, HTTP_UNAVAILABLE, "receipts_unavailable", "Receipts are not available on this gateway right now.");
  const toolName = (id: string) => ctx.endpoints()?.get(`${RUN_PREFIX}/${id}`)?.displayName ?? null;

  async function page(c: Context, scope: ReceiptScope, query: z.output<typeof receiptsQuerySchema>) {
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (before === null) return refuse(c, HTTP_UNPROCESSABLE, "invalid_cursor", "That cursor is not one this route returned: leave it out for the newest receipts.");
    const { kind, status, chain, surface, draftId, limit } = query;
    const rows = await listReceipts(pool!, scope, {
      activityKind: kind,
      status: status === "reverted" ? "failed" : status,
      chain,
      surface,
      draftId,
    }, { limit, before });
    const last = rows.at(-1);
    return c.json({ receipts: rows.map((row) => receiptCard(row, toolName)), nextCursor: rows.length >= limit && last ? encodeCursor(last) : null });
  }

  // Registered before `/v1/receipts/:id`, so `shared` is never read as a receipt id.
  app.get(receiptsShared.path, async (c) => {
    if (!pool) return unavailable(c);
    const query = sharedReceiptsQuerySchema.safeParse(c.req.query());
    if (!query.success) return refuse(c, HTTP_UNPROCESSABLE, "invalid_query", "Unknown or malformed filters.", queryDetails(query.error));
    return page(c, "public", query.data);
  });

  const signedOut = (c: Context, status: "none" | "invalid") =>
    refuse(c, HTTP_UNAUTHORIZED, status === "none" ? "auth_required" : "invalid_session",
      "Your receipts need a signed-in Hako session (a bearer); shared receipts are at /v1/receipts/shared.");

  app.get(receipts.path, async (c) => {
    if (!pool) return unavailable(c);
    const session = await ctx.sessions(c.req.header("authorization"));
    if (session.status !== "valid") return signedOut(c, session.status);
    const query = receiptsQuerySchema.safeParse(c.req.query());
    if (!query.success) return refuse(c, HTTP_UNPROCESSABLE, "invalid_query", "Unknown or malformed filters.", queryDetails(query.error));
    return page(c, { userId: session.userId }, query.data);
  });

  app.post(receiptCreate.path, async (c) => {
    if (!pool) return unavailable(c);
    const session = await ctx.sessions(c.req.header("authorization"));
    if (session.status !== "valid") return signedOut(c, session.status);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.");
    }
    const parsed = receiptCreateRequestSchema.safeParse(body);
    if (!parsed.success) return refuse(c, HTTP_UNPROCESSABLE, "invalid_receipt", "A receipt is {chain, txHash, draft?}.", queryDetails(parsed.error));
    const outcome = await recordOnchainReceipt(ctx, session.userId, parsed.data);
    if (outcome.ok) return c.json(receiptCard(outcome.receipt, toolName));
    switch (outcome.reason) {
      case "chain_unavailable":
        return jsonError(c, HTTP_BAD_GATEWAY, outcome.reason, outcome.message);
      case "recorded_by_another_account":
        return refuse(c, HTTP_CONFLICT, outcome.reason, outcome.message);
      case "unsupported_chain":
        return refuse(c, HTTP_UNPROCESSABLE, outcome.reason, outcome.message);
      default:
        return jsonError(c, HTTP_NOT_FOUND, outcome.reason, outcome.message);
    }
  });

  app.get(receiptGet.path, async (c) => {
    if (!pool) return unavailable(c);
    const id = c.req.param("id");
    const row = await getListedReceipt(pool, id);
    const session = row && !row.isPublic ? await ctx.sessions(c.req.header("authorization")) : null;
    const visible = row && (row.isPublic || (session?.status === "valid" && row.userId === session.userId));
    // A receipt that isn't shared looks the same as one that doesn't exist.
    return visible ? c.json(receiptCard(row, toolName)) : jsonError(c, HTTP_NOT_FOUND, "unknown_receipt", `no receipt ${id}`);
  });
}
