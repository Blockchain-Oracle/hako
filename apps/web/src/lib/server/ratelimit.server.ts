import "server-only";

/** The visitor's IP as the proxy reports it (Coolify's Traefik sets x-forwarded-for), for per-visitor budgets. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
