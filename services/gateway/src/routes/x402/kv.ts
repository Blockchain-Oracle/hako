/**
 * The small key-value store batches, invoice claims, rate limits and the logo cache live in: Redis (REDIS_URL) in
 * production, an in-process map in development only. Every value is a string with a lifetime.
 */

import { Redis } from "ioredis";

import { MS_PER_SECOND } from "@hako/config";

import { MEMORY_STORE_MAX_KEYS } from "./x402.config.js";

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS: number): Promise<void>;
  /** Sets only when the key is absent (Redis `SET NX EX`): true for the one caller that set it. */
  setIfAbsent(key: string, value: string, ttlS: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Counts a hit in a fixed window; the window starts at the first hit. */
  hit(key: string, windowS: number): Promise<number>;
}

export function redisStore(url: string): KvStore {
  // A command waits through at most two reconnects, then fails the request instead of hanging it.
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  redis.on("error", (error: Error) => console.warn(JSON.stringify({ event: "gateway_redis_error", error: error.message })));
  return {
    get: (key) => redis.get(key),
    async set(key, value, ttlS) {
      await redis.set(key, value, "EX", ttlS);
    },
    async setIfAbsent(key, value, ttlS) {
      return (await redis.set(key, value, "EX", ttlS, "NX")) === "OK";
    },
    async del(key) {
      await redis.del(key);
    },
    async hit(key, windowS) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowS);
      return count;
    },
  };
}

/** Development only: one process, lost on restart, oldest keys dropped past MEMORY_STORE_MAX_KEYS. */
export function memoryStore(now: () => number = Date.now): KvStore {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) entries.delete(key);
    return entries.get(key) ?? null;
  };
  const put = (key: string, value: string, ttlS: number) => {
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlS * MS_PER_SECOND });
    for (const oldest of entries.keys()) {
      if (entries.size <= MEMORY_STORE_MAX_KEYS) break;
      entries.delete(oldest);
    }
  };
  return {
    get: async (key) => live(key)?.value ?? null,
    async set(key, value, ttlS) {
      put(key, value, ttlS);
    },
    async setIfAbsent(key, value, ttlS) {
      if (live(key)) return false;
      put(key, value, ttlS);
      return true;
    },
    async del(key) {
      entries.delete(key);
    },
    async hit(key, windowS) {
      const entry = live(key);
      const count = entry ? Number(entry.value) + 1 : 1;
      if (entry) entry.value = String(count);
      else put(key, String(count), windowS);
      return count;
    },
  };
}
