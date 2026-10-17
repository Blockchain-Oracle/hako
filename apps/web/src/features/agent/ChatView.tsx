"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import { PAYMENT_NETWORK } from "@/lib/constants/onchain";

import { ChatHome } from "./ChatHome";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

/**
 * One conversation. The server owns the transcript, so the transport sends only `{ id, message }`; the first send
 * creates the chat. Every tool runs on the server: discover and inspect are free, and a paid run comes back as a
 * proposal with its price, since paid runs need the user's PayBox wallet, which this chat cannot connect yet.
 */
export function ChatView({
  chatId,
  initialMessages,
  created,
  onCreated,
  onTurnFinished,
  toolCount,
  initialInput = "",
}: {
  chatId: string;
  initialMessages: UIMessage[];
  created: boolean;
  onCreated: (id: string) => void;
  onTurnFinished: () => void;
  toolCount: number;
  /** Text to start the composer with, e.g. from a tool page's "Try it in the agent". */
  initialInput?: string;
}) {
  const createdRef = useRef(created);
  const [input, setInput] = useState(initialInput);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, message: messages[messages.length - 1] },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: () => onTurnFinished(),
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const ensureChat = async (): Promise<boolean> => {
    if (createdRef.current) return true;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: chatId }),
    });
    if (!res.ok) {
      setNotice("Could not start a chat. Reload and try again.");
      return false;
    }
    createdRef.current = true;
    onCreated(chatId);
    return true;
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setNotice(null);
    if (!(await ensureChat())) return;
    setInput("");
    await sendMessage({ text: trimmed });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 py-8">
          {messages.length === 0 ? (
            <ChatHome onPick={(prompt) => void send(prompt)} toolCount={toolCount} />
          ) : (
            <MessageList messages={messages} live={busy} />
          )}
          {error && (
            <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error.message.includes("model_unavailable")
                ? "The chat has no model key on this server yet."
                : error.message.includes("rate")
                  ? "The model is rate limited for a moment (free tier). Try again in a minute."
                  : `The agent hit an error: ${error.message}`}
            </p>
          )}
          {notice && <p className="mt-6 text-sm text-destructive">{notice}</p>}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="border-t border-border bg-background/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[760px] px-4 py-4">
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send(input)}
            onStop={() => void stop()}
            busy={busy}
          />
          <p className="mt-2 text-center font-mono text-[0.6875rem] text-muted-foreground">
            Discover and inspect are free. Paid runs are paid in USDC on {PAYMENT_NETWORK.label} from your PayBox
            wallet, which isn&apos;t connected here yet.
          </p>
        </div>
      </div>
    </div>
  );
}
