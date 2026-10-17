/**
 * PayBox core tools over MCP with the user's bearer (plan §3 PayBox row; SP13 in detail/12-wave0-results.md: the
 * `@ai-sdk/mcp` HTTP transport loads all 30 PayBox tools). The bearer is read for every HTTP request through a custom
 * `fetch`, so a long session never sends an expired token; a session nobody holds is closed after
 * PAYBOX_SESSION_IDLE_MS (it holds an inbound SSE stream). Work that keeps the client (AI SDK `client.tools()` for a
 * whole agent run, MCP Apps resource reads) holds a lease, so the session can't close under it.
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

/** The connected client, held open until `release()` (idempotent); the idle close waits for every lease. */
export interface PayboxMcpLease {
  client: MCPClient;
  release(): void;
}

export interface PayboxMcpSession {
  /** Calls one PayBox tool and returns its payload (`structuredContent`, else the first text block's JSON). */
  call(tool: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<unknown>;
  /** The raw MCP result (for `use_plugin`, whose result is the plugin's own tool result). */
  callRaw(tool: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<CallToolResult>;
  /**
   * The connected client for work that keeps it (AI SDK tool sets from `client.tools()`, MCP Apps resource reads):
   * the session stays open until the lease is released. Prefer `withClient` when the work fits in one callback.
   */
  acquire(): Promise<PayboxMcpLease>;
  /** Runs `work` with the connected client and releases it when `work` settles (an agent run, a resource read). */
  withClient<T>(work: (client: MCPClient) => Promise<T>): Promise<T>;
  /** Closes the session now, leases or not (the next call reconnects). */
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

  /** Starts the idle countdown; it closes the session only if nobody took a lease meanwhile. */
  function armIdleClose(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (active === 0) void close();
    }, settings.idleMs ?? PAYBOX_SESSION_IDLE_MS);
    idleTimer.unref?.();
  }

  async function acquire(): Promise<PayboxMcpLease> {
    clearTimeout(idleTimer);
    active += 1;
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      active -= 1;
      if (active === 0) armIdleClose();
    };
    try {
      return { client: await open(), release };
    } catch (error) {
      release();
      throw error;
    }
  }

  async function withClient<T>(work: (client: MCPClient) => Promise<T>): Promise<T> {
    const lease = await acquire();
    try {
      return await work(lease.client);
    } finally {
      lease.release();
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
    acquire,
    withClient,
    close,
  };
}
