import { z } from "zod";

import { CHAT_ID_PATTERN, TITLE_MAX } from "@/lib/constants/agent";
import { getChatStore } from "@/lib/server/chat-store.server";
import { empty, HTTP, json, jsonError, readJson } from "@/lib/server/http.server";
import { readSession } from "@/lib/server/session.server";

/** One chat: its transcript (reopen), rename, pin, delete. No session → nothing is theirs → 404, as for another's chat. */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const PatchBody = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((body) => body.title !== undefined || body.pinned !== undefined, "Send title and/or pinned.");

const notFound = () => jsonError(HTTP.NOT_FOUND, "chat_not_found", "No such chat.");

export async function GET(req: Request, { params }: Context) {
  const { id } = await params;
  if (!CHAT_ID_PATTERN.test(id)) return notFound();
  const session = await readSession(req.headers);
  if (!session) return notFound();
  const chat = await getChatStore().load(session.owner, id);
  return chat ? json({ id: chat.id, title: chat.title, messages: chat.transcript }) : notFound();
}

export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params;
  if (!CHAT_ID_PATTERN.test(id)) return notFound();
  const session = await readSession(req.headers);
  if (!session) return notFound();
  const parsed = PatchBody.safeParse(await readJson(req));
  if (!parsed.success) {
    return jsonError(HTTP.BAD_REQUEST, "invalid_body", `Send { title? (≤ ${TITLE_MAX} chars), pinned? }.`);
  }
  const store = getChatStore();
  let summary = parsed.data.title !== undefined ? await store.rename(session.owner, id, parsed.data.title) : null;
  if (parsed.data.pinned !== undefined) summary = await store.setPinned(session.owner, id, parsed.data.pinned);
  return summary ? json(summary) : notFound();
}

export async function DELETE(req: Request, { params }: Context) {
  const { id } = await params;
  if (!CHAT_ID_PATTERN.test(id)) return notFound();
  const session = await readSession(req.headers);
  if (!session) return notFound();
  return (await getChatStore().delete(session.owner, id)) ? empty(HTTP.NO_CONTENT) : notFound();
}
