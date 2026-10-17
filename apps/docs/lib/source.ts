import { llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";

import { remarkSiteUrls } from "@/lib/remark-site-urls";
import { docsRoute } from "@/lib/shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
    mdxOptions: applyMdxPreset({ remarkPlugins: [remarkSiteUrls] }),
  },
  meta: { schema: metaSchema },
});

export const source = loader(docs.toFumadocsSource(), { baseUrl: docsRoute, plugins: [lucideIconsPlugin()] });

/** llms.txt, llms-full.txt and per-page Markdown for "Copy Markdown". */
export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})\n\n${await page.data.getText("processed")}`,
});
