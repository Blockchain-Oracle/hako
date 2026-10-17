/**
 * The wire's building blocks, mirrored field for field from packages/cards/src/contract/primitives.ts (the one wire
 * contract). The plugin can't import those zod schemas (they resolve the workspace's zod, and the plugin installs on
 * its own), so these are the same shapes on the plugin's zod 4.4.3. Change both together.
 */
import * as z from "zod/v4";

export const caip2Schema = z
  .templateLiteral([z.string().regex(/^[-a-z0-9]{3,8}$/), ":", z.string().regex(/^[-_a-zA-Z0-9]{1,64}$/)])
  .describe("CAIP-2 chain id, e.g. eip155:8453 (Base) or solana:mainnet");

export const atomicSchema = z.string().regex(/^\d+$/, "an integer string of atomic units").describe("Atomic units, e.g. 1000000 = 1 USDC");
export const decimalAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "digits with an optional dot, e.g. 1.5").describe("Amount in token units, e.g. 1.5");
export const usdSchema = z.string().regex(/^-?\d+(\.\d+)?$/, "a decimal USD amount");
export const isoTimeSchema = z.iso.datetime({ offset: true });
export const urlSchema = z.url({ protocol: /^https?$/ });

export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 0x address");
export const solanaAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "a base58 Solana address");
export const addressSchema = z.union([evmAddressSchema, solanaAddressSchema]);

export const evmTxHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "a 0x transaction hash");
export const solanaSignatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "a base58 transaction signature");
export const txHashSchema = z.union([evmTxHashSchema, solanaSignatureSchema]);

export const tokenRefSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0),
  name: z.string().optional(),
  logoUrl: urlSchema.optional(),
});
export type WireTokenRef = z.output<typeof tokenRefSchema>;

export const tokenAmountSchema = z.object({
  token: tokenRefSchema,
  amountAtomic: atomicSchema,
  usd: usdSchema.nullable(),
});

export const txLinkSchema = z.object({
  chain: caip2Schema,
  hash: txHashSchema,
  explorerUrl: urlSchema.nullable(),
  role: z.enum(["approve", "source", "destination", "payment", "deposit", "withdraw", "transfer"]),
});

export const priceSchema = z.object({
  usd: usdSchema,
  atomic: atomicSchema,
  tier: z.string().min(1),
  network: caip2Schema,
});

/** Any JSON object (a tool input, a catalog row). */
export const jsonObjectSchema = z.record(z.string(), z.unknown());
