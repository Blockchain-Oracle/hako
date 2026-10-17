/**
 * PayBox core tools over MCP with the user's bearer (plan §3 PayBox row; SP13 in detail/12-wave0-results.md: the
 * `@ai-sdk/mcp` HTTP transport loads all 30 PayBox tools). The bearer is read for every HTTP request through a custom
 * `fetch`, so a long session never sends an expired token; an idle session is closed (it holds an inbound SSE stream).
 */
import { PAYBOX_MCP_URL } from "@hako/config";
import { createMCPClient, type CallToolResult, type MCPClient } from "@ai-sdk/mcp";

import type { Fetch } from "./oauth.ts";
import {
  PAYBOX_MCP_CLIENT_NAME,
  PAYBOX_MCP_CLIENT_VERSION,
  PAYBOX_SESSION_IDLE_MS,
  PAYBOX_SIGNING_SURFACE_HEADER,
  PAYBOX_TOOL_TIMEOUT_MS,
} from "./paybox.config.ts";

/** How this host can sign (SDK 2.2.0 `X-Paybox-Signing-Surface`); unset keeps PayBox's MCP Apps behaviour. */
export type SigningSurface = "in-process" | "browser" | "none";

/** A PayBox tool answered with `isError` (its text explains why). */
export class PayboxToolError extends Error {
  readonly tool: string;
  /** The parsed payload when PayBox sent JSON (it may still carry a request id). */
  readonly payload: unknown;
  constructor(tool: string, message: string, payload: unknown) {
    super(`PayBox ${tool} failed: ${message}`);
    this.name = "PayboxToolError";
    this.tool = tool;
    this.payload = payload;
  }
}

export interface ToolCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PayboxMcpSession {
  /** Calls one PayBox tool and returns its payload (`structuredContent`, else the first text block's JSON). */
  call(tool: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<unknown>;
  /** The raw MCP result (for `use_plugin`, whose result is the plugin's own tool result). */
  callRaw(tool: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<CallToolResult>;
  /** The connected client, for AI SDK tool sets (`client.tools()`) and MCP Apps resources. */
  client(): Promise<MCPClient>;
  close(): Promise<void>;
}

export interface McpSessionSettings {
  /** The user's current access token (the token store refreshes it when needed). */
  accessToken: () => Promise<string>;
  signingSurface?: SigningSurface;
  fetch?: Fetch;
  idleMs?: number;
}

/** The text blocks of a tool result's `content`. */
function textBlocks(result: CallToolResult): string[] {
  const content: unknown = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item: unknown) => {
    const block = item as { type?: unknown; text?: unknown };
    return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
  });
}

/** A tool result's payload: `structuredContent`, else the first text block parsed as JSON (or the text itself). */
export function toolPayload(result: CallToolResult): unknown {
  if ("structuredContent" in result && result.structuredContent !== undefined) return result.structuredContent;
  const text = textBlocks(result)[0];
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const errorText = (result: CallToolResult): string => textBlocks(result).join("\n") || "no details";

export function createPayboxMcpSession(settings: McpSessionSettings): PayboxMcpSession {
  const baseFetch = settings.fetch ?? fetch;
  const authorizedFetch: Fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await settings.accessToken()}`);
    if (settings.signingSurface) headers.set(PAYBOX_SIGNING_SURFACE_HEADER, settings.signingSurface);
    return baseFetch(input, { ...init, headers });
  };

  let connecting: Promise<MCPClient> | null = null;
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function open(): Promise<MCPClient> {
    connecting ??= createMCPClient({
      transport: { type: "http", url: PAYBOX_MCP_URL, fetch: authorizedFetch, redirect: "error" },
      clientName: PAYBOX_MCP_CLIENT_NAME,
      version: PAYBOX_MCP_CLIENT_VERSION,
    }).catch((error: unknown) => {
      connecting = null;
      throw error;
    });
    return connecting;
  }

  async function close(): Promise<void> {
    clearTimeout(idleTimer);
    const pending = connecting;
    connecting = null;
    if (pending) await (await pending.catch(() => null))?.close();
  }

  async function withClient<T>(work: (client: MCPClient) => Promise<T>): Promise<T> {
    clearTimeout(idleTimer);
    active += 1;
    try {
      return await work(await open());
    } finally {
      active -= 1;
      if (active === 0) {
        idleTimer = setTimeout(() => void close(), settings.idleMs ?? PAYBOX_SESSION_IDLE_MS);
        idleTimer.unref?.();
      }
    }
  }

  async function callRaw(tool: string, args: Record<string, unknown>, options: ToolCallOptions = {}): Promise<CallToolResult> {
    return withClient((client) =>
      client.callTool({ name: tool, arguments: args, options: { signal: options.signal, timeout: options.timeoutMs ?? PAYBOX_TOOL_TIMEOUT_MS } }),
    );
  }

  return {
    callRaw,
    async call(tool, args, options) {
      const result = await callRaw(tool, args, options);
      const payload = toolPayload(result);
      if (result.isError) throw new PayboxToolError(tool, errorText(result), payload);
      return payload;
    },
    client: () => withClient(async (client) => client),
    close,
  };
}
