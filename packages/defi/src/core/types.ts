/**
 * Plain shapes shared by the PayBox plugin (which bundles this folder by relative path), the gateway and the CLI.
 * No runtime imports: anything core needs from @hako/config, @hako/networks or @hako/money arrives as a parameter
 * (`R15Rules`, `R16Rules`), so the plugin bundles exactly these files.
 */

/** A base-10 integer string in the token's smallest unit ("1000000" = 1 USDC). */
export type AtomicString = string;
/** A CAIP-2 chain id as Hako emits it (`eip155:8453`, `solana:mainnet`). */
export type ChainId = string;

/** A token as a quote names it (LI.FI: the zero address for EVM native coins, the system program for SOL). */
export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
  /** USD price as a decimal string, when LI.FI knows it. */
  priceUsd: string | null;
  logoUri: string | null;
}

/** An unsigned EVM transaction exactly as LI.FI built it (amounts as base-10 strings). */
export interface EvmTransactionRequest {
  family: "evm";
  chainId: number;
  to: string;
  /** The sender LI.FI built for, when it says. */
  from: string | null;
  data: string;
  value: AtomicString;
  gasLimit: AtomicString | null;
}

/** An unsigned Solana transaction exactly as LI.FI built it (canonical padded base64). */
export interface SolanaTransactionRequest {
  family: "solana";
  transactionBase64: string;
}

export type QuoteTransaction = EvmTransactionRequest | SolanaTransactionRequest;

/**
 * Hako's normalised LI.FI quote (one `/quote` step), the same everywhere: cards show it, R15 binds it, the money
 * intents store it per draft version. It carries every field of @hako/paybox's `DraftQuote` (checked at compile time
 * there) plus the route and the transaction R15 needs.
 */
export interface NormalizedQuote {
  /** LI.FI's step id. */
  id: string;
  /** The bridge or exchange key (`relaydepository`, `across`, `polymerStandard`…): R15 binds it. */
  tool: string;
  toolName: string | null;
  toolLogoUri: string | null;
  /** LI.FI's numeric chain ids, always present. */
  fromChainId: number;
  toChainId: number;
  /** CAIP-2 ids when Hako's registry knows the chain, null otherwise (such a quote is never executable). */
  fromChain: ChainId | null;
  toChain: ChainId | null;
  fromToken: TokenRef;
  toToken: TokenRef;
  fromAddress: string;
  toAddress: string;
  fromAmountAtomic: AtomicString;
  toAmountAtomic: AtomicString;
  /** The on-chain floor: R15 refuses a fresh quote below the reviewed one. */
  toAmountMinAtomic: AtomicString;
  /** Fee costs plus gas, in USD (decimal string), for the card's fee line. */
  feeUsd: string | null;
  /** Gas alone, in USD (decimal string). */
  gasUsd: string | null;
  estimatedDurationS: number | null;
  /** The spender an exact approve names first (R16), or null when none is needed (native coin, Solana). */
  approvalAddress: string | null;
  transaction: QuoteTransaction | null;
  quotedAt: string;
  expiresAt: string;
}

/** What the user reviewed and R15 binds a fresh quote to (plan A6 input, plus the reviewed tool and floor). */
export interface ReviewedRoute {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  fromAmountAtomic: AtomicString;
  /** The wallet that signs (`use_plugin.wallet_id`'s address, from `list_credentials`). */
  fromAddress: string;
  toAddress: string;
  /** The LI.FI tool picked in the reviewed quote or race row. */
  tool: string;
  /** The reviewed quote's `toAmountMin` (plan A6 `minReceived`). */
  toAmountMinAtomic: AtomicString;
}

/** One EVM call for PayBox (the starter's `proposeEvm` input; `value` in wei, `data` the calldata). */
export interface EvmCallProposal {
  kind: "evm";
  chain: ChainId;
  to: string;
  value: AtomicString;
  data: string;
}

/** One unsigned Solana transaction for PayBox (`proposeSolana` input). */
export interface SolanaTxProposal {
  kind: "solana";
  chain: ChainId;
  transactionBase64: string;
}

export type TransactionProposal = EvmCallProposal | SolanaTxProposal;

/** Helpers core needs from @hako/money, passed in because core has no runtime imports. */
export interface AmountHelpers {
  /** @hako/money `sameAddress`: EVM case-insensitive, Solana exact. */
  sameAddress: (a: string, b: string) => boolean;
  /** @hako/money `parseAtomic`: a base-10 integer string to bigint, throwing on anything else. */
  parseAtomic: (value: string) => bigint;
}
