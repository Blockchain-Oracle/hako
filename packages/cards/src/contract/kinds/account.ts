import { z } from "zod";

import { CONTACT_NAME_MAX_CHARS, PAYBOX_USERNAME_MAX_CHARS } from "../contract.config.ts";
import { cardActionSchema, cardFixSchema } from "../envelope.ts";
import { cardPhaseSchema } from "../phase.ts";
import {
  addressSchema,
  caip2Schema,
  chainFamilySchema,
  evmAddressSchema,
  isoTimeSchema,
  tokenAmountSchema,
  tokenRefSchema,
  txLinkSchema,
  urlSchema,
  usdSchema,
  walletRefSchema,
} from "../primitives.ts";
import { receiptKindSchema } from "./outcome.ts";

/**
 * The person's own things (Hako-made, strict camelCase): invoices, the activity ledger, the agent passport, contacts,
 * the portfolio, receive and fund (QR), and the limit card. Everything here belongs to the connected PayBox account.
 */

/**
 * A pay-me invoice (plan add-ons; `POST /v1/invoices`, `GET /v1/invoices/<id>`): an x402 resource paid straight to the
 * payee. v1 is Base USDC. `/pay/<id>` always shows the full payee address.
 */
export const invoiceDataSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["open", "paid"]),
  amount: tokenAmountSchema,
  /** The payee: the PayBox wallet the invoice settles to (`DynamicPayTo`). */
  payTo: evmAddressSchema,
  note: z.string().nullable(),
  /** `usehako.xyz/pay/<id>`: what the QR encodes. */
  payUrl: urlSchema,
  /** `GET /v2/invoice/<id>` on the gateway: what any PayBox agent pays with core `use_service`. */
  agentPayUrl: urlSchema,
  qrPayload: z.string().min(1),
  /** "Created by an agent · check this address" on invoices made through the plugin. */
  createdBy: z.enum(["user", "agent"]),
  payer: z.string().nullable(),
  tx: txLinkSchema.nullable(),
  paidAt: isoTimeSchema.nullable(),
  createdAt: isoTimeSchema,
});
export type InvoiceData = z.output<typeof invoiceDataSchema>;

export const ACTIVITY_SURFACES = ["web", "mcp", "cli", "plugin", "voice"] as const;

/** One ledger row: a mark, a verb, a signed amount, a status in words and shape, a time, an explorer link. */
export const activityRowSchema = z.object({
  id: z.string().min(1),
  kind: receiptKindSchema,
  verb: z.string().min(1),
  direction: z.enum(["in", "out", "none"]),
  amount: tokenAmountSchema.nullable(),
  phase: cardPhaseSchema,
  /** "Waiting for your approval", "Arriving", "Paid"… */
  statusText: z.string().min(1),
  chain: caip2Schema.nullable(),
  tx: txLinkSchema.nullable(),
  requestId: z.string().nullable(),
  /** Opens the receipt in a side sheet. */
  receiptId: z.string().nullable(),
  surface: z.enum(ACTIVITY_SURFACES).nullable(),
  at: isoTimeSchema,
});
export type ActivityRow = z.output<typeof activityRowSchema>;

/** The activity ledger (add-ons "Activity ledger"; `/activity` and the in-chat `hako_activity` card). */
export const activityDataSchema = z.object({
  rows: z.array(activityRowSchema),
  nextCursor: z.string().nullable(),
});
export type ActivityData = z.output<typeof activityDataSchema>;

/** Something the passport found wrong, with its one fix ("Raise it", "Top up gas", "Add funds"). */
export const passportIssueSchema = z.object({
  text: z.string().min(1),
  fix: cardFixSchema,
  action: cardActionSchema,
});

export const APPROVAL_MODES = ["always_approve", "iframe", "autonomous", "paybox"] as const;

export const passportWalletSchema = z.object({
  credentialId: z.string().min(1),
  name: z.string(),
  family: chainFamilySchema,
  address: addressSchema,
  /** The grant's approval mode chip (PayBox `list_credentials` grant). */
  mode: z.enum(APPROVAL_MODES),
  balances: z.array(tokenAmountSchema),
  /** Whether the wallet can pay gas on its chains (`check_operation_readiness`); null when unknown. */
  gasReady: z.boolean().nullable(),
  issues: z.array(passportIssueSchema),
});

/** The first card after Connect PayBox: what Hako can do with this wallet right now, and every red item's fix. */
export const passportDataSchema = z.object({
  wallets: z.array(passportWalletSchema),
  /** Wallets the person owns but has not shared with Hako's PayBox client. */
  ungranted: z.array(z.object({ credentialId: z.string().min(1), name: z.string(), kind: z.enum(["card", "wallet", "secret"]) })),
  agentSignerRecorded: z.boolean(),
  plugins: z.array(z.object({ id: z.string().min(1), name: z.string().nullable(), type: z.enum(["official", "unofficial"]), enabled: z.boolean() })),
  /** Hako's own plugin is enabled on this account (then money moves run through `use_plugin`). */
  hakoEnabled: z.boolean(),
  /** What Hako can do right now, in words. */
  canDo: z.array(z.string().min(1)),
  issues: z.array(passportIssueSchema),
});
export type PassportData = z.output<typeof passportDataSchema>;

/** A saved recipient (plan D25): an address or a PayBox username, verified by QR. */
export const contactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(CONTACT_NAME_MAX_CHARS),
  address: addressSchema,
  family: chainFamilySchema,
  payboxUsername: z.string().max(PAYBOX_USERNAME_MAX_CHARS).nullable(),
  verified: z.boolean(),
  createdAt: isoTimeSchema,
});
export type Contact = z.output<typeof contactSchema>;

export const contactDataSchema = z.object({
  contacts: z.array(contactSchema),
  action: z.enum(["list", "added", "renamed", "deleted", "resolved"]),
  /** The contact this call added, renamed, deleted or resolved. */
  changedId: z.string().nullable(),
});
export type ContactData = z.output<typeof contactDataSchema>;

/** Balances across the connected wallets (PayBox `get_portfolio`). No made-up $0: an unknown value is null. */
export const portfolioDataSchema = z.object({
  wallets: z.array(walletRefSchema),
  holdings: z.array(z.object({ wallet: addressSchema, amount: tokenAmountSchema })),
  totalUsd: usdSchema.nullable(),
  asOf: isoTimeSchema,
});
export type PortfolioData = z.output<typeof portfolioDataSchema>;

/** Receive: the wallet's address on one chain and its QR (dark on white, centre mark). */
export const receiveDataSchema = z.object({
  wallet: walletRefSchema,
  chain: caip2Schema,
  token: tokenRefSchema.nullable(),
  qrPayload: z.string().min(1),
});
export type ReceiveData = z.output<typeof receiveDataSchema>;

/** Fund: MoonPay's on-ramp through PayBox `get_buy_link`, or PayBox's deposit page (`get_deposit_link`), with a QR. */
export const fundDataSchema = z.object({
  wallet: walletRefSchema,
  chain: caip2Schema,
  buy: z.object({ url: urlSchema, currencyCode: z.string().min(1), network: caip2Schema }).nullable(),
  deposit: z.object({ url: urlSchema, expiresAt: isoTimeSchema, amountUsd: z.number().nullable() }).nullable(),
  /** The link the QR opens on a phone. */
  qrPayload: urlSchema,
});
export type FundData = z.output<typeof fundDataSchema>;

/** "Raise my limit": PayBox `request_account_change` → `manage_url`, where the person changes it themselves. */
export const limitDataSchema = z.object({
  manageUrl: urlSchema,
  note: z.string().nullable(),
});
export type LimitData = z.output<typeof limitDataSchema>;
