import "server-only";

import { z } from "zod";

/**
 * Server-only settings (specs/web.md §9), validated on first use rather than at import, so `next build` in CI
 * does not need runtime secrets. Everything optional has a feature that degrades without it.
 */
const LOCAL_API_URL = "http://localhost:8000";

const optionalText = z.string().min(1).optional();

const schema = z.object({
  HAKO_API_URL: z.url().default(LOCAL_API_URL),
  REDIS_URL: optionalText,
  /** The chat history Redis (AOF, noeviction); without it chats live in process memory (dev). */
  CHAT_REDIS_URL: optionalText,
  /** HMAC key for the session cookie. */
  SIWE_SECRET: optionalText,
  GROQ_API_KEY: optionalText,
  IP_HASH_SALT: optionalText,
  AI_MODEL: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  OPENAI_API_KEY: optionalText,
  AI_GATEWAY_API_KEY: optionalText,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= schema.parse(
    Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value || undefined])),
  );
  return cached;
}
