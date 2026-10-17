import { Seal } from "@hako/brand/react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { docsRoute } from "@/lib/shared";
import { site } from "@/lib/site";

/** "Hako" in Outfit with the 証 seal (as apps/web's Logo), then "Docs" in the body face. */
function Logo() {
  return (
    <span className="inline-flex items-center gap-1.5 font-display text-lg font-semibold tracking-[-0.03em] text-fd-foreground">
      <span>Hako</span>
      <Seal className="size-[1.15em] text-fd-primary" label={null} />
      <span className="ml-1 font-sans text-sm font-normal tracking-normal text-fd-muted-foreground">Docs</span>
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
