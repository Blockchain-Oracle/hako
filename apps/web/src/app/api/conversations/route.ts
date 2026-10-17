import { z } from "zod";

import { CHAT_ID_PATTERN, HISTORY_GROUPS, type HistoryGroup } from "@/lib/constants/agent";
import { type ChatSummary, getChatStore } from "@/lib/server/chat-store.server";
import { HTTP, json, jsonError, readJson } from "@/lib/server/http.server";
import { sessionFor } from "@/lib/server/session.server";

/** The history sidebar: the session owner's chats, grouped on the server (pinned first, then by day). */
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const CreateBody = z.object({ id: z.string().regex(CHAT_ID_PATTERN).optional() });

interface HistoryGroupOut {
  label: HistoryGroup;
  chats: ChatSummary[];
}

/** Day boundaries are UTC: the server does not know the viewer's zone, and the labels only need to be stable. */
function groupOf(chat: ChatSummary, now: number): HistoryGroup {
  if (chat.pinned) return "Pinned";
  const startOfToday = now - (now % DAY_MS);
  if (chat.updatedAt >= startOfToday) return "Today";
  if (chat.updatedAt >= startOfToday - DAY_MS) return "Yesterday";
  return "Earlier";
}

export function groupChats(chats: ChatSummary[], now = Date.now()): HistoryGroupOut[] {
  const groups = Object.fromEntries(HISTORY_GROUPS.map((label) => [label, [] as ChatSummary[]])) as Record<HistoryGroup, ChatSummary[]>;
  for (const chat of chats) groups[groupOf(chat, now)].push(chat);
  return HISTORY_GROUPS.map((label) => ({ label, chats: groups[label] }));
}

export async function GET(req: Request) {
  const { session, setCookie } = await sessionFor(req.headers);
  const chats = await getChatStore().list(session.owner);
  return json({ groups: groupChats(chats) }, HTTP.OK, setCookie);
}

export async function POST(req: Request) {
  const { session, setCookie } = await sessionFor(req.headers);
  const parsed = CreateBody.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return jsonError(HTTP.BAD_REQUEST, "invalid_body", "Send {} or { id } (an opaque token).", {}, setCookie);
  try {
    const { id, title } = await getChatStore().create(session.owner, parsed.data.id);
    return json({ id, title }, HTTP.CREATED, setCookie);
  } catch {
    // The only failure create() raises itself: the id belongs to another owner.
    return jsonError(HTTP.CONFLICT, "chat_id_taken", "That chat id belongs to someone else.", {}, setCookie);
  }
}
