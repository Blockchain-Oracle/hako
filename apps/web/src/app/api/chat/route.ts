import { missingCredentialHint, resolveModel } from "@hako/model";
import {
  consumeStream,
  createAgentUIStreamResponse,
  createIdGenerator,
  TypeValidationError,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { z } from "zod";

import { type AgentUIMessage, buildAgent } from "@/lib/agent/agent.server";
import { fallbackTitle } from "@/lib/agent/title.server";
import { textOf, trimTranscript } from "@/lib/agent/transcript";
import {
  AGENT_TIMEOUT_MS,
  CHAT_ID_PATTERN,
  MAX_INPUT_CHARS,
  MAX_TRANSCRIPT_BYTES,
  MESSAGE_ID_SIZE,
  NEW_CHAT_TITLE,
} from "@/lib/constants/agent";
import { takeChatSlot } from "@/lib/server/chat-ratelimit.server";
import { type ChatRecord, type ChatStore, getChatStore } from "@/lib/server/chat-store.server";
import { HTTP, jsonError } from "@/lib/server/http.server";
import { clientIp } from "@/lib/server/ratelimit.server";
import { sessionFor } from "@/lib/server/session.server";

/**
 * One chat turn. The browser sends only its newest user message; the server owns the transcript: it appends the
 * message before streaming, then writes the finished turn in onEnd and names the chat from its first message while
 * the title is still "New chat". Every tool runs on the server, so the browser never sends tool outputs back.
 */
export const dynamic = "force-dynamic";
// Seconds, as Next's segment config wants a literal: AGENT_TIMEOUT_MS.
export const maxDuration = 90;

const Body = z.object({
  id: z.string().regex(CHAT_ID_PATTERN),
  message: z.object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(z.looseObject({ type: z.string() })),
    metadata: z.unknown().optional(),
  }),
});

const newMessageId = createIdGenerator({ prefix: "msg", size: MESSAGE_ID_SIZE });

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "The agent hit an error.";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(HTTP.BAD_REQUEST, "invalid_body", "Send { id, message }.");
  const { id } = parsed.data;
  const message = parsed.data.message as UIMessage;
  if (message.role !== "user") return jsonError(HTTP.BAD_REQUEST, "invalid_role", "Send a user message.");
  if (textOf(message).length > MAX_INPUT_CHARS) {
    return jsonError(HTTP.BAD_REQUEST, "input_too_long", `Up to ${MAX_INPUT_CHARS} characters per message.`);
  }

  const { session, setCookie } = await sessionFor(req.headers);
  const ip = clientIp(req.headers);
  const slot = takeChatSlot(ip);
  if (!slot.ok) {
    return jsonError(HTTP.TOO_MANY_REQUESTS, "chat_rate_limited", "The chat allows a few turns an hour.", { retry_after_s: slot.retryAfterS }, setCookie);
  }
  const resolved = resolveModel();
  if (!resolved) return jsonError(HTTP.SERVICE_UNAVAILABLE, "model_unavailable", missingCredentialHint(), {}, setCookie);

  const store = getChatStore();
  const owner = session.owner;
  const chat = await store.load(owner, id);
  if (!chat) return jsonError(HTTP.NOT_FOUND, "chat_not_found", "No such chat.", {}, setCookie);

  // The new message is on disk before the model runs: a disconnect mid-stream loses the answer, never the question.
  const transcript = trimTranscript([...chat.transcript, message], MAX_TRANSCRIPT_BYTES);
  let revision = await store.casWrite(owner, id, transcript, chat.revision);
  if (revision === null) return jsonError(HTTP.CONFLICT, "chat_conflict", "Another turn is being written to this chat.", {}, setCookie);

  const agent = buildAgent({ model: resolved.model });
  let uiMessages: AgentUIMessage[];
  try {
    uiMessages = await validateUIMessages<AgentUIMessage>({ messages: transcript, tools: agent.tools });
  } catch (error) {
    if (!(error instanceof TypeValidationError)) throw error;
    // Older turns no longer fit the tool schemas: continue from the new message alone rather than refuse the chat.
    console.warn(`[chat] transcript ${id} failed validation, continuing from the new message: ${error.message}`);
    uiMessages = await validateUIMessages<AgentUIMessage>({ messages: [message], tools: agent.tools });
  }

  return createAgentUIStreamResponse({
    agent,
    uiMessages,
    abortSignal: req.signal,
    timeout: AGENT_TIMEOUT_MS,
    originalMessages: uiMessages,
    generateMessageId: newMessageId,
    messageMetadata: ({ part }) => (part.type === "start" ? { createdAt: Date.now(), model: resolved.modelId } : undefined),
    onError: (error) => {
      console.error("[chat] stream error", error);
      return errorText(error);
    },
    // Reads the SSE copy to the end even when the client has gone, so onEnd always runs and the turn is saved.
    consumeSseStream: consumeStream,
    onEnd: async ({ messages }) => {
      revision = await persistTurn(store, owner, id, messages, revision);
      if (chat.title === NEW_CHAT_TITLE) await nameChat(store, owner, chat, messages);
    },
    headers: setCookie ? { "set-cookie": setCookie } : undefined,
  });
}

/** Write the finished turn; on a lost race (the revision moved) re-read once and write over the newer state. */
async function persistTurn(store: ChatStore, owner: string, id: string, messages: UIMessage[], expected: number | null): Promise<number | null> {
  const trimmed = trimTranscript(messages, MAX_TRANSCRIPT_BYTES);
  const first = expected === null ? null : await store.casWrite(owner, id, trimmed, expected);
  if (first !== null) return first;
  const fresh = await store.load(owner, id);
  if (!fresh) return null;
  const second = await store.casWrite(owner, id, trimmed, fresh.revision);
  if (second === null) console.warn(`[chat] transcript ${id} lost a write race twice; the turn was not saved`);
  return second;
}

/** The first message, cut at a word, names the chat: no extra model call (Groq's free tier is 8k tokens a minute). */
async function nameChat(store: ChatStore, owner: string, chat: ChatRecord, messages: UIMessage[]) {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? textOf(firstUser) : "";
  if (text.trim()) await store.autoTitle(owner, chat.id, fallbackTitle(text));
}
