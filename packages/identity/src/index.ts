/**
 * @hako/identity: real marks for every chain, token, provider, LI.FI route and display currency Hako shows (plan §6
 * Logos), ported from Kawase's identity. Keys: `chain:eip155:<id>` / `chain:solana:mainnet`, `token:<caip2>:<address>`,
 * `provider:<catalog id>`, `venue:<LI.FI tool key>`, `fiat:<ISO 4217>`. Sources and licences: PROVENANCE.md.
 */
import { getEntity } from "./mark.tsx";
import { ENTITIES, chainKey, fiatKey, providerKey, tokenKey, venueKey, type Entity, type EntityKind } from "./registry.ts";

export { ENTITIES, chainKey, fiatKey, providerKey, tokenKey, venueKey } from "./registry.ts";
export type { Entity, EntityKind, MarkVariant } from "./registry.ts";
export { MARKS, type MarkStem } from "./generated/index.ts";
export { Mark, getEntity, markFile, type MarkProps } from "./mark.tsx";
export { TokenMark, type TokenMarkProps } from "./token-mark.tsx";
export { FallbackDisc, fallbackFontSize, fallbackLabel } from "./fallback-disc.tsx";
export { LogoImage, LogoProxyProvider } from "./logo-image.tsx";
export { logoProxyUrl } from "./logo-proxy.ts";
export {
  FALLBACK_INITIALS_MAX,
  FALLBACK_LABEL_SHORT,
  FALLBACK_RATIO_LONG,
  FALLBACK_RATIO_SHORT,
  MARK_BADGE_RATIO,
  MARK_DEFAULT_SIZE,
  MARK_GLYPH_RATIO,
} from "./identity.config.ts";

export const getChainIdentity = (caip2: string): Entity | undefined => getEntity(chainKey(caip2));
export const getTokenIdentity = (caip2: string, address: string): Entity | undefined => getEntity(tokenKey(caip2, address));
export const getProviderIdentity = (slug: string): Entity | undefined => getEntity(providerKey(slug));
export const getVenueIdentity = (toolKey: string): Entity | undefined => getEntity(venueKey(toolKey));
export const getFiatIdentity = (code: string): Entity | undefined => getEntity(fiatKey(code));
export const entitiesOfKind = (kind: EntityKind): Entity[] => ENTITIES.filter((entity) => entity.kind === kind);
