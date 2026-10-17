"use client";

import { MessageSquarePlus, Pin, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
}
export interface HistoryGroup {
  label: string;
  chats: ChatSummary[];
}

/** History (KeeperHub v2's sessions, as a rail): new chat, then Pinned / Today / Yesterday / Earlier. */
export function Sidebar({
  groups,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onPin,
}: {
  groups: HistoryGroup[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-subtle md:flex">
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-background px-3 text-sm font-medium shadow-card hover:bg-muted"
        >
          <MessageSquarePlus className="size-4" aria-hidden /> New chat
        </button>
      </div>
      <nav aria-label="Chat history" className="flex-1 overflow-y-auto px-2 pb-4">
        {groups
          .filter((g) => g.chats.length > 0)
          .map((group) => (
            <div key={group.label} className="mt-3">
              <p className="px-2 pb-1 font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">{group.label}</p>
              <ul>
                {group.chats.map((chat) => (
                  <li key={chat.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onOpen(chat.id)}
                      className={cn(
                        "w-full truncate rounded-sm px-2 py-1.5 pr-14 text-left text-[0.8125rem]",
                        chat.id === activeId ? "bg-background font-medium text-foreground shadow-card" : "text-ink-2 hover:bg-background",
                      )}
                    >
                      {chat.title}
                    </button>
                    <span className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
                      <button type="button" onClick={() => onPin(chat.id, !chat.pinned)} className="rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label={chat.pinned ? "Unpin" : "Pin"}>
                        <Pin className={cn("size-3.5", chat.pinned && "fill-current")} aria-hidden />
                      </button>
                      <button type="button" onClick={() => onDelete(chat.id)} className="rounded-sm p-1 text-muted-foreground hover:text-destructive" aria-label="Delete">
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </nav>
    </aside>
  );
}
