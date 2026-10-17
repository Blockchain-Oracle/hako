import type { Metadata } from "next";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { NotFoundPanel } from "@/components/NotFoundPanel";
import { baseOptions } from "@/lib/layout.shared";

export const metadata: Metadata = { title: "Page not found" };

/** Any other missing path on the docs host: the docs header, then the same panel. */
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <NotFoundPanel />
    </HomeLayout>
  );
}
