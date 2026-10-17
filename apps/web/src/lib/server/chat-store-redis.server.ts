import "server-only";

import type { UIMessage } from "ai";
import type { ClientContext, Redis, Result } from "ioredis";

import { GUEST_CHAT_TTL_S, MAX_CHATS_PER_OWNER, NEW_CHAT_TITLE } from "@/lib/constants/agent";
import type { ChatRecord, ChatStore, ChatSummary } from "@/lib/server/chat-store.server";
import { isGuestOwner, newChatId } from "@/lib/server/chat-store.server";
import { connectedRedis } from "@/lib/server/redis.server";

/**
 * Keys: `chat:{id}` hash {owner,title,transcript,revision,pinned,createdAt,updatedAt}; `owner:{owner}:chats` zset scored
 * by updatedAt. Writes that must be atomic (compare-and-swap on the revision, the title CAS) are Lua.
 */
const NO_TTL = 0;
const TRUE = "1";

declare module "ioredis" {
  interface RedisCommander<Context extends ClientContext> {
    hakoCasWrite(
      chatKey: string,
      ownerKey: string,
      owner: string,
      expectedRevision: number,
      transcript: string,
      now: number,
      ttlS: number,
      id: string,
    ): Result<number | null, Context>;
    hakoTitleCas(chatKey: string, owner: string, previous: string, title: string, ttlS: number): Result<number, Context>;
  }
}

// KEYS: chat hash, owner zset. ARGV: owner, expected revision, transcript JSON, now, ttl seconds (0 = none), chat id.
const CAS_WRITE_LUA = `
local owner = redis.call('HGET', KEYS[1], 'owner')
if not owner or owner ~= ARGV[1] then return nil end
local revision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
if revision ~= tonumber(ARGV[2]) then return nil end
local nextRevision = revision + 1
redis.call('HSET', KEYS[1], 'transcript', ARGV[3], 'revision', nextRevision, 'updatedAt', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[6])
if tonumber(ARGV[5]) > 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  redis.call('EXPIRE', KEYS[2], ARGV[5])
end
return nextRevision
`;

// KEYS: chat hash. ARGV: owner, the title it must still have, the new title, ttl seconds (0 = none).
const TITLE_CAS_LUA = `
local owner = redis.call('HGET', KEYS[1], 'owner')
if not owner or owner ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'title') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'title', ARGV[3])
if tonumber(ARGV[4]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
return 1
`;

const chatKey = (id: string) => `chat:${id}`;
const ownerKey = (owner: string) => `owner:${owner}:chats`;
const ttlFor = (owner: string) => (isGuestOwner(owner) ? GUEST_CHAT_TTL_S : NO_TTL);

type Hash = Record<string, string>;

function recordOf(id: string, hash: Hash): ChatRecord | null {
  if (!hash.owner) return null;
  let transcript: UIMessage[] = [];
  try {
    transcript = JSON.parse(hash.transcript ?? "[]") as UIMessage[];
  } catch {
    // A corrupt transcript should not lock the chat: the next write replaces it.
  }
  return {
    id,
    owner: hash.owner,
    title: hash.title ?? NEW_CHAT_TITLE,
    pinned: hash.pinned === TRUE,
    transcript,
    revision: Number(hash.revision ?? 0),
    createdAt: Number(hash.createdAt ?? 0),
    updatedAt: Number(hash.updatedAt ?? 0),
  };
}

const summaryOf = ({ id, title, pinned, updatedAt }: ChatRecord): ChatSummary => ({ id, title, pinned, updatedAt });

export class RedisChatStore implements ChatStore {
  private defined = false;

  private async redis(): Promise<Redis> {
    const redis = await connectedRedis();
    if (!redis) throw new Error("CHAT_REDIS_URL is unset");
    if (!this.defined) {
      redis.defineCommand("hakoCasWrite", { numberOfKeys: 2, lua: CAS_WRITE_LUA });
      redis.defineCommand("hakoTitleCas", { numberOfKeys: 1, lua: TITLE_CAS_LUA });
      this.defined = true;
    }
    return redis;
  }

  /** The hash when it exists and belongs to `owner`. */
  private async owned(redis: Redis, owner: string, id: string): Promise<ChatRecord | null> {
    const chat = recordOf(id, await redis.hgetall(chatKey(id)));
    return chat && chat.owner === owner ? chat : null;
  }

  /** Oldest chats past the cap go, hash and index entry both. */
  private async cap(redis: Redis, owner: string): Promise<void> {
    const key = ownerKey(owner);
    const excess = (await redis.zcard(key)) - MAX_CHATS_PER_OWNER;
    if (excess <= 0) return;
    // ioredis types ZRANGE's stop as a string.
    const oldest = await redis.zrange(key, 0, String(excess - 1));
    const pipeline = redis.pipeline().zremrangebyrank(key, 0, excess - 1);
    for (const id of oldest) pipeline.del(chatKey(id));
    await pipeline.exec();
  }

  private async touch(redis: Redis, owner: string, id: string, fields: Partial<Hash>, bumpUpdatedAt: boolean): Promise<void> {
    const now = Date.now();
    const pipeline = redis.pipeline().hset(chatKey(id), bumpUpdatedAt ? { ...fields, updatedAt: String(now) } : fields);
    if (bumpUpdatedAt) pipeline.zadd(ownerKey(owner), now, id);
    const ttl = ttlFor(owner);
    if (ttl > NO_TTL) pipeline.expire(chatKey(id), ttl).expire(ownerKey(owner), ttl);
    await pipeline.exec();
  }

  async create(owner: string, id = newChatId()): Promise<ChatSummary> {
    const redis = await this.redis();
    const existing = recordOf(id, await redis.hgetall(chatKey(id)));
    if (existing) {
      if (existing.owner !== owner) throw new Error("chat id taken");
      return summaryOf(existing);
    }
    const now = Date.now();
    const chat: ChatRecord = { id, owner, title: NEW_CHAT_TITLE, pinned: false, transcript: [], revision: 0, createdAt: now, updatedAt: now };
    const pipeline = redis.pipeline().hset(chatKey(id), {
      owner,
      title: chat.title,
      transcript: "[]",
      revision: "0",
      pinned: "0",
      createdAt: String(now),
      updatedAt: String(now),
    });
    pipeline.zadd(ownerKey(owner), now, id);
    const ttl = ttlFor(owner);
    if (ttl > NO_TTL) pipeline.expire(chatKey(id), ttl).expire(ownerKey(owner), ttl);
    await pipeline.exec();
    await this.cap(redis, owner);
    return summaryOf(chat);
  }

  async load(owner: string, id: string): Promise<ChatRecord | null> {
    return this.owned(await this.redis(), owner, id);
  }

  async list(owner: string): Promise<ChatSummary[]> {
    const redis = await this.redis();
    const ids = await redis.zrevrange(ownerKey(owner), 0, -1);
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.hmget(chatKey(id), "owner", "title", "pinned", "updatedAt");
    const rows = (await pipeline.exec()) ?? [];
    const out: ChatSummary[] = [];
    rows.forEach(([error, row], index) => {
      const id = ids[index];
      const [rowOwner, title, pinned, updatedAt] = (row as (string | null)[] | undefined) ?? [];
      if (error || !id || rowOwner !== owner) return; // expired hash or a stale index entry
      out.push({ id, title: title ?? NEW_CHAT_TITLE, pinned: pinned === TRUE, updatedAt: Number(updatedAt ?? 0) });
    });
    return out;
  }

  async rename(owner: string, id: string, title: string): Promise<ChatSummary | null> {
    const redis = await this.redis();
    const chat = await this.owned(redis, owner, id);
    if (!chat) return null;
    await this.touch(redis, owner, id, { title }, true);
    return { ...summaryOf(chat), title, updatedAt: Date.now() };
  }

  async setPinned(owner: string, id: string, pinned: boolean): Promise<ChatSummary | null> {
    const redis = await this.redis();
    const chat = await this.owned(redis, owner, id);
    if (!chat) return null;
    await this.touch(redis, owner, id, { pinned: pinned ? TRUE : "0" }, false);
    return { ...summaryOf(chat), pinned };
  }

  async delete(owner: string, id: string): Promise<boolean> {
    const redis = await this.redis();
    if (!(await this.owned(redis, owner, id))) return false;
    await redis.pipeline().del(chatKey(id)).zrem(ownerKey(owner), id).exec();
    return true;
  }

  async casWrite(owner: string, id: string, transcript: UIMessage[], expectedRevision: number): Promise<number | null> {
    const redis = await this.redis();
    const next = await redis.hakoCasWrite(
      chatKey(id),
      ownerKey(owner),
      owner,
      expectedRevision,
      JSON.stringify(transcript),
      Date.now(),
      ttlFor(owner),
      id,
    );
    return next === null ? null : Number(next);
  }

  async autoTitle(owner: string, id: string, title: string, previous = NEW_CHAT_TITLE): Promise<boolean> {
    const redis = await this.redis();
    return (await redis.hakoTitleCas(chatKey(id), owner, previous, title, ttlFor(owner))) === 1;
  }

  async migrateOwner(from: string, to: string): Promise<number> {
    const redis = await this.redis();
    const entries = await redis.zrange(ownerKey(from), 0, "-1", "WITHSCORES");
    if (entries.length === 0) return 0;
    const pipeline = redis.pipeline();
    let moved = 0;
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const id = entries[i];
      const score = entries[i + 1];
      if (!id || score === undefined) continue;
      pipeline.hset(chatKey(id), { owner: to });
      pipeline.zadd(ownerKey(to), score, id);
      // A wallet keeps its history for good; a guest-to-guest move keeps the guest clock.
      if (isGuestOwner(to)) pipeline.expire(chatKey(id), GUEST_CHAT_TTL_S);
      else pipeline.persist(chatKey(id));
      moved += 1;
    }
    pipeline.del(ownerKey(from));
    if (isGuestOwner(to)) pipeline.expire(ownerKey(to), GUEST_CHAT_TTL_S);
    else pipeline.persist(ownerKey(to));
    await pipeline.exec();
    await this.cap(redis, to);
    return moved;
  }
}
