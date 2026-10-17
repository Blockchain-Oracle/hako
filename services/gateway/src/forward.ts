/** Forwarding: every read and every run goes straight to hako-api at HAKO_API_URL. */

import type { GatewayConfig } from "./config.js";
import { READ_FORWARD_TIMEOUT_MS, RUN_FORWARD_TIMEOUT_MS } from "./constants.js";

export interface Forwarded {
  status: number;
  body: string;
  contentType: string;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

async function read(res: Response): Promise<Forwarded> {
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type") ?? "application/json",
  };
}

export async function forwardRun(config: GatewayConfig, path: string, body: string): Promise<Forwarded> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body,
    signal: AbortSignal.timeout(RUN_FORWARD_TIMEOUT_MS),
  });
  return read(res);
}

export async function forwardRead(config: GatewayConfig, method: "GET" | "POST", path: string,
                                  body?: string): Promise<Forwarded> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: method === "POST" ? JSON_HEADERS : { accept: "application/json" },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(READ_FORWARD_TIMEOUT_MS),
  });
  return read(res);
}
