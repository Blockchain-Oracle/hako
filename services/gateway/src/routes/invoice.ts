/**
 * Pay-me invoices (plan B12, B13, add-ons): `POST /v1/invoices` (free, rate-limited per IP) creates an open Base USDC
 * invoice paid straight to its payee; `GET /v1/invoices/<id>` reads it; `GET /v2/invoice/<id>` is the x402 resource
 * any PayBox agent pays with core `use_service`: `DynamicPayTo` = the payee, `DynamicPrice` = the exact amount, so the
 * money never passes through Hako. `onBeforeSettle` claims the invoice (`SET NX` in Redis, then open → settling in
 * Postgres) and aborts every other settlement; `onAfterSettle` marks it paid with the tx hash. Unknown → 404; once
 * claimed or paid it answers 200 with the invoice to every request and never issues another 402.
 */

import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { Context, Hono } from "hono";

import { endpointUrl } from "@hako/cards/client";
import { GATEWAY_ENDPOINTS, invoiceCreateRequestSchema } from "@hako/cards/contract";
import { claimInvoice, createInvoice, getInvoice, type InvoiceRow, markInvoicePaid, releaseInvoice } from "@hako/db/node";
import { formatPrice, fromAtomic } from "@hako/money";
import { networkByCaip2 } from "@hako/networks";

import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_UNAVAILABLE, HTTP_UNPROCESSABLE } from "../constants.js";
import { jsonError } from "../errors.js";
import { invoiceCard } from "./x402/cards.js";
import type { X402Context } from "./x402/context.js";
import { clientIp, refuse } from "./x402/http.js";
import { paidLayer, type PaidResource } from "./x402/paid.js";
import {
  HTTP_CONFLICT,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  INVOICE_CLAIM_TTL_S,
  INVOICE_CREATES_PER_WINDOW,
  INVOICE_MAX_ATOMIC,
  INVOICE_MIN_ATOMIC,
  INVOICE_RATE_WINDOW_S,
  KV_PREFIX,
  TERMS_CACHE_MAX_ENTRIES,
} from "./x402/x402.config.js";

const { invoiceCreate, invoiceGet, invoicePay } = GATEWAY_ENDPOINTS;

/** Plain text only: no control or format characters (they could hide or reorder what the payer reads). */
const NOT_PLAIN_TEXT = /[\p{Cc}\p{Cf}]/u;

/** Who signed the payment (EIP-3009 `authorization.from`), read from the verified header; null when it isn't there. */
function payerOf(c: Context): string | null {
  const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!header) return null;
  try {
    const { payload } = decodePaymentSignatureHeader(header) as { payload?: { authorization?: { from?: unknown } } };
    return typeof payload?.authorization?.from === "string" ? payload.authorization.from : null;
  } catch {
    return null;
  }
}

export function registerInvoices(app: Hono, ctx: X402Context): void {
  const { pool, kv, rail } = ctx;
  const usdc = rail ? networkByCaip2(rail.network)?.usdc : undefined;
  const card = (row: InvoiceRow) => invoiceCard(row, endpointUrl(ctx.publicBaseUrl, "invoicePay", { params: { id: row.id } }));
  const claimKey = (id: string) => `${KV_PREFIX}:invoice:${id}:settling`;
  const unavailable = (c: Context) =>
    jsonError(c, HTTP_UNAVAILABLE, "invoices_unavailable", "Invoices are not available on this gateway right now; nothing was created or charged.");
  const unknown = (c: Context, id: string) => jsonError(c, HTTP_NOT_FOUND, "unknown_invoice", `no invoice ${id}`);

  // An invoice's payee and amount never change: the dynamic price and payee read them once per id.
  const terms = new Map<string, Pick<InvoiceRow, "payTo" | "amountAtomic">>();
  async function termsOf(id: string) {
    const known = terms.get(id);
    if (known) return known;
    const row = pool ? await getInvoice(pool, id) : null;
    if (!row) throw new Error(`invoice ${id} is unknown`);
    if (terms.size >= TERMS_CACHE_MAX_ENTRIES) terms.delete(terms.keys().next().value!);
    terms.set(id, { payTo: row.payTo, amountAtomic: row.amountAtomic });
    return terms.get(id)!;
  }

  app.post(invoiceCreate.path, async (c) => {
    if (!rail) return jsonError(c, HTTP_NOT_FOUND, "mainnet_disabled", "Paid routes are not enabled on this gateway.");
    if (!pool || !kv || !usdc) return unavailable(c);
    if ((await kv.hit(`${KV_PREFIX}:invoice-rate:${clientIp(c)}`, INVOICE_RATE_WINDOW_S)) > INVOICE_CREATES_PER_WINDOW) {
      return refuse(c, HTTP_TOO_MANY_REQUESTS, "rate_limited", `At most ${INVOICE_CREATES_PER_WINDOW} invoices a minute from one address; try again shortly.`);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.");
    }
    const parsed = invoiceCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
      return refuse(c, HTTP_UNPROCESSABLE, "invalid_invoice", "An invoice is {amountAtomic, payTo, note?} in USDC atomic units.", details);
    }
    const { amountAtomic, payTo } = parsed.data;
    const amount = BigInt(amountAtomic);
    if (amount < INVOICE_MIN_ATOMIC || amount > INVOICE_MAX_ATOMIC) {
      const range = [INVOICE_MIN_ATOMIC, INVOICE_MAX_ATOMIC].map((value) => formatPrice(value, usdc.decimals, usdc.symbol));
      return refuse(c, HTTP_UNPROCESSABLE, "amount_out_of_range", `An invoice is between ${range[0]} and ${range[1]}.`);
    }
    const note = parsed.data.note?.trim() || null;
    if (note && NOT_PLAIN_TEXT.test(note)) {
      return refuse(c, HTTP_UNPROCESSABLE, "invalid_note", "The note must be plain text (no control or formatting characters).");
    }
    const session = await ctx.sessions(c.req.header("authorization"));
    if (session.status === "invalid") return refuse(c, HTTP_UNAUTHORIZED, "invalid_session", "That Hako session is not valid; sign in again, or send no bearer.");
    const row = await createInvoice(pool, {
      payTo,
      chain: rail.network,
      asset: usdc.address,
      amountAtomic,
      note,
      createdBy: session.status === "valid" ? session.userId : null,
      createdVia: "gateway",
    });
    console.log(JSON.stringify({ event: "invoice_created", id: row.id, payTo, amountAtomic, signedIn: session.status === "valid" }));
    return c.json(card(row));
  });

  app.get(invoiceGet.path, async (c) => {
    if (!pool) return unavailable(c);
    const row = await getInvoice(pool, c.req.param("id"));
    return row ? c.json(card(row)) : unknown(c, c.req.param("id"));
  });

  const resource: PaidResource = {
    path: invoicePay.path,
    description: "A Hako invoice, paid straight to its payee",
    price: async ({ id = "" }) => `$${fromAtomic(BigInt((await termsOf(id)).amountAtomic), usdc?.decimals ?? 0)}`,
    payTo: async ({ id = "" }) => (await termsOf(id)).payTo,
    async unpaidBody({ id = "" }) {
      const row = pool ? await getInvoice(pool, id) : null;
      return row ? card(row) : {};
    },
    async claim({ id = "" }) {
      if (!(await kv!.setIfAbsent(claimKey(id), new Date().toISOString(), INVOICE_CLAIM_TTL_S))) return "invoice_already_claimed";
      if (await claimInvoice(pool!, id)) return null;
      await kv!.del(claimKey(id));
      return "invoice_not_open";
    },
    async settled({ id = "" }, result) {
      const row = await markInvoicePaid(pool!, id, { txHash: result.transaction, payer: result.payer ?? null });
      console.log(JSON.stringify({ event: "invoice_paid", id, tx: result.transaction, payer: result.payer ?? null, marked: Boolean(row) }));
    },
    async release({ id = "" }) {
      await releaseInvoice(pool!, id);
      await kv!.del(claimKey(id));
    },
  };

  app.get(
    invoicePay.path,
    // Before any 402: unknown → 404; claimed or paid → 200 with the invoice (never a second 402).
    async (c, next) => {
      if (!pool || !kv) return unavailable(c);
      const id = c.req.param("id");
      const row = await getInvoice(pool, id);
      if (!row) return unknown(c, id);
      if (row.status !== "open" || (await kv.get(claimKey(id)))) return c.json(card(row));
      await next();
    },
    paidLayer(ctx, resource),
    async (c) => {
      const id = c.req.param("id");
      const row = await getInvoice(pool!, id);
      if (!row) return unknown(c, id);
      // Paid by someone else between the check and now: answer without settling this payment.
      if (row.status !== "open") return refuse(c, HTTP_CONFLICT, "invoice_already_paid", "This invoice was just paid; your payment was not taken.");
      // Delivered only if the settlement lands: the invoice as it then stands (the tx hash is in PAYMENT-RESPONSE).
      return c.json({ ...card(row), status: "paid", payer: payerOf(c), paidAt: new Date().toISOString() });
    },
  );
}
