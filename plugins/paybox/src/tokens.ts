/**
 * Token and wallet words an agent types, read against @hako/networks: "USDC" or the native coin's symbol become the
 * address LI.FI names them by (so R15 binds addresses, never symbols), and a wallet must belong to the chain's family.
 */
import { HakoError } from "./errors.js";
import { networkByCaip2 } from "./shared.js";
import { evmAddressSchema, solanaAddressSchema } from "./wire/primitives.js";

/** The registry's address for "USDC" or the chain's native symbol (ETH, POL, SOL); anything else unchanged. */
export function resolveToken(chain: string, token: string): string {
  const network = networkByCaip2(chain);
  if (!network) return token;
  const wanted = token.trim().toUpperCase();
  if (wanted === network.usdc.symbol.toUpperCase()) return network.usdc.address;
  if (wanted === network.native.symbol.toUpperCase()) return network.native.address;
  return token;
}

/** Refuses a wallet that can't sign on the chain (a 0x address on Solana, a base58 one on an EVM chain). */
export function requireWalletFor(chain: string, address: string, label: string): void {
  const network = networkByCaip2(chain);
  if (!network) return;
  const fits = network.family === "evm" ? evmAddressSchema.safeParse(address).success : solanaAddressSchema.safeParse(address).success;
  if (!fits) {
    const kind = network.family === "evm" ? "a 0x EVM address" : "a base58 Solana address";
    throw new HakoError("invalid_input", `${label} must be ${kind} on ${network.name} (the PayBox wallet from list_credentials).`);
  }
}
