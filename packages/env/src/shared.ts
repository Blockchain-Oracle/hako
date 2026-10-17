import { z } from "zod";

/** Where variables come from: `process.env` by default, a plain object in tests or scripts. */
export type EnvSource = Record<string, string | undefined>;

/** `KEY=` (or only spaces) in a .env file means "not set", never an empty secret. Values are trimmed. */
export const blankIsUnset = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const optionalText = z.preprocess(blankIsUnset, z.string().min(1).optional());
export const optionalUrl = z.preprocess(blankIsUnset, z.url().optional());
export const requiredUrl = z.preprocess(blankIsUnset, z.url());
export const urlOr = (fallback: string) => z.preprocess(blankIsUnset, z.url().default(fallback));

/** A secret of at least `min` characters (session and auth secrets). */
export const optionalSecret = (min: number) => z.preprocess(blankIsUnset, z.string().min(min).optional());

/** A 32-byte key written as 64 hex characters (HAKO_TOKEN_ENCRYPTION_KEY: AES-256-GCM over stored PayBox tokens). */
const HEX_KEY_32 = /^[0-9a-fA-F]{64}$/;
export const optionalHexKey32 = z.preprocess(blankIsUnset, z.string().regex(HEX_KEY_32, "expected 64 hex characters").optional());

/** A PEM or key pasted into one env line keeps its newlines as `\n`. */
export const optionalPem = z.preprocess(
  blankIsUnset,
  z
    .string()
    .min(1)
    .transform((value) => value.replace(/\\n/g, "\n"))
    .optional(),
);

const MAX_PORT = 65_535;
export const portOr = (fallback: number) => z.preprocess(blankIsUnset, z.coerce.number().int().min(1).max(MAX_PORT).default(fallback));

export const nodeEnv = z.preprocess(blankIsUnset, z.enum(["development", "test", "production"]).default("development"));

/** Parse once; a missing or malformed value stops the consumer with the variable names, never their values. */
export function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource, consumer: string): z.output<S> {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid environment for ${consumer}:\n${lines.join("\n")}`);
}

/**
 * A lazy, cached loader: nothing is read at import (so `next build` and type generation need no runtime secrets);
 * the first call parses `process.env` and later calls reuse it. Passing a source parses that source, uncached.
 */
export function envLoader<S extends z.ZodType>(schema: S, consumer: string): (source?: EnvSource) => z.output<S> {
  let cached: z.output<S> | undefined;
  return (source) => {
    if (source) return parseEnv(schema, source, consumer);
    cached ??= parseEnv(schema, process.env, consumer);
    return cached;
  };
}
