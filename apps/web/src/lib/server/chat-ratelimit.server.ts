import "server-only";

import { CHAT_MESSAGES_PER_IP_PER_HOUR, CHAT_WINDOW_S } from "@/lib/constants/agent";

/**
 * The chat's per-IP budget: a sliding window kept in memory, which is enough while the web runs as one container.
 */
const MS_PER_S = 1_000;
const WINDOW_MS = CHAT_WINDOW_S * MS_PER_S;
const turns = new Map<string, number[]>();

function recent(ip: string, now: number): number[] {
  const kept = (turns.get(ip) ?? []).filter((t) => t > now - WINDOW_MS);
  if (kept.length === 0) turns.delete(ip);
  else turns.set(ip, kept);
  return kept;
}

export function takeChatSlot(ip: string): { ok: true; remaining: number } | { ok: false; retryAfterS: number } {
  const now = Date.now();
  const used = recent(ip, now);
  if (used.length >= CHAT_MESSAGES_PER_IP_PER_HOUR) {
    const oldest = used[0] ?? now;
    return { ok: false, retryAfterS: Math.ceil((oldest + WINDOW_MS - now) / MS_PER_S) };
  }
  used.push(now);
  turns.set(ip, used);
  return { ok: true, remaining: CHAT_MESSAGES_PER_IP_PER_HOUR - used.length };
}
