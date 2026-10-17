/** Calls to the Hako gateway: bounded, JSON only, made at tool-call time (never at startup or discovery). */

import {
  BASE_CHAIN,
  BASE_USDC,
  DEFAULT_GATEWAY_URL,
  FETCH_TIMEOUT_MS,
  GATEWAY_URL_ENV,
  HTTP_PAYMENT_REQUIRED,
  PAYMENT_REQUIRED_HEADER,
  RUN_V2_PREFIX,
} from "./constants.js";

export function gatewayUrl(): string {
  return (process.env[GATEWAY_URL_ENV]?.trim() || DEFAULT_GATEWAY_URL).replace(/\/$/, "");
}

export function paidUrl(id: string): string {
  return `${gatewayUrl()}${RUN_V2_PREFIX}/${id}`;
}

async function request(path: string, body: unknown): Promise<Response> {
  return fetch(`${gatewayUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/** The gateway's own error message, so the agent can fix its input. */
async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; details?: unknown } };
    return body.error?.message ?? `gateway answered ${res.status}`;
  } catch {
    return `gateway answered ${res.status}`;
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, body);
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

/**
 * Free pre-flight of a paid run: the unpaid request either fails on the input (400/422, nothing to pay) or answers 402
 * with the live price. The proposal then carries exactly the amount the real challenge asks for.
 */
export async function preflightRun(id: string, input: unknown): Promise<{ url: string; amount: string }> {
  const url = paidUrl(id);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status !== HTTP_PAYMENT_REQUIRED) throw new Error(await errorText(res));
  const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) throw new Error("the gateway did not quote a price");
  const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    accepts?: Array<{ network?: string; asset?: string; amount?: string }>;
  };
  const offer = challenge.accepts?.find((a) => a.network === BASE_CHAIN && a.asset?.toLowerCase() === BASE_USDC);
  if (!offer?.amount || !/^[1-9][0-9]*$/.test(offer.amount)) throw new Error("the gateway did not offer Base USDC");
  return { url, amount: offer.amount };
}
