import { GATEWAY_TIMEOUT_MS, HAKO_GATEWAY_URL, ROUTE_RACE_TOTAL_TIMEOUT_MS } from "@hako/config";
import { z } from "zod";

import { HTTP_PAYMENT_REQUIRED, HTTP_UNAUTHORIZED, ROUTE_STREAM_GRACE_MS } from "../contract/contract.config.ts";
import { type EndpointDef, type EndpointKey, GATEWAY_ENDPOINTS, type GatewayEndpoints, type ResponseType } from "../contract/gateway/endpoints.ts";

/**
 * The typed gateway client, built from the endpoint table: real `fetch` against the gateway URL (production
 * `api.usehako.xyz` from @hako/config unless the caller's environment names another). Requests are checked against
 * the table's zod schemas before they leave and responses after they arrive, so contract drift fails loudly with the
 * route's name instead of drawing a broken card. It never pays: an x402 route answers 402 and the client reports it.
 */

/** The gateway's one error envelope: `{error: {code, message, retryable, details}}`. */
export const gatewayErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    details: z.array(z.string()).optional(),
  }),
});

// Fields are assigned in the constructors (no parameter properties), so Node's type stripping can run these sources.
export class GatewayError extends Error {
  readonly endpoint: EndpointKey;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: readonly string[];

  constructor(endpoint: EndpointKey, status: number, code: string, message: string, retryable: boolean, details: readonly string[] = []) {
    super(message);
    this.name = "GatewayError";
    this.endpoint = endpoint;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/** An x402 route answered 402: PayBox pays it (`use_service`, a plugin proposal); this client does not. */
export class GatewayPaymentRequired extends GatewayError {
  /** The `PAYMENT-REQUIRED` challenge header, as the gateway sent it. */
  readonly challenge: string | null;

  constructor(endpoint: EndpointKey, challenge: string | null) {
    super(endpoint, HTTP_PAYMENT_REQUIRED, "payment_required", `${endpoint} is a paid route: PayBox pays it, this client does not`, false);
    this.name = "GatewayPaymentRequired";
    this.challenge = challenge;
  }
}

/** The gateway answered 2xx with a body outside the endpoint table: the contract drifted. */
export class GatewayContractError extends GatewayError {
  readonly issues: z.core.$ZodIssue[];

  constructor(endpoint: EndpointKey, issues: z.core.$ZodIssue[]) {
    super(endpoint, 0, "contract_mismatch", `${endpoint} answered outside its schema: ${z.prettifyError(new z.ZodError(issues))}`, false);
    this.name = "GatewayContractError";
    this.issues = issues;
  }
}

type Field = "params" | "query" | "body";
type FieldInput<D, F extends Field> = D extends { [P in F]: infer S extends z.ZodType } ? { [P in F]: z.input<S> } : { [P in F]?: undefined };

/** What one endpoint takes: its path params, query and JSON body, each typed by the table. */
export type EndpointRequest<K extends EndpointKey> = FieldInput<GatewayEndpoints[K], "params"> &
  FieldInput<GatewayEndpoints[K], "query"> &
  FieldInput<GatewayEndpoints[K], "body">;
export type EndpointResponse<K extends EndpointKey> = z.output<GatewayEndpoints[K]["response"]>;

type KeysOf<T extends ResponseType> = { [K in EndpointKey]: GatewayEndpoints[K]["responseType"] extends T ? K : never }[EndpointKey];
export type JsonEndpointKey = KeysOf<"json">;
export type StreamEndpointKey = KeysOf<"ndjson">;
export type BinaryEndpointKey = KeysOf<"binary">;

export interface CallInit {
  signal?: AbortSignal;
  timeoutMs?: number;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- "no required field" is exactly `{}`
type Args<K extends EndpointKey> = {} extends EndpointRequest<K> ? [request?: EndpointRequest<K>, init?: CallInit] : [request: EndpointRequest<K>, init?: CallInit];
/** A URL needs only the path params and the query. */
export type EndpointLocation<K extends EndpointKey> = Omit<EndpointRequest<K>, "body">;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- "no required field" is exactly `{}`
type UrlArgs<K extends EndpointKey> = {} extends EndpointLocation<K> ? [location?: EndpointLocation<K>] : [location: EndpointLocation<K>];

export interface BinaryBody {
  contentType: string;
  bytes: ArrayBuffer;
}

export interface GatewayClientOptions {
  /** The gateway's origin; production when absent. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The caller's Hako session token (Better Auth JWT), sent as a bearer; required by `auth: 'hako'` routes. */
  bearer?: () => string | null | Promise<string | null>;
  /** Per-call budget for JSON and binary routes (GATEWAY_TIMEOUT_MS by default). */
  timeoutMs?: number;
}

export interface GatewayClient {
  readonly baseUrl: string;
  /** The absolute URL of a route on this client's origin (`/v1/files/<id>`, logo proxy links). */
  url<K extends EndpointKey>(key: K, ...args: UrlArgs<K>): string;
  /** Whether calls carry a Hako session (a bearer), which `auth: 'hako'` routes need. */
  authenticated(): Promise<boolean>;
  call<K extends JsonEndpointKey>(key: K, ...args: Args<K>): Promise<EndpointResponse<K>>;
  stream<K extends StreamEndpointKey>(key: K, ...args: Args<K>): AsyncGenerator<EndpointResponse<K>>;
  bytes<K extends BinaryEndpointKey>(key: K, ...args: Args<K>): Promise<BinaryBody>;
}

const STREAM_TIMEOUT_MS = ROUTE_RACE_TOTAL_TIMEOUT_MS + ROUTE_STREAM_GRACE_MS;
const ACCEPT: Record<ResponseType, string> = { json: "application/json", ndjson: "application/x-ndjson", binary: "*/*" };

type RawRequest = Partial<Record<Field, unknown>>;

const defOf = (key: EndpointKey): EndpointDef => GATEWAY_ENDPOINTS[key];
const originOf = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

function urlOf(baseUrl: string, def: EndpointDef, request: RawRequest): URL {
  const params = def.params ? (def.params.parse(request.params ?? {}) as Record<string, unknown>) : {};
  const path = def.path.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(String(params[name])));
  const url = new URL(`${originOf(baseUrl)}${path}`);
  if (def.query) {
    const query = def.query.parse(request.query ?? {}) as Record<string, unknown>;
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
  }
  return url;
}

/**
 * A route's absolute URL on a given gateway origin, without a client. Paid URLs that PayBox's servers fetch
 * (`/v2/run/*` on a pay card, `use_service` instructions) are built on the public origin with this, even when the
 * caller reaches the gateway on an internal address.
 */
export function endpointUrl<K extends EndpointKey>(baseUrl: string, key: K, ...[location]: UrlArgs<K>): string {
  return urlOf(baseUrl, defOf(key), (location ?? {}) as RawRequest).toString();
}

export function createGatewayClient(options: GatewayClientOptions = {}): GatewayClient {
  const baseUrl = originOf(options.baseUrl ?? HAKO_GATEWAY_URL);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const bearerOf = async (): Promise<string | null> => (options.bearer ? await options.bearer() : null);

  async function send(key: EndpointKey, request: RawRequest, init: CallInit = {}): Promise<Response> {
    const def = defOf(key);
    const url = urlOf(baseUrl, def, request);
    const headers: Record<string, string> = { accept: ACCEPT[def.responseType] };
    const token = await bearerOf();
    if (token) headers.authorization = `Bearer ${token}`;
    else if (def.auth === "hako") {
      throw new GatewayError(key, HTTP_UNAUTHORIZED, "auth_required", `${key} needs a signed-in Hako session`, false);
    }
    let body: string | undefined;
    if (def.body) {
      body = JSON.stringify(def.body.parse(request.body));
      headers["content-type"] = "application/json";
    }
    const budget = init.timeoutMs ?? (def.responseType === "ndjson" ? STREAM_TIMEOUT_MS : (options.timeoutMs ?? GATEWAY_TIMEOUT_MS));
    const signals = [AbortSignal.timeout(budget), ...(init.signal ? [init.signal] : [])];
    const res = await fetchImpl(url, { method: def.method, headers, body, redirect: "error", signal: AbortSignal.any(signals) });
    if (res.status === HTTP_PAYMENT_REQUIRED) throw new GatewayPaymentRequired(key, res.headers.get("payment-required"));
    if (!res.ok) throw await errorOf(key, res);
    return res;
  }

  function checked<K extends EndpointKey>(key: K, value: unknown): EndpointResponse<K> {
    const parsed = defOf(key).response.safeParse(value);
    if (!parsed.success) throw new GatewayContractError(key, parsed.error.issues);
    return parsed.data as EndpointResponse<K>;
  }

  return {
    baseUrl,
    url: (key, ...args) => endpointUrl(baseUrl, key, ...args),
    authenticated: async () => Boolean(await bearerOf()),
    async call(key, ...[request, init]) {
      const res = await send(key, (request ?? {}) as RawRequest, init);
      return checked(key, await res.json());
    },
    async *stream(key, ...[request, init]) {
      const res = await send(key, (request ?? {}) as RawRequest, init);
      for await (const line of ndjsonLines(res)) yield checked(key, JSON.parse(line));
    },
    async bytes(key, ...[request, init]) {
      const res = await send(key, (request ?? {}) as RawRequest, init);
      return { contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes: await res.arrayBuffer() };
    },
  };
}

async function errorOf(key: EndpointKey, res: Response): Promise<GatewayError> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not the gateway's envelope (a proxy page, an empty body): report the status line.
  }
  const parsed = gatewayErrorBodySchema.safeParse(body);
  if (!parsed.success) return new GatewayError(key, res.status, `http_${res.status}`, res.statusText || `HTTP ${res.status}`, false);
  const { code, message, retryable = false, details = [] } = parsed.data.error;
  return new GatewayError(key, res.status, code, message, retryable, details);
}

/** One JSON document per line, as the route race streams its snapshots. */
async function* ndjsonLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
      newline = buffer.indexOf("\n");
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) yield rest;
}
