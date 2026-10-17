/**
 * Pay-me invoices (plan §1 A11, B12): create and check are free; paying is an x402 proposal to `GET /v2/invoice/<id>`,
 * which settles straight to the payee's wallet, so Hako never holds the money. Base USDC.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { X402_RAIL } from "../constants.js";
import { guarded, HakoError } from "../errors.js";
import { callGateway, paidInvoiceUrl } from "../gateway.js";
import { proposeX402, x402OutputSchema } from "../paybox.js";
import { amountText } from "../proposals.js";
import { sameAddress, toAtomic, ZERO_UNITS } from "../shared.js";
import { idParamsSchema, type InvoiceData, invoiceCreateRequestSchema, invoiceDataSchema } from "../wire/money.js";
import { decimalAmountSchema } from "../wire/primitives.js";
import { CREATES, PROPOSES, READ_ONLY } from "./annotations.js";

const invoiceId = idParamsSchema.shape.id.describe("The invoice id (from hako_invoice_create or the pay link usehako.xyz/pay/<id>).");

const amountOf = (invoice: InvoiceData) => amountText(invoice.amount.amountAtomic, invoice.amount.token.decimals, invoice.amount.token.symbol);
const noteOf = (invoice: InvoiceData) => (invoice.note ? ` for "${invoice.note}"` : "");

function invoiceText(invoice: InvoiceData): string {
  if (invoice.status === "paid") {
    const tx = invoice.tx ? ` Settlement ${invoice.tx.hash}${invoice.tx.explorerUrl ? ` (${invoice.tx.explorerUrl})` : ""}.` : "";
    return `Invoice ${invoice.id} is paid: ${amountOf(invoice)}${noteOf(invoice)} to ${invoice.payTo}${invoice.payer ? ` by ${invoice.payer}` : ""}${invoice.paidAt ? ` at ${invoice.paidAt}` : ""}.${tx}`;
  }
  return (
    `Invoice ${invoice.id} is open: ${amountOf(invoice)} on Base${noteOf(invoice)}, paid straight to ${invoice.payTo}. ` +
    `Pay link ${invoice.payUrl} (the QR encodes it). Any PayBox agent can pay ${invoice.agentPayUrl} with use_service, or call hako_invoice_pay.`
  );
}

export function registerInvoiceTools(server: McpServer) {
  server.registerTool(
    "hako_invoice_create",
    {
      title: "Create a pay-me invoice",
      description:
        "Free. Creates an open USDC invoice on Base with a short pay link and QR, paid straight to payTo (the " +
        "person's PayBox wallet address from list_credentials). Anyone pays it with PayBox: use_service on its agent " +
        "link, the pay page, or hako_invoice_pay.",
      inputSchema: z
        .object({
          amount: decimalAmountSchema.describe('USDC amount as typed, e.g. "25" or "0.25".'),
          note: invoiceCreateRequestSchema.shape.note.describe("What it's for, plain text, shown to the payer."),
          payTo: invoiceCreateRequestSchema.shape.payTo.describe("The payee's wallet address on Base (from list_credentials)."),
        })
        .strict(),
      outputSchema: invoiceDataSchema,
      annotations: CREATES,
    },
    guarded(async ({ amount, note, payTo }) => {
      let amountAtomic: bigint;
      try {
        amountAtomic = toAtomic(amount, X402_RAIL.decimals);
      } catch (error) {
        throw new HakoError("invalid_input", error instanceof Error ? error.message : "The amount could not be read.");
      }
      if (amountAtomic <= ZERO_UNITS) throw new HakoError("invalid_input", "An invoice needs an amount above zero.");
      const invoice = await callGateway("invoiceCreate", { body: { amountAtomic: amountAtomic.toString(), note, payTo } });
      return { content: [{ type: "text" as const, text: invoiceText(invoice) }], structuredContent: invoice };
    }),
  );

  server.registerTool(
    "hako_invoice_status",
    {
      title: "Invoice status",
      description: "Free. Whether an invoice is open or paid, with the settlement transaction and the payer when paid.",
      inputSchema: z.object({ id: invoiceId }).strict(),
      outputSchema: invoiceDataSchema,
      annotations: READ_ONLY,
    },
    guarded(async ({ id }) => {
      const invoice = await callGateway("invoiceGet", { params: { id } });
      return { content: [{ type: "text" as const, text: invoiceText(invoice) }], structuredContent: invoice };
    }),
  );

  server.registerTool(
    "hako_invoice_pay",
    {
      title: "Pay an invoice with PayBox",
      description:
        "Pays an open Hako invoice: returns a USDC payment on Base for its exact amount, settled straight to the " +
        "payee. Check the payee address and note in the text with the person before approving. Follow the request id " +
        "with get_request; never re-run to finish it.",
      inputSchema: z.object({ id: invoiceId }).strict(),
      outputSchema: x402OutputSchema,
      annotations: PROPOSES,
    },
    guarded(async ({ id }) => {
      const invoice = await callGateway("invoiceGet", { params: { id } });
      if (invoice.status === "paid") throw new HakoError("invoice_already_paid", invoiceText(invoice));
      const token = invoice.amount.token;
      if (token.chain !== X402_RAIL.chain || !sameAddress(token.address, X402_RAIL.asset)) {
        throw new HakoError("gateway_contract_mismatch", `Invoice ${invoice.id} is not in USDC on Base.`);
      }
      if (!/^[1-9][0-9]*$/.test(invoice.amount.amountAtomic)) throw new HakoError("nothing_to_pay", `Invoice ${invoice.id} asks for nothing.`);
      const proposal = proposeX402({ chain: X402_RAIL.chain, url: paidInvoiceUrl(invoice.id), method: "GET", maxAmount: invoice.amount.amountAtomic });
      const text =
        `Pay invoice ${invoice.id}: ${amountOf(invoice)} on Base straight to ${invoice.payTo}${noteOf(invoice)}.` +
        `${invoice.createdBy === "agent" ? " Created by an agent · check this address." : ""} Approve in PayBox.`;
      return { ...proposal, content: [{ type: "text" as const, text }] };
    }),
  );
}
