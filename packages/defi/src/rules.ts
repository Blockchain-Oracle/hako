// Plugin-safe: imports only the plugin-safe sources, by relative path, so the PayBox plugin bundles this file as is
// (plugins/paybox/src/shared.ts) and the gateway takes it through @hako/defi/server. One composition of R15/R16 rules.
import { SOLANA_TX_MAX_BYTES, SOLANA_TX_REQUIRED_SIGNERS } from "../../config/src/index.ts";
import { parseAtomic, sameAddress } from "../../money/src/index.ts";
import { LIFI_CONTRACT_ALLOWLIST, networkByCaip2 } from "../../networks/src/index.ts";

import type { R15Rules, R16Rules } from "./core/index.ts";

/**
 * R15's rules for a source chain, filled from the one source of each value: LI.FI's allowlist and the native coin
 * (@hako/networks), PayBox's Solana limits (@hako/config), address and amount helpers (@hako/money). Null for a chain
 * Hako's registry doesn't know. Whether the chain may execute at all is R17 (`isExecutableCaip2`), checked first.
 */
export function r15RulesFor(fromChain: string): R15Rules | null {
  const network = networkByCaip2(fromChain);
  if (!network) return null;
  return {
    allowedTargets: network.family === "evm" ? LIFI_CONTRACT_ALLOWLIST[network.key] : [],
    nativeToken: network.native.address,
    solanaMaxBytes: SOLANA_TX_MAX_BYTES,
    solanaRequiredSigners: SOLANA_TX_REQUIRED_SIGNERS,
    sameAddress,
    parseAtomic,
  };
}

/** R16's rules for an EVM source chain (approves name only LI.FI's allowlisted spenders); null otherwise. */
export function r16RulesFor(chain: string): R16Rules | null {
  const network = networkByCaip2(chain);
  if (!network || network.family !== "evm") return null;
  return { allowedSpenders: LIFI_CONTRACT_ALLOWLIST[network.key], sameAddress, parseAtomic };
}
