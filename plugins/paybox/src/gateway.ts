/**
 * Calls to the Hako gateway: one per tool, made at tool-call time (never at startup or discovery), bounded by
 * GATEWAY_TIMEOUT_MS from @hako/config, `redirect: 'error'`, JSON only. Requests are checked against the mirrored
 * endpoint table before they leave and responses after they arrive, so contract drift fails loudly with the route's
 * name instead of becoming a wrong proposal.
 */
import * as z from "zod/v4";

import { DEFAULT_GATEWAY_URL, GATEWAY_URL_ENV, PAYMENT_REQUIRED_HEADER, X402_RAIL } from "./constants.js";
import { HakoError } from "./errors.js";
import { GATEWAY_TIMEOUT_MS } from "./shared.js";
import { ENDPOINTS, type EndpointKey, type EndpointRequest, type EndpointResponse, PAID_PATHS, type PluginEndpoint } from "./wire/endpoints.js";
import { type RunEnvelope, runEnvelopeSchema } from "./wire/reads.js";
import { HTTP_NOT_FOUND, HTTP_PAYMENT_REQUIRED } from "./wire/wire.config.js";

/** The gateway's origin: the portal variable HAKO_GATEWAY_URL, else the bundled Hako host. */
export function gatewayUrl(): string {
  return (process.env[GATEWAY_URL_ENV]?.trim() || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
}

/** A paid route's absolute URL on the configured gateway (the host PayBox fetches and pays). */
export const paidRunUrl = (id: string) => `${gatewayUrl()}${PAID_PATHS.run(id)}`;
export const paidBatchUrl = (batchId: string) => `${gatewayUrl()}${PAID_PATHS.batch(batchId)}`;
export const paidInvoiceUrl = (id: string) => `${gatewayUrl()}${PAID_PATHS.invoice(id)}`;

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional(), details: z.array(z.string()).optional() }),
});
const MISSING_ROUTE_PREFIX = "no route ";
const ISSUES_SHOWN = 3;

function checkRequest(schema: z.ZodType | undefined, value: unknown, label: string): unknown {
  if (!schema) return undefined;
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new HakoError("invalid_input", `The ${label} doesn't fit the gateway contract: ${summarize(parsed.error)}`);
  return parsed.data;
}

function summarize(error: z.ZodError): string {
  return error.issues
    .slice(0, ISSUES_SHOWN)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function urlOf(def: PluginEndpoint, request: { params?: unknown; query?: unknown }): URL {
  const params = (checkRequest(def.params, request.params, "path") ?? {}) as Record<string, unknown>;
  const path = def.path.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(String(params[name])));
  const url = new URL(`${gatewayUrl()}${path}`);
  const query = checkRequest(def.query, request.query, "query") as Record<string, unknown> | undefined;
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }
  return url;
}

/** One bounded request; network failures become typed errors. */
async function send(url: string, init: { method: "GET" | "POST"; body?: string }): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: init.body,
      redirect: "error",
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new HakoError("gateway_timeout", `The Hako gateway didn't answer within ${GATEWAY_TIMEOUT_MS} ms.`);
    }
    throw new HakoError("gateway_unreachable", `The Hako gateway at ${new URL(url).host} could not be reached.`);
  }
}

/** The gateway's own error envelope as a typed error ("no route …" = a route this gateway doesn't serve yet). */
async function errorOf(res: Response, method: string, path: string): Promise<HakoError> {
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Not the gateway's envelope (a proxy page, an empty body): report the status line below.
  }
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return new HakoError("gateway_error", `The Hako gateway answered ${res.status} on ${method} ${path}.`, `http_${res.status}`);
  const { code, message, details = [] } = parsed.data.error;
  if (res.status === HTTP_NOT_FOUND && message.startsWith(MISSING_ROUTE_PREFIX)) {
    return new HakoError("gateway_route_missing", `The Hako gateway doesn't serve ${method} ${path} yet, so this tool can't answer right now.`, code);
  }
  return new HakoError("gateway_error", details.length ? `${message} (${details.join("; ")})` : message, code);
}

/** One free route: request checked, sent, error mapped, response checked against the table. */
async function callEndpoint(def: PluginEndpoint, raw: { params?: unknown; query?: unknown; body?: unknown }): Promise<unknown> {
  const url = urlOf(def, raw);
  const body = def.body ? JSON.stringify(checkRequest(def.body, raw.body, "request body")) : undefined;
  const res = await send(url.toString(), { method: def.method, body });
  if (res.status === HTTP_PAYMENT_REQUIRED) throw new HakoError("gateway_error", `${def.method} ${def.path} asked for payment; it should be free.`, "payment_required");
  if (!res.ok) throw await errorOf(res, def.method, def.path);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new HakoError("gateway_contract_mismatch", `${def.method} ${def.path} answered without JSON.`);
  }
  const parsed = def.response.safeParse(json);
  if (!parsed.success) throw new HakoError("gateway_contract_mismatch", `${def.method} ${def.path} answered outside the wire contract: ${summarize(parsed.error)}`);
  return parsed.data;
}

/** Calls one free route of the endpoint table and returns its checked response. */
export async function callGateway<K extends EndpointKey>(key: K, request: EndpointRequest<K>): Promise<EndpointResponse<K>> {
  return (await callEndpoint(ENDPOINTS[key], request)) as EndpointResponse<K>;
}

/** The read aliases (`/v1/chain/*`, `/v1/markets`, `/v1/earn/{vaults,positions}`): a connector input in, its run envelope out. */
export type AliasKey = { [K in EndpointKey]: (typeof ENDPOINTS)[K]["response"] extends typeof runEnvelopeSchema ? K : never }[EndpointKey];
export async function callAlias(key: AliasKey, body: unknown): Promise<RunEnvelope> {
  return (await callEndpoint(ENDPOINTS[key], { body })) as RunEnvelope;
}

const challengeSchema = z.object({
  accepts: z.array(z.looseObject({ network: z.string().optional(), asset: z.string().optional(), amount: z.string().optional() })),
});

/**
 * Free pre-flight of a paid run: the unpaid request either fails on the input (400/422, nothing to pay) or answers 402
 * with the live price. The proposal then carries exactly the amount the real challenge asks for.
 */
export async function preflightRun(id: string, input: unknown): Promise<{ url: string; amountAtomic: string }> {
  const url = paidRunUrl(id);
  const res = await send(url, { method: "POST", body: JSON.stringify(input) });
  if (res.status !== HTTP_PAYMENT_REQUIRED) {
    if (res.ok) throw new HakoError("gateway_contract_mismatch", `POST /v2/run/${id} answered ${res.status} without asking for payment.`);
    throw await errorOf(res, "POST", `/v2/run/${id}`);
  }
  const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) throw new HakoError("gateway_contract_mismatch", "The gateway did not quote a price.");
  let challenge: z.output<typeof challengeSchema>;
  try {
    challenge = challengeSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
  } catch {
    throw new HakoError("gateway_contract_mismatch", "The gateway's payment challenge could not be read.");
  }
  const offer = challenge.accepts.find((a) => a.network === X402_RAIL.chain && a.asset?.toLowerCase() === X402_RAIL.asset.toLowerCase());
  if (!offer?.amount || !/^[1-9][0-9]*$/.test(offer.amount)) throw new HakoError("gateway_contract_mismatch", "The gateway did not offer Base USDC.");
  return { url, amountAtomic: offer.amount };
}
