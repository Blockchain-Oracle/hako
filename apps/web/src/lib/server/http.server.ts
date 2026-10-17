import "server-only";

/** JSON responses the chat routes share: every error is `{ error: { code, message, ...extra } }`. */
export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const NO_STORE = { "cache-control": "no-store" } as const;

/** `setCookie` is the lazily minted guest session, attached to whichever response answers first. */
export function json(body: unknown, status: number = HTTP.OK, setCookie?: string): Response {
  const headers = new Headers(NO_STORE);
  if (setCookie) headers.set("set-cookie", setCookie);
  return Response.json(body, { status, headers });
}

export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, setCookie?: string): Response {
  return json({ error: { code, message, ...extra } }, status, setCookie);
}

export function empty(status: number, setCookie?: string): Response {
  const headers = new Headers(NO_STORE);
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status, headers });
}

/** The request body as JSON, or null when it is empty or not JSON (the route decides what that means). */
export async function readJson(req: Request): Promise<unknown | null> {
  const text = await req.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
