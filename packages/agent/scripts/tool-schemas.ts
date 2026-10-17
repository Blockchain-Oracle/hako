/**
 * `pnpm --filter @hako/agent tool-schemas` (and the package's `typecheck`, so the gate runs it): exports every
 * registry tool's input (io input) and output (io output) to JSON Schema and fails when a root is not a plain object.
 * The MCP spec wants `type: "object"` at the root of `inputSchema` and `outputSchema`; Anthropic's `input_schema` and
 * OpenAI's function `parameters` (the AI SDK in /agent and voice) refuse any other root and a root `oneOf`/`anyOf`/
 * `allOf`. A tool that answers with several kinds uses `structuredContentUnion`, an object at the root.
 */
import { z } from "zod";

import { listTools } from "../src/registry.ts";

const ROOT_COMBINATORS = ["oneOf", "anyOf", "allOf"] as const;

function rootProblems(schema: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (schema.type !== "object") problems.push(`root type is ${JSON.stringify(schema.type ?? null)}, not "object"`);
  for (const key of ROOT_COMBINATORS) if (key in schema) problems.push(`root has ${key}`);
  return problems;
}

const failures: string[] = [];
const tools = listTools();
for (const tool of tools) {
  const sides = {
    input: z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }),
    output: z.toJSONSchema(tool.output, { io: "output", unrepresentable: "any" }),
  };
  for (const [side, schema] of Object.entries(sides)) {
    for (const problem of rootProblems(schema as Record<string, unknown>)) failures.push(`${tool.name} ${side}: ${problem}`);
  }
}

if (failures.length > 0) {
  console.error(`Tool schemas a model host would refuse:\n${failures.map((line) => `  ${line}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`checked ${tools.length} tools: every input and output schema is an object at the root`);
}
