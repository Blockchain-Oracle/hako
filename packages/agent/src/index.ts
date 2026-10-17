// @hako/agent (server-only, plan §5b): the one tool registry served by /agent, voice, the hosted MCP server and
// `hako mcp`. Next code imports this root; the gateway and the CLI import `@hako/agent/node` (same exports, no guard).
import "server-only";

export * from "./node.ts";
