/**
 * LI.FI actions for the gateway and the CLI: quote, routes, status, token and chains, each bounded by
 * LIFI_TIMEOUT_MS (or the caller's own budget) and the caller's signal. Quotes come back normalised for R15.
 */
import { networkByCaip2 } from "@hako/networks";
import { ChainType, getChains, getQuote, getRoutes, getStatus, getToken, type SDKClient } from "@lifi/sdk";
import type {
  ExtendedChain,
  ExtendedTransactionInfo,
  Order,
  PendingReceivingInfo,
  QuoteRequest,
  Route,
  StatusMessage,
  Substatus,
} from "@lifi/types";

import type { NormalizedQuote, TokenRef } from "../core/index.ts";
import { callSignal, type CallOptions } from "./client.ts";
import { caip2ForLifiChain, decimalString, normalizeLifiStep, tokenRef } from "./normalize.ts";

const EIP155_CHAIN = /^eip155:(\d+)$/;

/**
 * A chain as LI.FI numbers it: a LI.FI id as is, a CAIP-2 id Hako's registry knows, or any `eip155:<id>` (LI.FI's
 * EVM ids are the EIP-155 ids). Throws for anything else, so a quote never goes to a chain nobody meant.
 */
export function lifiChainId(chain: string | number): number {
  if (typeof chain === "number") return chain;
  const known = networkByCaip2(chain);
  if (known) return known.lifiChainId;
  const evm = EIP155_CHAIN.exec(chain);
  if (evm) return Number(evm[1]);
  throw new RangeError(`Hako can't route on chain ${chain}.`);
}

export interface LifiQuoteParams {
  fromChain: string | number;
  toChain: string | number;
  fromToken: string;
  toToken: string;
  fromAmountAtomic: string;
  fromAddress: string;
  toAddress: string;
  /**
   * Pins the route to this LI.FI tool (the route-race pick; R15 refuses any other): `allowBridges=[tool]` across
   * chains, `allowExchanges=[tool]` on one chain.
   */
  tool?: string;
  /** Slippage as a fraction (0.005 = 0.5%); LI.FI's default when unset. */
  slippage?: number;
  order?: Order;
  /** Off by default, so the bridge pays the real recipient; Earn's Composer deposits may need it. */
  allowDestinationCall?: boolean;
}

/** The `/quote` request for Hako's input (exported so a race can vary only `tool`). */
export function quoteRequest(params: LifiQuoteParams): QuoteRequest {
  const fromChain = lifiChainId(params.fromChain);
  const toChain = lifiChainId(params.toChain);
  const pin = params.tool ? (fromChain === toChain ? { allowExchanges: [params.tool] } : { allowBridges: [params.tool] }) : {};
  return {
    fromChain,
    toChain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmountAtomic,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    allowDestinationCall: params.allowDestinationCall ?? false,
    ...(params.slippage === undefined ? {} : { slippage: params.slippage }),
    ...(params.order ? { order: params.order } : {}),
    ...pin,
  };
}

/** One LI.FI `/quote`, normalised. Throws LI.FI's error (no route, amount too low…) or the timeout. */
export async function lifiQuote(client: SDKClient, params: LifiQuoteParams, options: CallOptions = {}): Promise<NormalizedQuote> {
  const step = await getQuote(client, quoteRequest(params), { signal: callSignal(options) });
  return normalizeLifiStep(step);
}

/** LI.FI `/advanced/routes`: the alternatives for one request, best first, as LI.FI returns them. */
export async function lifiRoutes(client: SDKClient, params: LifiQuoteParams, options: CallOptions = {}): Promise<Route[]> {
  const request = quoteRequest(params);
  const response = await getRoutes(
    client,
    {
      fromChainId: Number(request.fromChain),
      toChainId: Number(request.toChain),
      fromTokenAddress: request.fromToken,
      toTokenAddress: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress,
      options: {
        allowDestinationCall: request.allowDestinationCall,
        ...(request.slippage === undefined ? {} : { slippage: Number(request.slippage) }),
        ...(request.order ? { order: request.order } : {}),
      },
    },
    { signal: callSignal(options) },
  );
  return response.routes;
}

/** A transfer's status as a card follows it (plan A7 `hako_bridge_status`, the Activity ledger). */
export interface LifiTransferStatus {
  status: StatusMessage;
  substatus: Substatus | null;
  message: string | null;
  tool: string | null;
  sendingTxHash: string | null;
  receivingTxHash: string | null;
  /** Hako's CAIP-2 id of the destination when known. */
  receivingChain: string | null;
  /** What arrived, in the destination token's atomic units, once LI.FI reports it. */
  receivedAmountAtomic: string | null;
  explorerUrl: string | null;
}

export interface LifiStatusParams {
  txHash: string;
  /** The bridge (LI.FI tool): required by LI.FI for cross-chain transfers. */
  tool?: string;
  fromChain?: string | number;
  toChain?: string | number;
}

/** The destination side has a transaction once something arrived (LI.FI's `ExtendedTransactionInfo`). */
function hasArrived(receiving: PendingReceivingInfo | ExtendedTransactionInfo): receiving is ExtendedTransactionInfo {
  return "txHash" in receiving && typeof receiving.txHash === "string";
}

export async function lifiStatus(client: SDKClient, params: LifiStatusParams, options: CallOptions = {}): Promise<LifiTransferStatus> {
  const response = await getStatus(
    client,
    {
      txHash: params.txHash,
      ...(params.tool ? { bridge: params.tool } : {}),
      ...(params.fromChain === undefined ? {} : { fromChain: lifiChainId(params.fromChain) }),
      ...(params.toChain === undefined ? {} : { toChain: lifiChainId(params.toChain) }),
    },
    { signal: callSignal(options) },
  );
  const receiving = "receiving" in response ? response.receiving : undefined;
  const received = receiving && hasArrived(receiving) ? receiving : undefined;
  return {
    status: response.status,
    substatus: response.substatus ?? null,
    message: response.substatusMessage ?? null,
    tool: "tool" in response ? response.tool : null,
    sendingTxHash: response.sending?.txHash ?? null,
    receivingTxHash: received?.txHash ?? null,
    receivingChain: receiving ? caip2ForLifiChain(receiving.chainId) : null,
    receivedAmountAtomic: decimalString(received?.amount),
    explorerUrl: "lifiExplorerLink" in response ? response.lifiExplorerLink : null,
  };
}

/** A token on a chain, by address or symbol, as LI.FI lists it (with its price and logo). */
export async function lifiToken(client: SDKClient, chain: string | number, token: string, options: CallOptions = {}): Promise<TokenRef & { chainId: number }> {
  const found = await getToken(client, lifiChainId(chain), token, { signal: callSignal(options) });
  return { ...tokenRef(found), chainId: found.chainId };
}

/** LI.FI's chains (EVM and Solana by default), with each one's Diamond, native coin and RPCs. */
export async function lifiChains(client: SDKClient, chainTypes: ChainType[] = [ChainType.EVM, ChainType.SVM], options: CallOptions = {}): Promise<ExtendedChain[]> {
  return getChains(client, { chainTypes }, { signal: callSignal(options) });
}
