"use client";

import { HAKO_GATEWAY_URL } from "@hako/config";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { FallbackDisc } from "./fallback-disc.tsx";
import { logoProxyUrl } from "./logo-proxy.ts";

const GatewayContext = createContext<string>(HAKO_GATEWAY_URL);

/** Points every remote logo at this deployment's gateway (apps pass their public gateway URL; default: production). */
export function LogoProxyProvider({ gatewayUrl, children }: { gatewayUrl: string; children: ReactNode }) {
  return <GatewayContext.Provider value={gatewayUrl}>{children}</GatewayContext.Provider>;
}

/**
 * The remote logo inside the mark's box, cropped like a token (a disc). When it fails to load (the proxy refuses the
 * host, the image is gone) the labelled neutral disc takes its place, so a broken image never shows. A plain <img>:
 * the proxy already serves a cached, size-bounded image, and the cards render outside Next too (the MCP view).
 */
export function LogoImage({ src, label, size }: { src: string; label: string; size: number }) {
  const gatewayUrl = useContext(GatewayContext);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered image can fail before React hydrates and attaches onError: check once after mount.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return <FallbackDisc label={label} size={size} />;
  return (
    <img
      ref={ref}
      src={logoProxyUrl(src, gatewayUrl)}
      alt=""
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(true)}
      className="block rounded-full bg-muted object-cover"
      style={{ width: size, height: size }}
    />
  );
}
