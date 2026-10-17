/**
 * PayBox OAuth 2.1 for Connect PayBox (plan §1 execution rules; context/01-paybox-platform/mcp-connector-and-oauth.md):
 * one public client per Hako user (`POST /oauth/register`, `token_endpoint_auth_method: none`), PKCE S256 with
 * `scope=mcp offline_access` and `resource=https://api.paybox.sh/mcp`, the code exchange and the refresh (which
 * rotates the refresh token: the old one is spent, and replaying it revokes the client). Node `fetch` (Python urllib
 * is blocked by Cloudflare at PayBox, SP13).
 */
import { createHash, randomBytes } from "node:crypto";

import {
  PAYBOX_OAUTH_AUTHORIZE_URL,
  PAYBOX_OAUTH_REGISTER_URL,
  PAYBOX_OAUTH_RESOURCE,
  PAYBOX_OAUTH_SCOPE,
  PAYBOX_OAUTH_TOKEN_URL,
  MS_PER_SECOND,
  PKCE_METHOD,
} from "@hako/config";

import { OAUTH_STATE_BYTES, PAYBOX_CLIENT_NAME, PAYBOX_OAUTH_TIMEOUT_MS, PKCE_VERIFIER_BYTES } from "./paybox.config.ts";

export type Fetch = typeof fetch;

/** A PayBox OAuth error (`invalid_grant`, `invalid_client`…) or an unexpected answer. */
export class PayboxOAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, description: string) {
    super(`PayBox OAuth ${code} (${status}): ${description}`);
    this.name = "PayboxOAuthError";
    this.code = code;
    this.status = status;
  }
  /** The grant or the client is gone (a used or rotated token, a revoked client): the user must reconnect. */
  get revoked(): boolean {
    return this.code === "invalid_grant" || this.code === "invalid_client";
  }
}

export interface PayboxTokenSet {
  accessToken: string;
  /** Present whenever `offline_access` was granted; always store the newest one. */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
  /** PayBox's subject, read from the access token (an attribute: SP10 decides whether it is stable across clients). */
  sub: string | null;
}

async function post(url: string, body: string | URLSearchParams, contentType: string, fetchImpl: Fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": contentType, accept: "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(PAYBOX_OAUTH_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof json.error === "string" ? json.error : "http_error";
    const description = typeof json.error_description === "string" ? json.error_description : response.statusText;
    throw new PayboxOAuthError(code, response.status, description);
  }
  return json;
}

/** Registers a new public client for one Hako user and returns its `client_id`. */
export async function registerPayboxClient(redirectUri: string, fetchImpl: Fetch = fetch): Promise<string> {
  const json = await post(
    PAYBOX_OAUTH_REGISTER_URL,
    JSON.stringify({ client_name: PAYBOX_CLIENT_NAME, redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
    "application/json",
    fetchImpl,
  );
  if (typeof json.client_id !== "string" || json.client_id === "") throw new PayboxOAuthError("invalid_response", 0, "registration returned no client_id");
  return json.client_id;
}

/** A PKCE pair: the verifier stays on the server, the S256 challenge goes into the authorize URL. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(PKCE_VERIFIER_BYTES).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const createOAuthState = (): string => randomBytes(OAUTH_STATE_BYTES).toString("base64url");

/** The URL the user opens to sign in to PayBox and grant wallets to this client. */
export function payboxAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(PAYBOX_OAUTH_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.challenge,
    code_challenge_method: PKCE_METHOD,
    scope: PAYBOX_OAUTH_SCOPE,
    resource: PAYBOX_OAUTH_RESOURCE,
    state: input.state,
  }).toString();
  return url.toString();
}

/** The `sub` claim of PayBox's access token (a JWT); null when it can't be read. Never used to authorize anything. */
export function subjectOf(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

function tokenSet(json: Record<string, unknown>, now: Date): PayboxTokenSet {
  const accessToken = json.access_token;
  const expiresIn = json.expires_in;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    throw new PayboxOAuthError("invalid_response", 0, "the token endpoint returned no access token");
  }
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * MS_PER_SECOND),
    scope: typeof json.scope === "string" ? json.scope : null,
    sub: subjectOf(accessToken),
  };
}

/** Exchanges the callback's code (single use: a replayed code revokes the client). */
export async function exchangePayboxCode(
  input: { clientId: string; redirectUri: string; code: string; verifier: string },
  fetchImpl: Fetch = fetch,
): Promise<PayboxTokenSet> {
  const now = new Date();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  return tokenSet(await post(PAYBOX_OAUTH_TOKEN_URL, body, "application/x-www-form-urlencoded", fetchImpl), now);
}

/** Uses a refresh token once; the answer carries the next refresh token, which must be stored before anything else. */
export async function refreshPayboxTokens(input: { clientId: string; refreshToken: string }, fetchImpl: Fetch = fetch): Promise<PayboxTokenSet> {
  const now = new Date();
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: input.clientId, refresh_token: input.refreshToken });
  return tokenSet(await post(PAYBOX_OAUTH_TOKEN_URL, body, "application/x-www-form-urlencoded", fetchImpl), now);
}
