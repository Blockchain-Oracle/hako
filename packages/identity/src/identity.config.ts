/** Mark geometry (Kawase's ui-web Mark) and the gateway's logo proxy path (plan B12). */

/** The mark's box when the caller gives no size (px). */
export const MARK_DEFAULT_SIZE = 44;
/** An uncontained glyph sits on a disc we draw, at this share of the box. */
export const MARK_GLYPH_RATIO = 0.6;
/** The chain badge in the corner, as a share of the mark. */
export const MARK_BADGE_RATIO = 0.42;

/** The labelled neutral disc: at most two initials when there is no symbol. */
export const FALLBACK_INITIALS_MAX = 2;
/** Labels up to this length use the larger size ratio. */
export const FALLBACK_LABEL_SHORT = 2;
export const FALLBACK_RATIO_SHORT = 0.34;
export const FALLBACK_RATIO_LONG = 0.22;

/** The gateway's allowlisted logo proxy: `GET /v1/logo?src=<url>` (24 h cache, LOGO_CACHE_TTL_S in @hako/config). */
export const LOGO_PROXY_PATH = "/v1/logo";
export const LOGO_PROXY_PARAM = "src";
