import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Which model drives the /agent chat: server only. Adapted from Stocklana's model resolver (same author).
 *
 * One setting chooses the model, `AI_MODEL="creator/model"`, and the resolver takes whichever route the available
 * credential allows:
 *   1. AI_BASE_URL + AI_API_KEY  → any OpenAI-compatible endpoint (OpenRouter, a local server, …);
 *   2. the named provider's own key (ANTHROPIC_API_KEY, OPENAI_API_KEY) → that provider directly;
 *   3. AI_GATEWAY_API_KEY → Vercel's AI Gateway, which routes the whole `creator/model` string;
 *   4. nothing → null, and the caller answers 503 with `missingCredentialHint()`.
 * Direct keys come before the gateway: a key already held should not need a gateway account.
 */

/** Used when AI_MODEL is unset. Any provider works; this is only the default route. */
export const DEFAULT_AI_MODEL = "anthropic/claude-sonnet-5-5";

type Factory = (modelId: string) => LanguageModel;

interface DirectProvider {
  keyEnv: string;
  create: (apiKey: string) => Factory;
}

/** Groq speaks the OpenAI chat-completions dialect (not the Responses API), so it goes through `.chat()`. */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
/** When no model credential is set but Groq's is (the tool router already holds one), the chat still runs. */
export const GROQ_FALLBACK_MODEL = "groq/openai/gpt-oss-20b";

const DIRECT: Record<string, DirectProvider> = {
  anthropic: { keyEnv: "ANTHROPIC_API_KEY", create: (apiKey) => createAnthropic({ apiKey }) },
  openai: { keyEnv: "OPENAI_API_KEY", create: (apiKey) => createOpenAI({ apiKey }) },
  groq: {
    keyEnv: "GROQ_API_KEY",
    create: (apiKey) => (modelId) =>
      createOpenAI({ apiKey, baseURL: GROQ_BASE_URL, headers: { "user-agent": "Hako/1.0" } }).chat(modelId),
  },
};

export interface ResolvedModel {
  model: LanguageModel;
  /** How the model was reached, for logs and /status. Never a key. */
  via: "custom-endpoint" | "direct" | "gateway";
  providerName: string;
  modelId: string;
}

/** Splits `creator/model` once, so a model id containing further slashes survives. */
function split(spec: string): { providerName: string; modelId: string } {
  const at = spec.indexOf("/");
  return at === -1 ? { providerName: "", modelId: spec } : { providerName: spec.slice(0, at), modelId: spec.slice(at + 1) };
}

function chosen(override: string | undefined, env: NodeJS.ProcessEnv): string {
  return override?.trim() || env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

/** `override` names a model for one job ahead of AI_MODEL; the credential route is chosen the same way. */
export function resolveModel(override?: string, env: NodeJS.ProcessEnv = process.env): ResolvedModel | null {
  const spec = chosen(override, env);
  const { providerName, modelId } = split(spec);

  const baseURL = env.AI_BASE_URL?.trim();
  const customKey = env.AI_API_KEY?.trim();
  if (baseURL && customKey) {
    // OpenAI-shaped endpoints expect their own model naming, so the id is passed whole.
    return {
      model: createOpenAI({ apiKey: customKey, baseURL })(spec),
      via: "custom-endpoint",
      providerName: providerName || "custom",
      modelId: spec,
    };
  }

  const direct = DIRECT[providerName];
  const directKey = direct ? env[direct.keyEnv]?.trim() : undefined;
  if (direct && directKey) {
    return { model: direct.create(directKey)(modelId), via: "direct", providerName, modelId };
  }

  if (env.AI_GATEWAY_API_KEY?.trim()) {
    // A bare `creator/model` string is a LanguageModel: the SDK routes it through the Gateway.
    return { model: spec, via: "gateway", providerName, modelId };
  }

  const groqKey = env.GROQ_API_KEY?.trim();
  if (groqKey && spec !== GROQ_FALLBACK_MODEL) {
    const fallback = split(GROQ_FALLBACK_MODEL);
    return { model: DIRECT.groq!.create(groqKey)(fallback.modelId), via: "direct", ...fallback };
  }

  return null;
}

/** What is missing, precisely enough to fix without reading the code. */
export function missingCredentialHint(override?: string, env: NodeJS.ProcessEnv = process.env): string {
  const spec = chosen(override, env);
  const direct = DIRECT[split(spec).providerName];
  return direct
    ? `${direct.keyEnv} (for ${spec}), or AI_GATEWAY_API_KEY`
    : `AI_GATEWAY_API_KEY (for ${spec}), or AI_BASE_URL + AI_API_KEY`;
}
