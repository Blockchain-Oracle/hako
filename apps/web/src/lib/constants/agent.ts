/** The agent chat: every limit the server and the client share, named once. */

export const CHAT_MESSAGES_PER_IP_PER_HOUR = 30;
export const CHAT_WINDOW_S = 3_600;
export const MAX_INPUT_CHARS = 4_000;
export const MAX_TOOL_CALLS_PER_TURN = 6;
export const MAX_AGENT_STEPS = 8;
export const AGENT_TIMEOUT_MS = 90_000;
// Supplier data the model reads per run (the UI keeps the whole envelope). Small on purpose: Groq's free tier
// allows 8k tokens a minute per model (measured 2026-10-07), and every step re-sends the history.
export const MAX_MODEL_OUTPUT_CHARS = 4_000;
export const MAX_TRANSCRIPT_BYTES = 524_288;
export const MAX_CHATS_PER_OWNER = 200;
export const TITLE_MAX = 120;
export const FALLBACK_TITLE_MAX = 48;
export const NEW_CHAT_TITLE = "New chat";
export const MESSAGE_ID_SIZE = 16;
export const CHAT_ID_SIZE = 16;
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // opaque token: the id reaches Redis keys
export const GUEST_CHAT_TTL_S = 2_592_000; // 30 days: guests keep history for a month, wallets keep it for good
export const SESSION_COOKIE = "hako_sid";
export const SESSION_TTL_S = 2_592_000;
export const SESSION_ID_BYTES = 18;
export const TITLE_SOURCE_MAX_CHARS = 1_000; // how much of the first message the title model sees
export const TITLE_MAX_TOKENS = 24;
export const TITLE_TIMEOUT_MS = 8_000;

export const FIND_TOOLS_DEFAULT = 5;
export const FIND_TOOLS_MAX = 8;
export const INPUT_FIELD_DESCRIPTION_CHARS = 90; // per field in the compact schemas the model reads

export const TOOL_NAMES = ["find_tools", "inspect_tool", "run_tool"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** What the timeline row says while a call is in flight. */
export const TOOL_VERBS: Record<ToolName, string> = {
  find_tools: "Searching the catalog",
  inspect_tool: "Reading the tool's contract",
  run_tool: "Pricing the run",
};

export interface Suggestion {
  label: string;
  prompt: string;
}

/** Starters that each exercise a different part of the catalog. */
export const SUGGESTIONS: Suggestion[] = [
  {
    label: "A cited answer",
    prompt: "How does the x402 payment protocol work, and who uses it today? Answer with sources.",
  },
  {
    label: "Papers on RAG",
    prompt: "Find three recent papers on detecting hallucinations in RAG systems and tell me what they agree on.",
  },
  {
    label: "Lagos weather + FX",
    prompt: "Is it raining in Lagos right now, and what is 100 USD in NGN today?",
  },
  {
    label: "Is this package alive?",
    prompt: "Is the Python package httpx still maintained? Latest version, release date, and open issues on GitHub.",
  },
  {
    label: "Coffee near Union Square",
    prompt: "Find the top-rated coffee shops near Union Square, San Francisco, with ratings.",
  },
  {
    label: "Food allergen law",
    prompt: "What does US federal law require for allergen labeling on packaged food? Cite primary sources.",
  },
];

export const HISTORY_GROUPS = ["Pinned", "Today", "Yesterday", "Earlier"] as const;
export type HistoryGroup = (typeof HISTORY_GROUPS)[number];
