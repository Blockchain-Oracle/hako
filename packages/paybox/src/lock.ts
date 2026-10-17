/**
 * A Redis lock per key (SET NX PX with a random token; released only by its holder, through a compare-and-delete
 * script). The token refresh runs under one per user, so two processes never spend the same refresh token: PayBox
 * rotates it on every use and revokes the client when a spent one is replayed.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Redis } from "ioredis";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`Timed out waiting for the lock ${key}.`);
    this.name = "LockTimeoutError";
  }
}

export interface LockOptions {
  /** The lock expires on its own after this long, so a crashed holder can't block the key forever. */
  ttlMs: number;
  /** Give up waiting for another holder after this long. */
  waitMs: number;
  /** Try again this often while another holder has it. */
  pollMs: number;
}

/** Runs `work` while holding `key`; waits for another holder first (bounded), then throws LockTimeoutError. */
export async function withRedisLock<T>(redis: Redis, key: string, options: LockOptions, work: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + options.waitMs;
  while ((await redis.set(key, token, "PX", options.ttlMs, "NX")) !== "OK") {
    if (Date.now() >= deadline) throw new LockTimeoutError(key);
    await sleep(options.pollMs);
  }
  try {
    return await work();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
