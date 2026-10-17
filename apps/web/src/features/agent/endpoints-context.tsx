"use client";

import { createContext, type ReactNode, useContext } from "react";

import type { Price } from "@/lib/catalog/types";

/** The catalog facts the chat needs to draw pay cards and run rows without asking the server. */
export interface EndpointMeta {
  id: string;
  displayName: string;
  provider: string;
  providerName: string;
  path: string;
  price: Price;
  render: string;
}

const Context = createContext<Record<string, EndpointMeta>>({});

export function EndpointsProvider({ endpoints, children }: { endpoints: Record<string, EndpointMeta>; children: ReactNode }) {
  return <Context.Provider value={endpoints}>{children}</Context.Provider>;
}

export const useEndpoint = (id: string | undefined): EndpointMeta | undefined => useContext(Context)[id ?? ""];
