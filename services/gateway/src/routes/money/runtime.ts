/**
 * What the money routes share per process: the gateway environment (@hako/env), one LI.FI client (@hako/defi/server)
 * and one TTL store — Redis when REDIS_URL is set (quotes, rehearsals and sent transactions survive a restart and are
 * shared between replicas), else an in-memory map. The store never holds a key or a token (R8): only public quotes,
 * rehearsal results and sent transaction hashes.
 */
import { MS_PER_SECOND } from "@hako/config";
import { createLifiClient } from "@hako/defi/server";
import { loadGatewayEnv } from "@hako/env/node";
import type { SDKClient } from "@lifi/sdk";
import { Redis } from "ioredis";

import { CACHE_KEY_PREFIX, MEMORY_CACHE_MAX_ENTRIES } from "./money.config.js";

export interface TtlStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlS: number): Promise<void>;
  /** Sets `key` only when it is absent; true when this call set it (send-once). */
  claim(key: string, ttlS: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export const moneyEnv = () => loadGatewayEnv();

let lifiClient: SDKClient | undefined;

/** One LI.FI client per process (integrator `hako`, LIFI_API_KEY when set: keyless quotes are rate-limited). */
export function lifi(): SDKClient {
  lifiClient ??= createLifiClient({ apiKey: moneyEnv().LIFI_API_KEY });
  return lifiClient;
}

function memoryStore(): TtlStore {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  const live = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry;
    entries.delete(key);
    return undefined;
  };
  const put = (key: string, value: unknown, ttlS: number) => {
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlS * MS_PER_SECOND });
    // Map keeps insertion order: the first key is the oldest write.
    while (entries.size > MEMORY_CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  };
  return {
    get: async <T>(key: string) => live(key)?.value as T | undefined,
    set: async (key, value, ttlS) => put(key, value, ttlS),
    claim: async (key, ttlS) => {
      if (live(key)) return false;
      put(key, true, ttlS);
      return true;
    },
    release: async (key) => void entries.delete(key),
  };
}

/**
 * Redis with the memory store as its fallback for reads and caches: a Redis outage costs a cache miss, never a route.
 * A claim that can't reach Redis falls back to this process's memory, so one replica still never sends twice.
 */
function redisStore(url: string): TtlStore {
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  redis.on("error", (error: Error) => console.warn(JSON.stringify({ event: "money_redis_error", error: error.message })));
  const fallback = memoryStore();
  const name = (key: string) => `${CACHE_KEY_PREFIX}${key}`;
  return {
    async get<T>(key: string) {
      try {
        const text = await redis.get(name(key));
        return text === null ? undefined : (JSON.parse(text) as T);
      } catch {
        return fallback.get<T>(key);
      }
    },
    async set(key, value, ttlS) {
      await redis.set(name(key), JSON.stringify(value), "EX", ttlS).catch(() => fallback.set(key, value, ttlS));
    },
    async claim(key, ttlS) {
      try {
        return (await redis.set(name(key), "1", "EX", ttlS, "NX")) === "OK";
      } catch {
        return fallback.claim(key, ttlS);
      }
    },
    async release(key) {
      await redis.del(name(key)).catch(() => fallback.release(key));
    },
  };
}

let ttlStore: TtlStore | undefined;

export function store(): TtlStore {
  const url = moneyEnv().REDIS_URL;
  ttlStore ??= url ? redisStore(url) : memoryStore();
  return ttlStore;
}

/** Reads through the store: a hit is returned as is, a miss runs `load` and keeps its value for `ttlS`. */
export async function cached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
  const hit = await store().get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await store().set(key, value, ttlS);
  return value;
}
