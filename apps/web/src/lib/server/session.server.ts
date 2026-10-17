import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { SESSION_COOKIE, SESSION_ID_BYTES, SESSION_TTL_S } from "@/lib/constants/agent";
import { serverEnv } from "@/lib/server/env.server";
import { connectedRedis } from "@/lib/server/redis.server";

/**
 * The httpOnly session: `hako_sid=${id}.${sig}`, HMAC-SHA256 over the id. A guest owns `guest:{id}`. A wallet
 * session (`sess:{id}` = {kind:"wallet", address}, owning `addr:{address}`) is reserved for sign-in with Ethereum,
 * which is not wired yet. Minted lazily by the API routes that need one (no middleware).
 */
export type SessionKind = "guest" | "wallet";

export interface Session {
  id: string;
  kind: SessionKind;
  /** the chat-store owner key */
  owner: string;
  address?: string;
}

const HMAC = "sha256";
const ENCODING = "base64url";
const SIG_SEPARATOR = ".";

let fallbackSecret: string | undefined;

/** SIWE_SECRET, or a process-local random secret (sessions then die with the process: fine for `pnpm dev`). */
function secret(): string {
  const configured = serverEnv().SIWE_SECRET;
  if (configured) return configured;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(SESSION_ID_BYTES).toString(ENCODING);
    console.warn("[session] SIWE_SECRET is unset: sessions are signed with a process-local secret and will not survive a restart.");
  }
  return fallbackSecret;
}

const sign = (id: string): string => createHmac(HMAC, secret()).update(id).digest(ENCODING);

const guestOwner = (id: string) => `guest:${id}`;
const walletOwner = (address: string) => `addr:${address.toLowerCase()}`;

function cookieValue(headers: Headers): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    if (pair.slice(0, at).trim() === SESSION_COOKIE) return pair.slice(at + 1).trim();
  }
  return null;
}

/** The session id when the cookie is present and its signature verifies. */
export function readSessionId(headers: Headers): string | null {
  const value = cookieValue(headers);
  if (!value) return null;
  const at = value.lastIndexOf(SIG_SEPARATOR);
  if (at <= 0) return null;
  const id = value.slice(0, at);
  const given = Buffer.from(value.slice(at + 1));
  const expected = Buffer.from(sign(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** The session behind the cookie, with the wallet binding looked up when a Redis is configured. */
export async function readSession(headers: Headers): Promise<Session | null> {
  const id = readSessionId(headers);
  if (!id) return null;
  const redis = await connectedRedis().catch(() => null);
  if (redis) {
    const bound = await redis.hgetall(`sess:${id}`).catch(() => ({}) as Record<string, string>);
    if (bound.kind === "wallet" && bound.address) {
      return { id, kind: "wallet", address: bound.address, owner: walletOwner(bound.address) };
    }
  }
  return { id, kind: "guest", owner: guestOwner(id) };
}

/** A fresh guest session and the Set-Cookie header that carries it. */
export function issueGuest(): { session: Session; setCookie: string } {
  const id = randomBytes(SESSION_ID_BYTES).toString(ENCODING);
  const attributes = [
    `${SESSION_COOKIE}=${id}${SIG_SEPARATOR}${sign(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_S}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ];
  return { session: { id, kind: "guest", owner: guestOwner(id) }, setCookie: attributes.join("; ") };
}

/** The request's session, minting a guest when there is none; `setCookie` is set only when one was minted. */
export async function sessionFor(headers: Headers): Promise<{ session: Session; setCookie?: string }> {
  const existing = await readSession(headers);
  return existing ? { session: existing } : issueGuest();
}
