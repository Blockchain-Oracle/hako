import "server-only";

import {
  type InferAgentUIMessage,
  type InferUITools,
  isStepCount,
  type LanguageModel,
  type StopCondition,
  ToolLoopAgent,
  type ToolSet,
  type ToolUIPart,
} from "ai";

import { AGENT_INSTRUCTIONS } from "@/lib/agent/instructions";
import { type HakoTools, buildTools } from "@/lib/agent/tools.server";
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS_PER_TURN } from "@/lib/constants/agent";

const ANSWER_NOW = "\n\nThis turn's tool budget is spent. Do not call any tool: answer now from the results above, " +
  "and say plainly what you could not get.";

const toolCalls = (steps: ReadonlyArray<{ toolCalls: readonly unknown[] }>) =>
  steps.reduce((n, step) => n + step.toolCalls.length, 0);

/**
 * Spending the tool budget gets the turn up to two more steps, told to answer, so a turn whose calls used the budget
 * still ends with an answer (stopping at the spend left the last step as tool calls and no text, seen 2026-10-12).
 * Those steps keep their tools: switching them off (activeTools: []) makes Groq reject a model that still calls one,
 * "Tool choice is none, but model called a tool" (2026-10-07). A call past the budget runs nothing and costs
 * nothing (tools.server.ts) and tells the model to answer; a model that told the user it would call every tool can
 * ignore the first nudge, which is why there are two.
 */
const ANSWER_STEPS = 2;
const answerStepsTaken: StopCondition<ToolSet> = ({ steps }) =>
  toolCalls(steps.slice(0, -ANSWER_STEPS)) >= MAX_TOOL_CALLS_PER_TURN;

/** Per message: each turn gets its own tool budget. */
export function buildAgent({ model }: { model: LanguageModel }) {
  return new ToolLoopAgent({
    model,
    instructions: AGENT_INSTRUCTIONS,
    tools: buildTools(),
    prepareStep: ({ steps }) =>
      toolCalls(steps) >= MAX_TOOL_CALLS_PER_TURN ? { instructions: AGENT_INSTRUCTIONS + ANSWER_NOW } : undefined,
    stopWhen: [isStepCount(MAX_AGENT_STEPS), answerStepsTaken],
  });
}

export type HakoAgent = ReturnType<typeof buildAgent>;

/** Set on the assistant message when the stream starts. */
export interface AgentMessageMetadata {
  createdAt: number;
  model?: string;
}

export type AgentUIMessage = InferAgentUIMessage<HakoAgent, AgentMessageMetadata>;
export type AgentToolPart = ToolUIPart<InferUITools<HakoTools>>;
