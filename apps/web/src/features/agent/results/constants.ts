/** Every number the result cards use, named once (the lint rule forbids bare numbers in components). */

// Lists: how many rows a card shows before its "Show all N" toggle.
export const LIST_PREVIEW = 5;
export const PLACES_PREVIEW = 4;
export const TABLE_PREVIEW_ROWS = 8;
export const TABLE_MAX_COLUMNS = 7;
export const RELEASES_PREVIEW = 5;
export const CHIPS_PREVIEW = 8;
export const DEFINITIONS_PREVIEW = 3;
export const PASSAGES_PREVIEW = 3;
export const HOURLY_PREVIEW = 8;
export const SOURCES_PREVIEW = 6;
export const JSON_CHILDREN_PREVIEW = 20;
export const KV_PREVIEW = 10;

// Text: characters shown before a "Show more" toggle.
export const MARKDOWN_CLAMP_CHARS = 1_400;
export const RELEASE_NOTES_CLAMP_CHARS = 700;
export const CONTENT_CLAMP_CHARS = 900;
export const ABSTRACT_CLAMP_CHARS = 320;
export const SNIPPET_CLAMP_CHARS = 260;
export const JSON_STRING_CLAMP_CHARS = 240;
export const CELL_CLAMP_CHARS = 140;
// A cut lands on a paragraph break when one exists past this share of the budget.
export const CLAMP_BREAK_MIN_SHARE = 0.6;

// The JSON tree opens this many levels on first render.
export const JSON_OPEN_DEPTH = 1;

// Time.
export const MS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
export const JUST_NOW_S = 45;
export const RELATIVE_MAX_DAYS = 30; // older than this reads as a date
export const CLOCK_TICK_MS = 30_000;
export const ELAPSED_SECONDS_FROM_MS = 10_000; // 12.3 s instead of 12,345 ms

// Numbers.
export const RATE_DECIMALS_BELOW_ONE = 6;
export const RATE_DECIMALS = 4;
export const MONEY_DECIMALS = 2;
export const DEFAULT_DECIMALS = 2;
export const PERCENT_DECIMALS = 2;
export const COORD_DECIMALS = 4;
export const RATING_DECIMALS = 1;
export const TEMP_DECIMALS = 0;
export const COMPACT_FROM = 10_000; // counts at or above this read as 12.3K
export const FULL_CIRCLE_DEG = 360;
export const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export const SCORE_DECIMALS = 3;

// Maps and images.
export const OSM_ZOOM = 16;
export const THUMB_PX = 56;
export const IMAGE_TILE_PX = 160;
export const COVER_W_PX = 40;
export const COVER_H_PX = 60;
export const WEATHER_ICON_PX = 48;
