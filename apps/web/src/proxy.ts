import { HAKO_APP_PATHS, HAKO_SANDBOX_SUBDOMAIN } from "@hako/config";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Host rewrite (plan §9): the signing sandbox origin (sandbox.usehako.xyz, SP4) serves only `app/sandbox/**`, so
 * PayBox's signing window runs in an origin that is not the app's. Every other host passes through untouched.
 */
const SANDBOX_PATH = HAKO_APP_PATHS.sandbox;

/** The request's hostname without its port (Coolify's Traefik passes the Host header through unchanged). */
function hostnameOf(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function proxy(request: NextRequest) {
  if (hostnameOf(request).split(".")[0] !== HAKO_SANDBOX_SUBDOMAIN) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === SANDBOX_PATH || pathname.startsWith(`${SANDBOX_PATH}/`)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? SANDBOX_PATH : `${SANDBOX_PATH}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Next's own assets and the favicon (`app/icon.ts`, served at `/icon?<hash>`) keep their paths on every host (the
  // sandbox page loads them too).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon).*)"],
};
