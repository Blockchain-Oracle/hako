/**
 * One receipt row for every settled x402 payment (plan add-ons, Activity ledger): paid runs, batches and invoice
 * payments, including plugin payments from hosts Hako has no session for. The hook runs after the facilitator settled
 * and before the paid answer is sent, so it only starts the ledger write and returns: a slow or unreachable Postgres
 * never delays the answer the payer already paid for, and a failure is logged. The insert is idempotent on
 * (kind, chain, tx hash).
 */

import type { AfterSettleHook, HTTPTransportContext, SettleResultContext } from "@x402/core/server";

import { GATEWAY_ENDPOINTS } from "@hako/cards/contract";
import { recordReceipt, type Pool } from "@hako/db/node";

import { RUN_V2_PREFIX } from "../../constants.js";
import { matchPath } from "./http.js";

/** What a payment bought, read back from the paid route's path. */
export interface PaidFor {
  toolId: string | null;
  batchId: string | null;
  invoiceId: string | null;
}

/** The request path of a settle hook's context (the Hono payment middleware passes it as `transportContext.request`). */
export function settledPath(context: Pick<SettleResultContext, "transportContext">): string | null {
  const transport = context.transportContext as Partial<HTTPTransportContext> | undefined;
  return transport?.request?.path ?? null;
}

export function paidFor(path: string): PaidFor | null {
  if (path.startsWith(`${RUN_V2_PREFIX}/`)) {
    const toolId = path.slice(RUN_V2_PREFIX.length + 1);
    return toolId ? { toolId, batchId: null, invoiceId: null } : null;
  }
  const batch = matchPath(GATEWAY_ENDPOINTS.batchPay.path, path);
  if (batch?.batchId) return { toolId: null, batchId: batch.batchId, invoiceId: null };
  const invoice = matchPath(GATEWAY_ENDPOINTS.invoicePay.path, path);
  if (invoice?.id) return { toolId: null, batchId: null, invoiceId: invoice.id };
  return null;
}

/** The after-settle hook every paid route's resource server carries. Without a database it only logs. */
export function recordSettlement(pool: Pool | null): AfterSettleHook {
  return async (context) => {
    const path = settledPath(context);
    const bought = path ? paidFor(path) : null;
    const { result, requirements } = context;
    const event = { path, tx: result.transaction, network: result.network, payer: result.payer ?? null };
    if (!pool || !bought || !result.transaction) {
      console.warn(JSON.stringify({ event: "receipt_not_recorded", reason: !pool ? "no_database" : "unknown_payment", ...event }));
      return;
    }
    // Not awaited: the money already moved, and the payer's answer must not wait on the ledger.
    void recordReceipt(pool, {
      kind: "x402_settlement",
      status: "confirmed",
      // Who paid is known by address only: plugin runs and core use_service carry no Hako session.
      surface: "gateway",
      chain: result.network,
      asset: requirements.asset,
      amountAtomic: result.amount ?? requirements.amount,
      payer: result.payer ?? null,
      payTo: requirements.payTo,
      txHash: result.transaction,
      ...bought,
    })
      .then(({ receipt, created }) => console.log(JSON.stringify({ event: "receipt_recorded", id: receipt.id, created, ...event })))
      .catch((error: unknown) => console.error(JSON.stringify({ event: "receipt_record_failed", error: String(error), ...event })));
  };
}
