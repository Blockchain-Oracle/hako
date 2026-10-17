import { Mark, getEntity } from "./mark.tsx";
import { chainKey, tokenKey } from "./registry.ts";

export type TokenMarkProps = {
  /** CAIP-2 chain id (`eip155:8453`, `solana:mainnet`). */
  caip2: string;
  /** The token's address as LI.FI names it (the zero address for EVM native coins, the system program for SOL). */
  address: string;
  /** Shown in the neutral disc and said to assistive tech when the registry does not know the token. */
  symbol: string;
  name?: string;
  /** LI.FI's `logoURI` for the token: shown through the gateway's logo proxy when the registry has no mark. */
  logoUri?: string;
  size?: number;
  /** Badge the token with its chain's mark (lists that mix chains). */
  chainBadge?: boolean;
  className?: string;
};

/**
 * A token's mark, resolved in plan §3's order: the identity SVG for `token:<caip2>:<address>` → LI.FI's logoURI through
 * the gateway proxy → the labelled neutral disc with the symbol. Never a mark matched by symbol alone: a token that
 * calls itself USDC at an unknown address does not get USDC's mark.
 */
export function TokenMark({ caip2, address, symbol, name, logoUri, size, chainBadge = false, className }: TokenMarkProps) {
  const known = getEntity(tokenKey(caip2, address));
  return (
    <Mark
      entity={known ?? { id: tokenKey(caip2, address), kind: "token", name: name ?? symbol, symbol, caip2, address, shape: "disc", marks: {} }}
      logoUri={logoUri}
      size={size}
      chainBadge={chainBadge ? chainKey(caip2) : undefined}
      className={className}
    />
  );
}
