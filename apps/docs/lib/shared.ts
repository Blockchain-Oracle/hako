import { createGetUrl } from "fumadocs-core/source";

export const appName = "Hako";
export const docsRoute = "/docs";
export const docsContentRoute = "/llms.mdx/docs";

const getContentUrl = createGetUrl(docsContentRoute);

/** Where a page's Markdown is served, for "Copy Markdown" and the AI "open in" actions. */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];
  return { segments, url: getContentUrl(segments, page.locale) };
}
