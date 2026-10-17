import "server-only";

import { createIdGenerator, type UIMessage } from "ai";

import { CHAT_ID_SIZE, MAX_CHATS_PER_OWNER, NEW_CHAT_TITLE } from "@/lib/constants/agent";
import { RedisChatStore } from "@/lib/server/chat-store-redis.server";
import { getRedis } from "@/lib/server/redis.server";

/**
 * Chat history: the server keeps the transcript, the browser sends one message at a time. Redis in
 * production, a Map for `pnpm dev` without Redis; the same interface either way. Owners never cross: every operation
 * checks the chat's owner before reading or writing.
 */
export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
}

export interface ChatRecord extends ChatSummary {
  owner: string;
  transcript: UIMessage[];
  /** bumped by every transcript write; casWrite refuses a stale one */
  revision: number;
  createdAt: number;
}

export interface ChatStore {
  create(owner: string, id?: string): Promise<ChatSummary>;
  load(owner: string, id: string): Promise<ChatRecord | null>;
  /** newest first */
  list(owner: string): Promise<ChatSummary[]>;
  rename(owner: string, id: string, title: string): Promise<ChatSummary | null>;
  setPinned(owner: string, id: string, pinned: boolean): Promise<ChatSummary | null>;
  delete(owner: string, id: string): Promise<boolean>;
  /** the new revision, or null when the stored revision moved on (a concurrent write) or the chat is gone */
  casWrite(owner: string, id: string, transcript: UIMessage[], expectedRevision: number): Promise<number | null>;
  /** writes only while the title still equals `previous` (the untouched "New chat" by default), so a user rename wins */
  autoTitle(owner: string, id: string, title: string, previous?: string): Promise<boolean>;
  /** on sign-in: a guest's chats become the wallet's; returns how many moved */
  migrateOwner(from: string, to: string): Promise<number>;
}

export const newChatId = createIdGenerator({ prefix: "chat", size: CHAT_ID_SIZE });
export const isGuestOwner = (owner: string): boolean => owner.startsWith("guest:");

const summaryOf = ({ id, title, pinned, updatedAt }: ChatRecord): ChatSummary => ({ id, title, pinned, updatedAt });

export class MemoryChatStore implements ChatStore {
  private readonly chats = new Map<string, ChatRecord>();

  private owned(owner: string, id: string): ChatRecord | null {
    const chat = this.chats.get(id);
    return chat && chat.owner === owner ? chat : null;
  }

  private capped(owner: string): void {
    const mine = [...this.chats.values()].filter((c) => c.owner === owner).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of mine.slice(MAX_CHATS_PER_OWNER)) this.chats.delete(old.id);
  }

  async create(owner: string, id = newChatId()): Promise<ChatSummary> {
    const existing = this.chats.get(id);
    if (existing) {
      if (existing.owner !== owner) throw new Error("chat id taken");
      return summaryOf(existing);
    }
    const now = Date.now();
    const chat: ChatRecord = { id, owner, title: NEW_CHAT_TITLE, pinned: false, transcript: [], revision: 0, createdAt: now, updatedAt: now };
    this.chats.set(id, chat);
    this.capped(owner);
    return summaryOf(chat);
  }

  async load(owner: string, id: string): Promise<ChatRecord | null> {
    const chat = this.owned(owner, id);
    return chat ? structuredClone(chat) : null;
  }

  async list(owner: string): Promise<ChatSummary[]> {
    return [...this.chats.values()]
      .filter((c) => c.owner === owner)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summaryOf);
  }

  async rename(owner: string, id: string, title: string): Promise<ChatSummary | null> {
    const chat = this.owned(owner, id);
    if (!chat) return null;
    chat.title = title;
    chat.updatedAt = Date.now();
    return summaryOf(chat);
  }

  async setPinned(owner: string, id: string, pinned: boolean): Promise<ChatSummary | null> {
    const chat = this.owned(owner, id);
    if (!chat) return null;
    chat.pinned = pinned;
    return summaryOf(chat);
  }

  async delete(owner: string, id: string): Promise<boolean> {
    return this.owned(owner, id) ? this.chats.delete(id) : false;
  }

  async casWrite(owner: string, id: string, transcript: UIMessage[], expectedRevision: number): Promise<number | null> {
    const chat = this.owned(owner, id);
    if (!chat || chat.revision !== expectedRevision) return null;
    chat.transcript = structuredClone(transcript);
    chat.revision += 1;
    chat.updatedAt = Date.now();
    return chat.revision;
  }

  async autoTitle(owner: string, id: string, title: string, previous = NEW_CHAT_TITLE): Promise<boolean> {
    const chat = this.owned(owner, id);
    if (!chat || chat.title !== previous) return false;
    chat.title = title;
    return true;
  }

  async migrateOwner(from: string, to: string): Promise<number> {
    let moved = 0;
    for (const chat of this.chats.values()) {
      if (chat.owner !== from) continue;
      chat.owner = to;
      moved += 1;
    }
    this.capped(to);
    return moved;
  }
}

const slot = globalThis as typeof globalThis & { __hakoChatStore?: ChatStore };

/** Redis when CHAT_REDIS_URL is set, else the process-local Map (dev HMR keeps the same instance via globalThis). */
export function getChatStore(): ChatStore {
  slot.__hakoChatStore ??= getRedis() ? new RedisChatStore() : new MemoryChatStore();
  return slot.__hakoChatStore;
}
