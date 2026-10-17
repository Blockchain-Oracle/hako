/**
 * Pure helpers over stored UI messages (no server-only: the client reuses textOf). The server keeps the transcript and
 * the browser sends one message at a time, so trimming happens here, before a write.
 */
import { isToolUIPart, type UIMessage } from "ai";

type Part = UIMessage["parts"][number];

const TRIMMED_OUTPUT = { trimmed: true } as const;
const encoder = new TextEncoder();

/** The text parts of a message joined, for limits and titles. */
export function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const bytesOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

function withTrimmedOutputs(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) =>
      isToolUIPart(part) && part.state === "output-available" && !same(part.output, TRIMMED_OUTPUT)
        ? { ...part, output: TRIMMED_OUTPUT }
        : part,
    ),
  };
}

/**
 * Keep the transcript under maxBytes: first replace the oldest tool outputs with `{ trimmed: true }` (the verdict text
 * around them survives), then drop the oldest messages. The newest message is never touched, and the list is kept
 * starting at a user message so the model sees a well-formed conversation.
 */
export function trimTranscript(messages: UIMessage[], maxBytes: number): UIMessage[] {
  const out = [...messages];
  let total = bytesOf(out);
  for (let i = 0; i < out.length - 1 && total > maxBytes; i++) {
    const current = out[i];
    if (!current) continue;
    const trimmed = withTrimmedOutputs(current);
    if (trimmed !== current && !same(trimmed, current)) {
      total += bytesOf(trimmed) - bytesOf(current);
      out[i] = trimmed;
    }
  }
  while (out.length > 1 && total > maxBytes) {
    const dropped = out.shift();
    total -= dropped ? bytesOf(dropped) : 0;
    while (out.length > 1 && out[0]?.role !== "user") {
      const lead = out.shift();
      total -= lead ? bytesOf(lead) : 0;
    }
  }
  return out;
}
