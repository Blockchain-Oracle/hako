import { z } from "zod";

/**
 * Catalog render kinds for reading the web (hako_tools.categories.Render): search_results, answer, page, papers, news,
 * jobs, definition. Each schema is the `data` the Python connectors return today (their pydantic output models,
 * dumped with exclude_none, so an absent field means "not known", never null). Objects are loose: a connector may add
 * fields beyond these, and every field a card relies on is typed here. L2's gate validates sample outputs against the
 * JSON Schemas generated from these (packages/cards/schemas/<kind>.json).
 */

const text = z.string();
const count = z.number().int().min(0);

/** A link row (hako_tools Link): every search result is one. */
export const linkSchema = z.looseObject({
  title: text,
  url: text,
  snippet: text.optional(),
  source: text.optional(),
  published: text.optional(),
  position: z.number().int().optional(),
});

const searchResultSchema = linkSchema.extend({
  /** Extracted page text (Firecrawl / Jina search with content). */
  content: text.optional(),
  /** Matching passages (developer search). */
  passages: z.array(text).optional(),
  kind: text.optional(),
  id: text.optional(),
  /** Repository and story hits. */
  stars: count.optional(),
  forks: count.optional(),
  language: text.optional(),
  pushed_at: text.optional(),
  archived: z.boolean().optional(),
  author: text.optional(),
  points: z.number().int().optional(),
  num_comments: count.optional(),
  hn_url: text.optional(),
  story_title: text.optional(),
  /** Image search. */
  image_url: text.optional(),
  thumbnail_url: text.optional(),
  width: count.optional(),
  height: count.optional(),
});

const searchExtras = {
  answer_box: z.looseObject({ answer: text.optional(), snippet: text.optional(), title: text.optional(), url: text.optional() }).optional(),
  knowledge_panel: z
    .looseObject({
      title: text,
      type: text.optional(),
      description: text.optional(),
      website: text.optional(),
      source_url: text.optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  people_also_ask: z.array(z.looseObject({ question: text, snippet: text.optional(), url: text.optional() })).optional(),
  related_searches: z.array(text).optional(),
  total: count.optional(),
  total_count: count.optional(),
};

/** Search: `results[]` for a query, or a site map's `links[]` (firecrawl/map). */
export const searchResultsDataSchema = z.union([
  z.looseObject({ query: text, results: z.array(searchResultSchema), ...searchExtras }),
  z.looseObject({ site: text, links: z.array(linkSchema) }),
]);

export const citationSchema = z.looseObject({ index: z.number().int(), title: text, url: text });

/** A written answer with its citations (hako/answer, groq/summarize, firecrawl/ask-page). */
export const answerDataSchema = z.looseObject({
  answer: text,
  question: text.optional(),
  url: text.optional(),
  key_points: z.array(text).optional(),
  citations: z.array(citationSchema).optional(),
  sources_read: count.optional(),
  source_chars: count.optional(),
});

/** One page as Markdown (firecrawl/scrape, jina/read, wikipedia/summary). */
export const pageDataSchema = z.looseObject({
  url: text,
  markdown: text,
  title: text.optional(),
  description: text.optional(),
  language: text.optional(),
  lang: text.optional(),
  published: text.optional(),
  last_edited: text.optional(),
  status_code: z.number().int().optional(),
  thumbnail: text.optional(),
  wikidata_id: text.optional(),
  page_type: text.optional(),
});

export const paperSchema = z.looseObject({
  title: text,
  url: text.optional(),
  id: text.optional(),
  paper_id: text.optional(),
  primary_id: text.optional(),
  scholar_id: text.optional(),
  doi: text.optional(),
  authors: text.optional(),
  abstract: text.optional(),
  snippet: text.optional(),
  published: text.optional(),
  created: text.optional(),
  updated: text.optional(),
  year: z.number().int().optional(),
  venue: text.optional(),
  journal_ref: text.optional(),
  publication_info: text.optional(),
  publisher: text.optional(),
  primary_category: text.optional(),
  categories: z.union([z.array(text), text]).optional(),
  type: text.optional(),
  cited_by: count.optional(),
  references: count.optional(),
  pdf_url: text.optional(),
  open_access_url: text.optional(),
  topic: text.optional(),
  score: z.number().optional(),
  license: text.optional(),
  retracted: z.boolean().optional(),
  is_retracted: z.boolean().optional(),
});

/** Papers: a list (`papers[]`), or one paper with matching passages (firecrawl/read-paper). */
export const papersDataSchema = z.union([
  z.looseObject({
    papers: z.array(paperSchema),
    query: text.optional(),
    total: count.optional(),
    mode: text.optional(),
    paper_id: text.optional(),
  }),
  z.looseObject({
    paper: paperSchema,
    passages: z.array(z.looseObject({ text, score: z.number().optional() })).optional(),
  }),
]);

export const articleSchema = z.looseObject({
  title: text,
  url: text,
  publisher: text.optional(),
  publisher_url: text.optional(),
  published: text.optional(),
  snippet: text.optional(),
  source: text.optional(),
  domain: text.optional(),
  seen_at: text.optional(),
  points: z.number().int().optional(),
  also_in: z.array(text).optional(),
  image_url: text.optional(),
  kind: text.optional(),
  position: z.number().int().optional(),
});

export const newsDataSchema = z.looseObject({
  articles: z.array(articleSchema),
  query: text.optional(),
  topic: text.optional(),
  edition: text.optional(),
  unavailable: z.array(text).optional(),
});

export const jobSchema = z.looseObject({
  title: text,
  company: text,
  url: text,
  location: text.optional(),
  department: text.optional(),
  remote: z.boolean().optional(),
  salary: text.optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
  currency: text.optional(),
  posted_at: text.optional(),
  ats: text.optional(),
});

export const jobsDataSchema = z.looseObject({
  jobs: z.array(jobSchema),
  query: text.optional(),
  unavailable: z.array(text).optional(),
});

/** A dictionary entry (dictionary/define). */
export const definitionDataSchema = z.looseObject({
  word: text,
  meanings: z.array(
    z.looseObject({
      part_of_speech: text,
      definitions: z.array(z.looseObject({ definition: text, example: text.optional() })),
      synonyms: z.array(text).optional(),
      antonyms: z.array(text).optional(),
    }),
  ),
  phonetic: text.optional(),
  audio: text.optional(),
  origin: text.optional(),
  source_url: text.optional(),
});
