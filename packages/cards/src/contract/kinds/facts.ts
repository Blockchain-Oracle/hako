import { z } from "zod";

/**
 * Catalog render kinds for facts and figures (hako_tools.categories.Render): quote, fx, weather, place, package, time,
 * table, json. Same rules as reading.ts: the connectors' `data` as they return it today, loose objects, absent = unknown.
 */

const text = z.string();
const count = z.number().int().min(0);
const tags = z.array(text);

/** A market quote (coingecko/price, top, trending). `market_cap` is a number, or a display string on trending rows. */
export const marketQuoteSchema = z.looseObject({
  symbol: text,
  name: text,
  id: text.optional(),
  price: z.number().optional(),
  currency: text.optional(),
  change: z.number().optional(),
  change_pct: z.number().optional(),
  change_7d_pct: z.number().optional(),
  market_cap: z.union([z.number(), text]).optional(),
  market_cap_rank: z.number().int().optional(),
  volume: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  open: z.number().optional(),
  prev_close: z.number().optional(),
  ath: z.number().optional(),
  ath_change_pct: z.number().optional(),
  exchange: text.optional(),
  market_state: text.optional(),
  image_url: text.optional(),
  url: text.optional(),
});

export const quoteDataSchema = z.looseObject({
  quotes: z.array(marketQuoteSchema),
  category: text.optional(),
  missing: tags.optional(),
});

const providerRateSchema = z.looseObject({
  provider: text,
  rate: z.number(),
  name: text.optional(),
  date: text.optional(),
  rate_type: text.optional(),
  issuer: z.boolean().optional(),
  cadence: text.optional(),
  business_days_old: z.number().int().optional(),
});

export const fxRateSchema = z.looseObject({
  quote: text,
  rate: z.number(),
  date: text,
  base: text.optional(),
  amount: z.number().optional(),
  converted: z.number().optional(),
  providers: z.array(providerRateSchema).optional(),
});

/** Exchange rates: one conversion (frankfurter/convert) or a list of `rates[]` from one base. */
export const fxDataSchema = z.looseObject({
  base: text,
  provider: text.optional(),
  rates: z.array(fxRateSchema).optional(),
  quote: text.optional(),
  rate: z.number().optional(),
  amount: z.number().optional(),
  converted: z.number().optional(),
  date: text.optional(),
  unavailable: tags.optional(),
});

const coordinates = { lat: z.number(), lon: z.number() };

export const weatherLocationSchema = z.looseObject({
  ...coordinates,
  name: text.optional(),
  state: text.optional(),
  country: text.optional(),
  timezone: text.optional(),
});

const weatherUnitsSchema = z.looseObject({ temperature: text, wind_speed: text, precipitation: text.optional() });

/** Weather: a provider forecast with `location` + `units` (Open-Meteo, OpenWeather), or Hako's multi-source reading. */
export const weatherDataSchema = z.union([
  z.looseObject({
    location: weatherLocationSchema,
    units: weatherUnitsSchema,
    current: z.looseObject({ description: text.optional(), temp: z.number().optional() }).optional(),
    days: z.array(z.looseObject({ date: text, temp_min: z.number().optional(), temp_max: z.number().optional() })).optional(),
    next_24h: z.array(z.looseObject({ time: text, temp: z.number().optional() })).optional(),
    dataset: text.optional(),
  }),
  z.looseObject({
    ...coordinates,
    valid_for: text,
    readings: z.array(z.looseObject({ source: text, valid_for: text, temperature_c: z.number().optional() })),
    place: text.optional(),
    temperature_c: z.number().optional(),
    conditions: text.optional(),
    alerts: tags.optional(),
  }),
]);

export const placeSchema = z.looseObject({
  name: text.optional(),
  address: text.optional(),
  category: text.optional(),
  type: text.optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  locality: text.optional(),
  state: text.optional(),
  postcode: text.optional(),
  country: text.optional(),
  country_code: text.optional(),
  rating: z.number().optional(),
  rating_count: count.optional(),
  price_level: text.optional(),
  phone: text.optional(),
  website: text.optional(),
  maps_url: text.optional(),
  osm_url: text.optional(),
  position: z.number().int().optional(),
});

/** Places: a search's `places[]`, or one reverse-geocoded place (openstreetmap/reverse). */
export const placeDataSchema = z.union([
  z.looseObject({ places: z.array(placeSchema), query: text, location: text.optional() }),
  placeSchema.extend(coordinates),
]);

const packageFields = {
  url: text.optional(),
  description: text.optional(),
  summary: text.optional(),
  version: text.optional(),
  license: text.optional(),
  licenses: tags.optional(),
  homepage: text.optional(),
  repository: text.optional(),
  language: text.optional(),
  topics: tags.optional(),
  stars: count.optional(),
  forks: count.optional(),
  open_issues: count.optional(),
  weekly_downloads: count.optional(),
  published_at: text.optional(),
  latest_published_at: text.optional(),
  recent_versions: z.array(z.looseObject({ version: text, published_at: text.optional(), deprecated: z.boolean().optional() })).optional(),
  links: z.array(z.looseObject({ label: text, url: text })).optional(),
  advisory_keys: tags.optional(),
};

/** A package (npm, PyPI, deps.dev) or a repository or release (GitHub). */
export const packageDataSchema = z.union([
  z.looseObject({ name: text, ...packageFields }),
  z.looseObject({ full_name: text, ...packageFields }),
  z.looseObject({ repo: text, tag: text, ...packageFields }),
]);

const provenanceSchema = z.looseObject({ sources: tags.optional() });

/** Time: a zone's clock (hako/time), a business-day count, or a year's holidays. */
export const timeDataSchema = z.union([
  z.looseObject({
    zone: text,
    local_time: text,
    utc_offset: text,
    at_utc: text.optional(),
    abbreviation: text.optional(),
    is_dst: z.boolean().optional(),
    conversions: z.array(z.looseObject({ zone: text, local_time: text, utc_offset: text })).optional(),
    provenance: provenanceSchema.optional(),
  }),
  z.looseObject({
    calendar: text,
    start: text,
    end: text,
    business_days: count,
    weekend: tags.optional(),
    holidays_skipped: tags.optional(),
  }),
  z.looseObject({
    country: text,
    year: z.number().int(),
    holidays: z.array(z.looseObject({ date: text, name: text, other_names: tags.optional(), observed: z.boolean().optional() })),
    calendar: text.optional(),
    count: count.optional(),
  }),
]);

/** Rows of flat objects (word lists, TVL, quakes, books…), with whatever summary fields the tool adds beside them. */
export const tableDataSchema = z.looseObject({
  rows: z.array(z.record(z.string(), z.unknown())),
  total: count.optional(),
  query: text.optional(),
});

/** Anything else: drawn as a JSON tree. */
export const jsonDataSchema = z.unknown();
