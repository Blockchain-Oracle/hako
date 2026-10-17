/**
 * The one door from the plugin into Hako's shared sources (plan §2 "Thin plugin, fat gateway"): plain TypeScript with
 * no runtime imports, bundled by relative path because the plugin installs and tests without the workspace. Only
 * packages/{config,networks,money}/src and packages/defi/src/core may be imported, never a bare `@hako/*` package.
 */
export {
  BATCH_MAX_CALLS,
  GATEWAY_TIMEOUT_MS,
  HAKO_APP_URL,
  HAKO_MCP_SERVER_NAME,
  HAKO_NAME,
  INVOICE_NOTE_MAX_CHARS,
  PROPOSAL_EXPIRY_LIMIT_S,
  SOLANA_TX_MAX_BYTES,
  SOLANA_TX_REQUIRED_SIGNERS,
  MS_PER_SECOND,
} from "../../../packages/config/src/index.ts";
export {
  LIFI_CONTRACT_ALLOWLIST,
  NETWORKS,
  X402_NETWORK,
  canonicalCaip2,
  explorerTxUrl,
  isExecutableCaip2,
  networkByCaip2,
  type Network,
} from "../../../packages/networks/src/index.ts";
export { fromAtomic, parseAtomic, sameAddress, toAtomic } from "../../../packages/money/src/index.ts";
export {
  bindQuote,
  erc20ApproveCalldata,
  type NormalizedQuote,
  type R15Rules,
  type R16Rules,
  type ReviewedRoute,
  type TransactionProposal,
  ZERO_UNITS,
} from "../../../packages/defi/src/core/index.ts";
