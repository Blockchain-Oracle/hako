/**
 * The caller's Hako session on the gateway's own routes: a Better Auth JWT sent as a bearer (the cards gateway client
 * sends it for `auth: 'hako'` routes), verified against the issuer's JWKS (`<issuer>/jwks`, plan E33). The hosted MCP
 * server's auth gate (L5, src/oauth) is a separate concern; this only answers "which Hako user is calling".
 */

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * `invalid`: the token itself is bad (expired, wrong issuer, bad signature, no matching key) — sign in again.
 * `unavailable`: the token could not be checked (the issuer's key set timed out or is unreachable) — retry.
 */
export type Session = { status: "none" } | { status: "invalid" } | { status: "unavailable" } | { status: "valid"; userId: string };
export type SessionReader = (authorization: string | undefined) => Promise<Session>;

const BEARER = /^Bearer\s+(\S+)$/i;

/** What jose throws about the token itself; anything else (JWKSTimeout, JWKSInvalid, a network error) is the issuer's. */
const TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JWKSNoMatchingKey,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

/** Reads a session against a key set; `hakoSessions` builds the production one from the issuer. */
export function sessionReader(issuer: string, keys: JWTVerifyGetKey): SessionReader {
  return async (authorization) => {
    const token = authorization?.trim().match(BEARER)?.[1];
    if (!token) return { status: "none" };
    try {
      const { payload } = await jwtVerify(token, keys, { issuer });
      return typeof payload.sub === "string" && payload.sub ? { status: "valid", userId: payload.sub } : { status: "invalid" };
    } catch (error) {
      if (TOKEN_ERRORS.some((kind) => error instanceof kind)) return { status: "invalid" };
      console.warn(JSON.stringify({ event: "session_check_unavailable", issuer, error: String(error) }));
      return { status: "unavailable" };
    }
  };
}

export function hakoSessions(issuer: string): SessionReader {
  const base = issuer.replace(/\/+$/, "");
  return sessionReader(base, createRemoteJWKSet(new URL(`${base}/jwks`)));
}
