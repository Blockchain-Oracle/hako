import "server-only";

import { Redis } from "ioredis";

import { serverEnv } from "@/lib/server/env.server";

/**
 * The chat-history Redis (`hako-chat-redis`, AOF, noeviction), one client per process. Lazy and without an
 * offline queue so a down Redis fails a request fast instead of piling commands up; callers connect explicitly.
 */
const MAX_RETRIES_PER_REQUEST = 2;

type Slot = { redis?: Redis | null; ready?: Promise<void> };
const slot = globalThis as typeof globalThis & { __hakoChatRedis?: Slot };
const state = (slot.__hakoChatRedis ??= {});

/** The client, or null when CHAT_REDIS_URL is unset (then the memory store serves `pnpm dev`). */
export function getRedis(): Redis | null {
  if (state.redis !== undefined) return state.redis;
  const url = serverEnv().CHAT_REDIS_URL;
  if (!url) {
    state.redis = null;
    return null;
  }
  const redis = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST });
  redis.on("error", (error: Error) => console.warn(`[chat-redis] ${error.message}`));
  state.redis = redis;
  return redis;
}

/** The client once it is ready; without an offline queue the first command would otherwise be rejected. */
export async function connectedRedis(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;
  if (redis.status === "ready") return redis;
  state.ready ??= (redis.status === "wait" ? redis.connect() : waitReady(redis)).finally(() => {
    state.ready = undefined;
  });
  await state.ready;
  return redis;
}

function waitReady(redis: Redis): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      redis.off("ready", done);
      redis.off("error", fail);
      resolve();
    };
    const fail = (error: Error) => {
      redis.off("ready", done);
      redis.off("error", fail);
      reject(error);
    };
    redis.once("ready", done);
    redis.once("error", fail);
  });
}
