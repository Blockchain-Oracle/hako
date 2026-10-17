import {
  type CardData,
  type CardEnvelope,
  type CardKind,
  type HakoToolName,
  type StructuredContent,
  type Suggestion,
  SUGGESTION_LABEL_MAX_CHARS,
  SUGGESTION_PROMPT_MAX_CHARS,
  type ToolAuth,
  type ToolVisibility,
} from "@hako/cards/contract";
import type { z } from "zod";

import type { AgentDeps } from "./deps.ts";

/** MCP tool annotations (hints a host shows; Hako's own checks never rely on them). */
export interface ToolAnnotations {
  /** Moves no money and changes nothing the person would need to undo (drafts and reads). */
  readOnlyHint: boolean;
  /** Pays or moves money (`hako_execute`, `hako_broadcast`) or deletes something the person kept (a contact). */
  destructiveHint: boolean;
  /** Calling again with the same input has no further effect (`hako_execute` returns the stored request). */
  idempotentHint: boolean;
  /** Reaches past Hako (providers, chains, PayBox). */
  openWorldHint: boolean;
}

/** A tool's result: one card, or (`hako_routes`) a stream of card snapshots, each replacing the last. */
export type ToolResult<O> = Promise<O> | AsyncGenerator<O, void, undefined>;

/**
 * One registry entry (plan E30): what the model or a card button calls, in every surface. `output` is the card
 * contract's `structuredContent` schema, so the same zod schema is the AI SDK output and the MCP `outputSchema`.
 */
export interface HakoTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType, N extends HakoToolName = HakoToolName> {
  name: N;
  title: string;
  /** Written for the model: what it does, what it won't do, what to call instead. */
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
  /** `["model", "app"]` for model-visible tools, `["app"]` for card-only tools (MCP Apps `_meta.ui.visibility`). */
  visibility: readonly ToolVisibility[];
  auth: ToolAuth;
  /** The card kinds this tool answers with. */
  cardKinds: readonly CardKind[];
  execute(input: z.output<I>, deps: AgentDeps): ToolResult<z.output<O>>;
}

export function defineTool<const N extends HakoToolName, I extends z.ZodType, O extends z.ZodType>(tool: HakoTool<I, O, N>): HakoTool<I, O, N> {
  return tool;
}

export const MODEL_AND_APP: readonly ToolVisibility[] = ["model", "app"];
export const APP_ONLY: readonly ToolVisibility[] = ["app"];

/** Reads: no money moves, nothing to undo, reaches providers or chains. */
export const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
/** Drafts: write a draft row (or an open invoice) and quote it; nothing is paid or signed. */
export const DRAFT: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
/** Pays or sends money; idempotent per draft version. */
export const MONEY: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/** A next-step chip, clipped to the contract's lengths. */
export const chip = (label: string, prompt: string): Suggestion => ({
  label: label.slice(0, SUGGESTION_LABEL_MAX_CHARS),
  prompt: prompt.slice(0, SUGGESTION_PROMPT_MAX_CHARS),
});

/** Builds a card: its data checked by the kind's schema type, its envelope stamped with the deps' clock. */
export function card<K extends CardKind>(
  kind: K,
  data: CardData<K>,
  envelope: Omit<CardEnvelope, "updatedAt" | "suggestions"> & { suggestions?: Suggestion[] },
  deps: Pick<AgentDeps, "now">,
): StructuredContent<K> {
  const { suggestions = [], ...rest } = envelope;
  return { kind, data, envelope: { ...rest, suggestions, updatedAt: deps.now().toISOString() } } as StructuredContent<K>;
}
