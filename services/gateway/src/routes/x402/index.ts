/**
 * The gateway's x402 extensions and receipts (plan B12, B13):
 *   free   POST /v1/batch · POST /v1/invoices · GET /v1/invoices/:id · GET /v1/receipts (Hako session)
 *          GET /v1/receipts/shared · GET /v1/receipts/:id · GET /v1/logo?src= · GET /v1/files/:id
 *   paid   GET /v2/batch/:batchId (the stored batch's frozen sum) · GET /v2/invoice/:id (the invoice, to its payee)
 * Every settled x402 payment, `/v2/run` included, is recorded as a receipt (settlement.ts, wired in src/payments.ts).
 */

import type { Hono } from "hono";

import { registerBatch } from "../batch.js";
import { registerFiles } from "../files.js";
import { registerInvoices } from "../invoice.js";
import { registerLogo } from "../logo.js";
import { registerReceipts } from "../receipts.js";
import { productionContext, type X402Context } from "./context.js";

export function registerX402Routes(app: Hono, ctx: X402Context = productionContext()): void {
  registerBatch(app, ctx);
  registerInvoices(app, ctx);
  registerReceipts(app, ctx);
  registerLogo(app, ctx);
  registerFiles(app, ctx);
}
