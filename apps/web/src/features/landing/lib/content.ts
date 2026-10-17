/**
 * The landing shell's words (plan §1 promise and §1 R19 state honesty). Everything here is true today; what is not
 * live yet says so. Wave 2 (L6) finishes the landing with real captures, the ecosystem of marks and the proof section.
 */
import { LIFI_CHAIN_COUNT } from "../landing.config";

export const HERO = {
  title: "Your agent's box of paid tools and money moves.",
  /** The promise, with the live tool count filled in by the page. */
  promise: (tools: number) =>
    `Hako gives your AI agent a box of ${tools} paid tools (data, research, media) and real money moves (bridge, swap ` +
    `and earn across ${LIFI_CHAIN_COUNT} chains through LI.FI, prediction-market odds, transfers, chain lookups), paid ` +
    "and signed with your PayBox wallet, and shown as clickable cards wherever your agent lives: Hako's web app, and " +
    "inside Claude, ChatGPT, Cursor and VS Code.",
  honesty: "Live today: the tool catalog. Money moves, the cards inside AI hosts and the PayBox plugin are being built.",
  builtOn: "Built on PayBox · MoonPay",
} as const;

export type StandingState = "live" | "building";

export type StandingRow = { state: StandingState; title: string; body: string };

/** "Where Hako stands": each row says its state in words and in shape (filled dot or hollow ring), never colour alone. */
export const STANDING = (tools: number): StandingRow[] => [
  {
    state: "live",
    title: `${tools} tools on Base`,
    body: "Discover and inspect are free. Every run is an x402 payment in USDC on Base, payable from any PayBox agent with use_service.",
  },
  {
    state: "live",
    title: "Agent chat and the tool catalog",
    body: "Ask in plain words and the agent finds the tool and shows its price. Connecting PayBox to the chat comes next.",
  },
  {
    state: "building",
    title: "The Hako PayBox plugin",
    body: "Being built. Once it is submitted for review, it is installable privately under Unofficial plugins in PayBox.",
  },
  {
    state: "building",
    title: "Money moves",
    body: `Bridge, swap and earn across ${LIFI_CHAIN_COUNT} chains through LI.FI, drafted by the agent and signed in PayBox.`,
  },
  {
    state: "building",
    title: "Cards inside your AI host",
    body: "The same clickable cards inside Claude, ChatGPT, Cursor and VS Code, through Hako's MCP server.",
  },
];

export const STATE_LABEL: Record<StandingState, string> = { live: "Live", building: "Being built" };
