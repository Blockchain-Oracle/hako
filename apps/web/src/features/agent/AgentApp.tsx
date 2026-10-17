"use client";

import { createIdGenerator, type UIMessage } from "ai";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { CHAT_ID_SIZE } from "@/lib/constants/agent";
import { DOCS_URL } from "@/lib/constants/site";

import { ChatView } from "./ChatView";
import { type EndpointMeta, EndpointsProvider } from "./endpoints-context";
import { PayboxStatus } from "./PayboxStatus";
import { type HistoryGroup, Sidebar } from "./Sidebar";

const newChatId = createIdGenerator({ prefix: "chat", size: CHAT_ID_SIZE });

interface Opened {
  id: string;
  messages: UIMessage[];
  created: boolean;
}

async function loadChat(id: string): Promise<Opened | null> {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return null;
  const chat = (await res.json()) as { id: string; messages: UIMessage[] };
  return { id: chat.id, messages: chat.messages, created: true };
}

/** /agent: the history rail and one conversation at a time (remounted per chat id). */
export function AgentApp({ endpoints, initialChatId, initialInput }: {
  endpoints: Record<string, EndpointMeta>;
  initialChatId?: string;
  initialInput?: string;
}) {
  const [opened, setOpened] = useState<Opened>(() => ({ id: initialChatId ?? newChatId(), messages: [], created: false }));
  const [groups, setGroups] = useState<HistoryGroup[]>([]);

  const refresh = useCallback(() => {
    void fetch("/api/conversations")
      .then((res) => (res.ok ? (res.json() as Promise<{ groups: HistoryGroup[] }>) : null))
      .then((body) => body && setGroups(body.groups));
  }, []);

  /** A stored chat (or a fresh one when it is gone); the address follows without a remount. */
  const open = useCallback((id: string) => {
    void loadChat(id).then((chat) => {
      setOpened(chat ?? { id: newChatId(), messages: [], created: false });
      if (chat) window.history.replaceState(null, "", `/agent/c/${chat.id}`);
    });
  }, []);

  useEffect(() => {
    refresh();
    if (initialChatId) open(initialChatId);
  }, [initialChatId, open, refresh]);

  const startNew = () => {
    setOpened({ id: newChatId(), messages: [], created: false });
    window.history.replaceState(null, "", "/agent");
  };

  return (
    <EndpointsProvider endpoints={endpoints}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
              <Link href="/tools" className="hover:text-foreground">Tools</Link>
              <a href={DOCS_URL} className="hover:text-foreground">Docs</a>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <PayboxStatus />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <Sidebar
            groups={groups}
            activeId={opened.id}
            onOpen={open}
            onNew={startNew}
            onDelete={async (id) => {
              await fetch(`/api/conversations/${id}`, { method: "DELETE" });
              if (id === opened.id) startNew();
              refresh();
            }}
            onPin={async (id, pinned) => {
              await fetch(`/api/conversations/${id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pinned }),
              });
              refresh();
            }}
          />
          <ChatView
            // useChat reads its messages once, at mount: /agent/c/{id} opens on the same id before the stored
            // messages arrive, so the key changes with them too (a chat created here never flips `created`).
            key={`${opened.id}:${opened.created}`}
            chatId={opened.id}
            initialMessages={opened.messages}
            created={opened.created}
            onCreated={(id) => {
              window.history.replaceState(null, "", `/agent/c/${id}`);
              refresh();
            }}
            onTurnFinished={() => void refresh()}
            toolCount={Object.keys(endpoints).length}
            initialInput={opened.created ? "" : initialInput}
          />
        </div>
      </div>
    </EndpointsProvider>
  );
}
