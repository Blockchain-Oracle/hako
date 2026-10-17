import { MARK_SVG } from "@hako/brand";

/** The browser-tab icon: the Hako mark from @hako/brand (ink on light tab bars, paper on dark ones), never a copy. */
export const contentType = "image/svg+xml";

export default function Icon() {
  return new Response(MARK_SVG["favicon.svg"], { headers: { "Content-Type": contentType } });
}
