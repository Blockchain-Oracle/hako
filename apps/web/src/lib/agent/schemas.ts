/** Tool inputs the model fills, and the run output the UI and the transcript keep. */
import { z } from "zod";

import { FIND_TOOLS_DEFAULT, FIND_TOOLS_MAX } from "@/lib/constants/agent";

const ENDPOINT_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export const FindToolsInput = z.object({
  query: z.string().min(2).describe("The job in plain words, e.g. 'recent papers on RAG hallucination' or 'weather in Lagos'"),
  limit: z.number().int().min(1).max(FIND_TOOLS_MAX).default(FIND_TOOLS_DEFAULT).describe("How many candidates to return"),
});

export const InspectToolInput = z.object({
  id: z.string().regex(ENDPOINT_ID).describe("An endpoint id from find_tools, e.g. firecrawl/search"),
});

export const RunToolInput = z.object({
  id: z.string().regex(ENDPOINT_ID).describe("The endpoint id to run, exactly as find_tools returned it"),
  input: z
    .record(z.string(), z.unknown())
    .describe("The endpoint's input as a JSON object, using only the fields its schema lists"),
});

/** Why run_tool ran nothing: every proposal ends in one of these until Connect PayBox exists. */
export const NOT_RUN_REASONS = ["paybox_not_connected", "unknown_tool", "turn_budget_spent"] as const;
export type NotRunReason = (typeof NOT_RUN_REASONS)[number];

/**
 * What run_tool returns to the UI and the transcript. Hako holds no wallet and pays for no one: a paid run is paid
 * from the user's PayBox wallet, which this chat cannot connect yet, so a proposal comes back not run and not
 * charged, with the tool's exact catalog price. Old outputs trimmed from a long transcript become `{ trimmed: true }`.
 */
export const RunOutputSchema = z.union([
  z.object({
    id: z.string(),
    ran: z.literal(false),
    reason: z.enum(NOT_RUN_REASONS),
    priceUsd: z.string().optional(),
  }),
  z.object({ trimmed: z.literal(true) }),
]);
export type RunOutput = z.infer<typeof RunOutputSchema>;
/** A run the agent proposed (not a trimmed placeholder). */
export type RunProposal = Exclude<RunOutput, { trimmed: true }>;
