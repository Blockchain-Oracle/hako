import { decimalAmountSchema } from "@hako/cards/contract";
import { z } from "zod";

import { AgentToolError } from "./errors.ts";
import { resolveChain } from "./resolve.ts";

/**
 * Input fields the model fills, shared by the tools. Chains are taken the way people say them ("base", "solana") or
 * as CAIP-2, and come out canonical; tokens by symbol or address; amounts in token units as digits ("1.5").
 */

export const chainInputSchema = z
  .string()
  .min(1)
  .describe("Chain: base, ethereum, arbitrum, optimism, polygon, solana, or a CAIP-2 id like eip155:8453")
  .transform((value, ctx) => {
    try {
      return resolveChain(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof AgentToolError ? error.message : `unknown chain ${value}` });
      return z.NEVER;
    }
  });

export const tokenInputSchema = z.string().min(1).describe("Token symbol (USDC, ETH, SOL) or its contract / mint address");

export const amountInputSchema = decimalAmountSchema;

export const addressInputSchema = z.string().min(1).describe("A wallet address (0x… or Solana base58)");

/** Optional: the wallet that sends. Absent → the user's PayBox wallet for that chain (needs Connect PayBox). */
export const senderInputSchema = addressInputSchema
  .optional()
  .describe("Sending wallet address; leave out to use the connected PayBox wallet");
