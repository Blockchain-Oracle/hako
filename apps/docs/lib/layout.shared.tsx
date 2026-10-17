import { HakoLockup } from "@hako/brand/react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { docsRoute } from "@/lib/shared";
import { site } from "@/lib/site";

/** The Hako lockup (mark and name in the display face, as apps/web's Logo), then "Docs" in the body face. */
function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-fd-foreground">
      <HakoLockup className="text-lg" />
      <span className="text-sm font-normal text-fd-muted-foreground">Docs</span>
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Logo />, url: docsRoute },
    links: [
      { text: "Agent chat", url: `${site.app}/agent`, external: true },
      { text: "Tools", url: `${site.app}/tools`, external: true },
      { text: "Open the app", url: site.app, external: true },
    ],
  };
}
