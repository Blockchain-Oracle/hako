import type { Metadata } from "next";

import { NotFoundPanel } from "@/components/NotFoundPanel";

export const metadata: Metadata = { title: "Page not found" };

/** A missing /docs/* page: rendered inside the docs layout, so the sidebar and search stay in reach. */
export default function DocsNotFound() {
  return <NotFoundPanel />;
}
