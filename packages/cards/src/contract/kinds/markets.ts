import { z } from "zod";

import { PROBABILITY_MAX } from "../contract.config.ts";
import { atomicSchema, caip2Schema } from "../primitives.ts";
import { articleSchema } from "./reading.ts";

/**
 * New catalog render kinds from L2's connectors (plan C16, C18): market (Polymarket Gamma, Jupiter Prediction; trading
 * hands off to PayBox's World plugin), audio (ElevenLabs), yield and positions (LI.FI Earn), model_bench (Artificial
 * Analysis). Connector output: snake_case, loose objects, chains as CAIP-2, token amounts in atomic units.
 */

const text = z.string();

/** A token as a connector names it (snake_case twin of the cards' camelCase TokenRef). */
export const connectorTokenSchema = z.looseObject({
  symbol: text,
  address: text,
  decimals: z.number().int().min(0),
  name: text.optional(),
  logo_url: text.optional(),
});

export const marketOutcomeSchema = z.looseObject({
  name: text,
  /** The market's implied probability, 0–1 (the odds bar). */
  probability: z.number().min(0).max(PROBABILITY_MAX),
  price_usd: z.number().optional(),
});

export const predictionMarketSchema = z.looseObject({
  id: text,
  /** Labelled on the card: "polymarket" or "jupiter". */
  provider: text,
  title: text,
  outcomes: z.array(marketOutcomeSchema).min(1),
  status: z.enum(["open", "closed", "resolved"]),
  url: text.optional(),
  end_date: text.optional(),
  volume_usd: z.number().optional(),
  liquidity_usd: z.number().optional(),
  category: text.optional(),
  image_url: text.optional(),
  resolved_outcome: text.optional(),
  /** What "Trade on World" searches with PayBox's World plugin (`world_search`), only where the market is mapped. */
  world_query: text.optional(),
});

/** Odds for a question, with the news around it (hako_markets, `/v1/markets`). */
export const marketDataSchema = z.looseObject({
  markets: z.array(predictionMarketSchema),
  query: text.optional(),
  news: z.array(articleSchema).optional(),
});

/** Generated audio (ElevenLabs TTS, sound effects, music): bytes stored by hako-api, served at `/v1/files/<id>` for 24 h. */
export const audioDataSchema = z.looseObject({
  file_id: text,
  /** The gateway's `/v1/files/<file_id>` URL. */
  url: text,
  mime_type: text,
  kind: z.enum(["speech", "sound_effect", "music"]),
  expires_at: text,
  duration_s: z.number().optional(),
  /** The spoken text or the prompt the sound was made from. */
  text: text.optional(),
  voice: text.optional(),
  model: text.optional(),
  bytes: z.number().int().min(0).optional(),
});

export const vaultSchema = z.looseObject({
  address: text,
  chain: caip2Schema,
  name: text,
  protocol: text,
  token: connectorTokenSchema,
  /** Annual percentage yield, in percent (4.2 = 4.2 %). */
  apy: z.number(),
  apy_base: z.number().optional(),
  apy_reward: z.number().optional(),
  tvl_usd: z.number().optional(),
  url: text.optional(),
  logo_url: text.optional(),
  tags: z.array(text).optional(),
});

/** Where USDC (or any token) earns most (LI.FI Earn vaults, J3). */
export const yieldDataSchema = z.looseObject({
  vaults: z.array(vaultSchema),
  chain: caip2Schema.optional(),
  token: text.optional(),
});

export const earnPositionSchema = z.looseObject({
  chain: caip2Schema,
  vault: z.looseObject({ address: text, name: text, protocol: text.optional() }),
  token: connectorTokenSchema,
  amount_atomic: atomicSchema,
  shares_atomic: atomicSchema.optional(),
  usd: z.number().optional(),
  apy: z.number().optional(),
});

/** A wallet's Earn positions (LI.FI Earn positions, J3's position card and "Withdraw"). */
export const positionsDataSchema = z.looseObject({
  address: text,
  positions: z.array(earnPositionSchema),
});

export const benchModelSchema = z.looseObject({
  id: text,
  name: text,
  creator: text.optional(),
  rank: z.number().int().min(1).optional(),
  intelligence_index: z.number().optional(),
  output_tokens_per_s: z.number().optional(),
  first_token_s: z.number().optional(),
  price_input_per_m_usd: z.number().optional(),
  price_output_per_m_usd: z.number().optional(),
  /** Media leaderboards (text to image, speech…) rank by arena ELO. */
  elo: z.number().optional(),
  url: text.optional(),
});

/** Model benchmarks (Artificial Analysis: LLM and media leaderboards). */
export const modelBenchDataSchema = z.looseObject({
  /** "llm", "text_to_image", "text_to_speech", "text_to_video"… */
  category: text,
  models: z.array(benchModelSchema),
  metric: text.optional(),
});
