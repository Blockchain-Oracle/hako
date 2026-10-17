/**
 * LI.FI Earn Data API (`https://earn.li.fi/v1`, plan A8): vault discovery and positions. Deposits and withdrawals are
 * Composer quotes (`lifiQuote` with the vault as `toToken`, or as `fromToken` to redeem). Earn answers 401 without
 * the API key, so the client requires one.
 */
import { LIFI_API_KEY_HEADER, LIFI_EARN_API_URL } from "@hako/config";
import type { EarnChain, EarnPortfolioResponse, EarnProtocol, EarnVault, EarnVaultListResponse } from "@lifi/types";

import { callSignal, type CallOptions } from "./client.ts";

export class EarnApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "EarnApiError";
    this.status = status;
  }
}

/** `GET /v1/vaults` filters (earn-openapi.yaml). */
export interface EarnVaultQuery {
  chainId?: number;
  /** Underlying token symbol or address ("USDC"). */
  asset?: string;
  protocol?: string;
  minTvlUsd?: number;
  isTransactional?: boolean;
  isRedeemable?: boolean;
  isComposerSupported?: boolean;
  sortBy?: "apy" | "tvl";
  cursor?: string;
  limit?: number;
}

export interface EarnClient {
  listVaults(query?: EarnVaultQuery, options?: CallOptions): Promise<EarnVaultListResponse>;
  getVault(chainId: number, address: string, options?: CallOptions): Promise<EarnVault>;
  listChains(options?: CallOptions): Promise<EarnChain[]>;
  listProtocols(options?: CallOptions): Promise<EarnProtocol[]>;
  getPositions(userAddress: string, options?: CallOptions & { cursor?: string }): Promise<EarnPortfolioResponse>;
}

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** Throws, naming the variable, when the key is missing: Earn would answer every call with 401. */
export function createEarnClient(settings: { apiKey: string | undefined; baseUrl?: string }): EarnClient {
  const trimmed = settings.apiKey?.trim();
  if (!trimmed) throw new Error("LIFI_API_KEY is not set: LI.FI Earn answers 401 without it.");
  const apiKey: string = trimmed;
  const baseUrl = settings.baseUrl ?? LIFI_EARN_API_URL;

  async function get<T>(path: string, options: CallOptions = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "application/json", [LIFI_API_KEY_HEADER]: apiKey },
      redirect: "error",
      signal: callSignal(options),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
      const message = typeof body?.message === "string" ? body.message : response.statusText;
      throw new EarnApiError(response.status, `LI.FI Earn ${path.split("?")[0]} answered ${response.status}: ${message}`);
    }
    return (await response.json()) as T;
  }

  return {
    listVaults: (filters = {}, options) => get<EarnVaultListResponse>(`/vaults${query({ ...filters })}`, options),
    getVault: (chainId, address, options) => get<EarnVault>(`/vaults/${chainId}/${encodeURIComponent(address)}`, options),
    listChains: (options) => get<EarnChain[]>("/chains", options),
    listProtocols: (options) => get<EarnProtocol[]>("/protocols", options),
    getPositions: (userAddress, options = {}) =>
      get<EarnPortfolioResponse>(`/portfolio/${encodeURIComponent(userAddress)}/positions${query({ cursor: options.cursor })}`, options),
  };
}
