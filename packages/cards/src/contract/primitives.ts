import { z } from "zod";

/**
 * The building blocks every card and gateway schema shares. Money is never a float: atomic amounts are base-10
 * integer strings ("1000000" = 1 USDC) and USD values are decimal strings, exactly as @hako/money reads them.
 */

/** A CAIP-2 chain id (`eip155:8453`, `solana:mainnet`), the same template type as @hako/networks' `Caip2`. */
export const caip2Schema = z
  .templateLiteral([z.string().regex(/^[-a-z0-9]{3,8}$/), ":", z.string().regex(/^[-_a-zA-Z0-9]{1,64}$/)])
  .describe("CAIP-2 chain id, e.g. eip155:8453 (Base) or solana:mainnet");

/** Atomic units as a base-10 integer string. */
export const atomicSchema = z.string().regex(/^\d+$/, "an integer string of atomic units").describe("Atomic units, e.g. 1000000 = 1 USDC");

/** A plain decimal in token units as a person types it ("1.5"): converted with the token's decimals, never rounded. */
export const decimalAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "digits with an optional dot, e.g. 1.5").describe("Amount in token units, e.g. 1.5");

/** USD as a decimal string ("12.34", "-0.01"). */
export const usdSchema = z.string().regex(/^-?\d+(\.\d+)?$/, "a decimal USD amount");

/** An ISO 8601 timestamp with its offset (what Hako's own services write). */
export const isoTimeSchema = z.iso.datetime({ offset: true });

export const urlSchema = z.url({ protocol: /^https?$/ });

export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 0x address");
export const solanaAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "a base58 Solana address");
/** A wallet, token or contract address on any chain Hako reads (EVM 0x or Solana base58). */
export const addressSchema = z.union([evmAddressSchema, solanaAddressSchema]);

export const evmTxHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "a 0x transaction hash");
export const solanaSignatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "a base58 transaction signature");
export const txHashSchema = z.union([evmTxHashSchema, solanaSignatureSchema]);

export const chainFamilySchema = z.enum(["evm", "solana"]);

/** A token as a card names it: enough to format an amount and draw its mark. */
export const tokenRefSchema = z.object({
  chain: caip2Schema,
  /** Contract or mint; the zero address (EVM) or the system program (SOL) for a native coin, as LI.FI names it. */
  address: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0),
  name: z.string().optional(),
  /** Drawn through the gateway's logo proxy (`/v1/logo?src=`), never hot-linked. */
  logoUrl: urlSchema.optional(),
});
export type TokenRef = z.output<typeof tokenRefSchema>;

/** An exact amount of one token, with its USD value when one is known (never a made-up $0). */
export const tokenAmountSchema = z.object({
  token: tokenRefSchema,
  amountAtomic: atomicSchema,
  usd: usdSchema.nullable(),
});
export type TokenAmount = z.output<typeof tokenAmountSchema>;

/** A wallet a card shows: address first, the name the person knows it by beside it. */
export const walletRefSchema = z.object({
  address: addressSchema,
  family: chainFamilySchema,
  /** "Tobi", "tobi.paybox", "evm-default"… */
  label: z.string().optional(),
});
export type WalletRef = z.output<typeof walletRefSchema>;

/** One on-chain transaction a card links to. */
export const txLinkSchema = z.object({
  chain: caip2Schema,
  hash: txHashSchema,
  explorerUrl: urlSchema.nullable(),
  /** What the transaction did in the move: an exact approve, the source transfer, the destination fill, an x402 payment. */
  role: z.enum(["approve", "source", "destination", "payment", "deposit", "withdraw", "transfer"]),
});
export type TxLink = z.output<typeof txLinkSchema>;

/** A tool price as the catalog writes it (hako_tools Price.doc()). */
export const priceSchema = z.object({
  usd: usdSchema,
  atomic: atomicSchema,
  tier: z.string().min(1),
  network: caip2Schema,
});
export type Price = z.output<typeof priceSchema>;

/** Any JSON object (a tool input, a catalog row). */
export const jsonObjectSchema = z.record(z.string(), z.unknown());
