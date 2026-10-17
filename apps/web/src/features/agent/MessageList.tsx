"use client";

import type { UIMessage } from "ai";
import { Streamdown } from "streamdown";

import { PayCard } from "./PayCard";
import { asToolPart, runOutput, type ToolPart, toolName } from "./parts";
import { ToolTimeline } from "./ToolTimeline";

type Block = { kind: "text"; text: string; key: string } | { kind: "tools"; parts: ToolPart[]; key: string };

/** Consecutive tool parts become one timeline; text parts stay prose (KeeperHub's groupParts, simplified). */
function blocks(message: UIMessage): Block[] {
  const out: Block[] = [];
  message.parts.forEach((part, index) => {
    const tool = asToolPart(part);
    if (tool) {
      const last = out.at(-1);
      if (last?.kind === "tools") last.parts.push(tool);
      else out.push({ kind: "tools", parts: [tool], key: `${message.id}-t${index}` });
    } else if (part.type === "text" && part.text.trim()) {
      out.push({ kind: "text", text: part.text, key: `${message.id}-x${index}` });
    }
  });
  return out;
}

export function MessageList({ messages, live }: { messages: UIMessage[]; live: boolean }) {
  return (
    <ol className="flex flex-col gap-6">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        if (message.role === "user") {
          const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          return (
            <li key={message.id} className="flex justify-end">
              <p className="max-w-[80%] rounded-lg bg-muted px-4 py-2.5 text-[0.9375rem] whitespace-pre-wrap text-foreground">{text}</p>
            </li>
          );
        }
        return (
          <li key={message.id} className="flex flex-col gap-3">
            {blocks(message).map((block) =>
              block.kind === "text" ? (
                <div key={block.key} className="prose-hako max-w-none text-[0.9375rem] leading-relaxed text-foreground">
                  <Streamdown>{block.text}</Streamdown>
                </div>
              ) : (
                <div key={block.key} className="flex flex-col gap-3">
                  <ToolTimeline parts={block.parts} live={live && isLast} />
                  {block.parts
                    .filter((p) => toolName(p) === "run_tool")
                    .map((p) => {
                      const proposal = runOutput(p);
                      // A call past the turn's tool budget proposed nothing to pay for: the timeline row says so.
                      if (!proposal || proposal.reason === "turn_budget_spent") return null;
                      return <PayCard key={p.toolCallId} input={p.input ?? {}} proposal={proposal} />;
                    })}
                </div>
              ),
            )}
          </li>
        );
      })}
    </ol>
  );
}
