/**
 * `@hako/db` rows as the wire contract draws them (`@hako/cards/contract`): an invoice row → `InvoiceData`, a receipt
 * row → `ReceiptData`. Amounts are exact; a token the registry doesn't know is left out rather than guessed.
 */

import { activitySurfaceSchema, type InvoiceData, type ReceiptData, type ReceiptKind as CardReceiptKind, type TokenAmount, type TxLink } from "@hako/cards/contract";
import { HAKO_APP_PATHS, HAKO_APP_URL } from "@hako/config";
import type { InvoiceRow, ListedReceipt } from "@hako/db/node";
import { formatTokenAmount, fromAtomic, sameAddress, shortenAddress } from "@hako/money";
import { type Caip2, explorerTxUrl, networkByCaip2, type TokenInfo } from "@hako/networks";

type Role = TxLink["role"];

/** A token on a chain Hako knows, by address: the chain's native coin or its USDC. */
function tokenOf(chain: string, address: string): (TokenInfo & { chain: Caip2; usd: boolean }) | null {
  const network = networkByCaip2(chain);
  if (!network) return null;
  if (sameAddress(network.usdc.address, address)) return { ...network.usdc, chain: network.caip2, usd: true };
  if (sameAddress(network.native.address, address)) return { ...network.native, chain: network.caip2, usd: false };
  return null;
}

/** An exact amount of a known token; USDC carries its dollar value, anything else none (never a made-up $0). */
export function tokenAmount(chain: string, address: string, atomic: string): TokenAmount | null {
  const token = tokenOf(chain, address);
  if (!token) return null;
  return {
    token: { chain: token.chain, address: token.address, symbol: token.symbol, decimals: token.decimals, name: token.name },
    amountAtomic: atomic,
    usd: token.usd ? fromAtomic(BigInt(atomic), token.decimals) : null,
  };
}

export function txLink(chain: string, hash: string, role: Role): TxLink {
  const network = networkByCaip2(chain);
  return { chain: network?.caip2 ?? (chain as Caip2), hash, explorerUrl: network ? explorerTxUrl(network, hash) : null, role };
}

const appUrl = (path: string, id: string) => `${HAKO_APP_URL}${path}/${encodeURIComponent(id)}`;

/** `usehako.site/pay/<id>`: the page the invoice's QR opens. */
export const invoicePayUrl = (id: string) => appUrl(HAKO_APP_PATHS.pay, id);

/**
 * An invoice as the card draws it. `settling` (a payment claimed it and is settling) reads as open: it turns paid
 * only once the settlement landed, and a failed one releases it.
 */
export function invoiceCard(row: InvoiceRow, agentPayUrl: string): InvoiceData {
  const amount = tokenAmount(row.chain, row.asset, row.amountAtomic);
  if (!amount) throw new Error(`invoice ${row.id}: ${row.asset} on ${row.chain} is not a token Hako knows`);
  const payUrl = invoicePayUrl(row.id);
  return {
    id: row.id,
    status: row.status === "paid" ? "paid" : "open",
    amount,
    payTo: row.payTo,
    note: row.note,
    payUrl,
    agentPayUrl,
    qrPayload: payUrl,
    createdBy: row.createdBy ? "user" : "agent",
    payer: row.payer,
    tx: row.txHash ? txLink(row.chain, row.txHash, "payment") : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const CARD_STATUS: Record<ListedReceipt["status"], ReceiptData["status"]> = { pending: "pending", confirmed: "confirmed", failed: "reverted" };

/** The verb line: "Paid OpenWeather · Current weather", "Bridged 5.00 USDC Base → Solana", "Invoice paid by 0x92a3…bf0a". */
function receiptTitle(row: ListedReceipt, kind: CardReceiptKind, sent: TokenAmount | null, toolName: (id: string) => string | null): string {
  const amount = sent ? formatTokenAmount(BigInt(sent.amountAtomic), sent.token.decimals, sent.token.symbol) : "";
  const chainName = (chain: string | null) => (chain ? (networkByCaip2(chain)?.name ?? chain) : "");
  switch (kind) {
    case "run":
      return `Paid ${(row.toolId && toolName(row.toolId)) ?? row.toolId ?? "a tool"}`;
    case "batch":
      return "Paid for a batch of tools";
    case "invoice":
      return row.payer ? `Invoice paid by ${shortenAddress(row.payer)}` : "Invoice paid";
    case "send":
      return `Sent ${amount}`.trim();
    case "bridge":
      return `Bridged ${amount} ${chainName(row.chain)} → ${chainName(row.toChain)}`.replace(/\s+/g, " ").trim();
    case "swap":
      return `Swapped ${amount}`.trim();
    case "earn_deposit":
      return `Deposited ${amount}`.trim();
    case "earn_withdraw":
      return `Withdrew ${amount}`.trim();
    case "approve":
      return `Approved ${amount}`.trim();
  }
}

const SOURCE_ROLE: Partial<Record<CardReceiptKind, Role>> = {
  run: "payment",
  batch: "payment",
  invoice: "payment",
  send: "transfer",
  earn_deposit: "deposit",
  earn_withdraw: "withdraw",
  approve: "approve",
};

/** A receipt row as its card draws it. `toolName` names a catalog tool by id ("openweather/current" → its display name). */
export function receiptCard(row: ListedReceipt, toolName: (id: string) => string | null): ReceiptData {
  const kind = row.activityKind;
  const sent = tokenAmount(row.chain, row.asset, row.amountAtomic);
  const received = row.toChain && row.toAsset && row.toAmountAtomic ? tokenAmount(row.toChain, row.toAsset, row.toAmountAtomic) : null;
  const txs: TxLink[] = [];
  if (row.txHash) txs.push(txLink(row.chain, row.txHash, SOURCE_ROLE[kind] ?? "source"));
  if (row.destTxHash) txs.push(txLink(row.toChain ?? row.chain, row.destTxHash, "destination"));
  return {
    id: row.id,
    kind,
    title: receiptTitle(row, kind, sent, toolName),
    status: CARD_STATUS[row.status],
    sent,
    received,
    feeUsd: row.feeUsd,
    txs,
    requestId: row.payboxRequestId,
    draftId: row.draftId,
    shareUrl: row.isPublic ? appUrl(HAKO_APP_PATHS.receipt, row.id) : null,
    // The contract's Activity surfaces only: a gateway-recorded settlement (surface `gateway`) shows none.
    surface: activitySurfaceSchema.safeParse(row.surface).data ?? null,
    at: row.createdAt.toISOString(),
  };
}
