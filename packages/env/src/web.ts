import { LOCAL_GATEWAY_URL, LOCAL_HAKO_API_URL, PAYBOX_OAUTH_REDIRECT_URL } from "@hako/config";
import { z } from "zod";

import { lifiEnvShape } from "./providers.ts";
import { envLoader, nodeEnv, optionalHexKey32, optionalSecret, optionalText, optionalUrl, urlOr } from "./shared.ts";

/** Better Auth refuses shorter secrets. */
const AUTH_SECRET_MIN_CHARS = 32;

/**
 * apps/web, server side (route handlers, server components, server actions). Browser-visible NEXT_PUBLIC_* values stay
 * in apps/web/src/lib/env.ts (inlined at build time). Everything optional has a feature that degrades without it.
 */
export const webEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  /** hako-api (the Python tool router): catalog reads and tool runs. */
  HAKO_API_URL: urlOr(LOCAL_HAKO_API_URL),
  /** The gateway, server to server: quotes, routes, rehearsal, broadcast, receipts. */
  HAKO_GATEWAY_URL: urlOr(LOCAL_GATEWAY_URL),
  /** Rate limits and sessions; without it they live in process memory (dev). */
  REDIS_URL: optionalText,
  /** The chat history Redis (AOF, noeviction); without it chats live in process memory (dev). */
  CHAT_REDIS_URL: optionalText,
  /** @hako/db and Better Auth (Postgres). */
  DATABASE_URL: optionalUrl,
  /** HMAC key for the guest session cookie. */
  SIWE_SECRET: optionalText,
  IP_HASH_SALT: optionalText,
  /** Better Auth: Hako sessions, `jwt()` and the MCP login server (issuer `<BETTER_AUTH_URL>/api/auth`). */
  BETTER_AUTH_SECRET: optionalSecret(AUTH_SECRET_MIN_CHARS),
  BETTER_AUTH_URL: optionalUrl,
  /** AES-256-GCM key for the one encrypted PayBox token store (@hako/paybox). */
  HAKO_TOKEN_ENCRYPTION_KEY: optionalHexKey32,
  /** Connect PayBox: the redirect registered for each per-user PayBox client. */
  PAYBOX_OAUTH_REDIRECT_URL: urlOr(PAYBOX_OAUTH_REDIRECT_URL),
  /** The chat's model (@hako/model): AI_MODEL ("creator/model") and one route's key. */
  AI_MODEL: optionalText,
  AI_GATEWAY_API_KEY: optionalText,
  AI_BASE_URL: optionalUrl,
  AI_API_KEY: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  /** Also the voice route's key: it mints OpenAI Realtime client secrets. */
  OPENAI_API_KEY: optionalText,
  GROQ_API_KEY: optionalText,
  ...lifiEnvShape,
});
export type WebEnv = z.output<typeof webEnvSchema>;

export const loadWebEnv = envLoader(webEnvSchema, "web");
