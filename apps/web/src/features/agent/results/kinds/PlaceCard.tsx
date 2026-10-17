"use client";

import { Globe, Map as MapIcon, MapPin, Phone, Star } from "lucide-react";

import { COORD_DECIMALS, OSM_ZOOM, PLACES_PREVIEW, RATING_DECIMALS } from "../constants";
import { formatCount, formatNumber } from "../format";
import { coordsOf, hostOf, num, pickRecords, pickStr, type Rec, rowKey, safeHref, str } from "../parse";
import { Empty, ExtLink, Meta, Pill, ShowAll, usePreview } from "../primitives";

// Only the characters a phone number needs reach the tel: link.
const PHONE_CHARS = /[^\d+]/g;

function osmHref(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${OSM_ZOOM}/${lat}/${lon}`;
}

function Place({ place }: { place: Rec }) {
  const name = pickStr(place, "name", "title") ?? "Unnamed place";
  const rating = num(place.rating);
  const count = num(place.rating_count ?? place.ratings_total ?? place.reviews);
  const address = pickStr(place, "address", "formatted_address") ?? [str(place.state), str(place.country)].filter(Boolean).join(", ");
  const phone = pickStr(place, "phone", "phone_number");
  const dial = phone?.replace(PHONE_CHARS, "");
  const coords = coordsOf(place);
  const position = num(place.position);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="min-w-0 text-[0.9375rem] leading-snug font-medium text-foreground">
          {position !== null && <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{position}</span>}
          {name}
        </h4>
        {rating !== null && (
          <span className="inline-flex items-center gap-1 font-mono text-[0.8125rem] text-foreground">
            <Star className="size-3.5 fill-current text-brand" aria-hidden />
            {formatNumber(rating, RATING_DECIMALS)}
            {count !== null && <span className="text-muted-foreground">({formatCount(count)})</span>}
          </span>
        )}
      </div>
      <Meta className="mt-0.5">
        {pickStr(place, "category", "type") && <span>{pickStr(place, "category", "type")}</span>}
        {str(place.price_level) && <Pill tone="outline">{str(place.price_level)}</Pill>}
        {address && <span>{address}</span>}
      </Meta>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {phone && dial && (
          <a href={`tel:${dial}`} className="inline-flex items-center gap-1 text-ink-2 hover:text-brand">
            <Phone className="size-3" aria-hidden /> {phone}
          </a>
        )}
        {safeHref(place.website) && (
          <ExtLink href={place.website} className="inline-flex items-center gap-1">
            <Globe className="size-3" aria-hidden /> {hostOf(place.website)}
          </ExtLink>
        )}
        {safeHref(place.maps_url) && (
          <ExtLink href={place.maps_url} className="inline-flex items-center gap-1">
            <MapIcon className="size-3" aria-hidden /> Google Maps
          </ExtLink>
        )}
        {coords && (
          <ExtLink href={osmHref(coords.lat, coords.lon)} className="inline-flex items-center gap-1 font-mono" title="Open in OpenStreetMap">
            <MapPin className="size-3" aria-hidden />
            {formatNumber(coords.lat, COORD_DECIMALS)}, {formatNumber(coords.lon, COORD_DECIMALS)}
          </ExtLink>
        )}
      </p>
    </li>
  );
}

/** Places and geocodes (serper/places, openweather/geocode): name, address, rating, contact, map. */
export function PlaceCard({ data }: { data: Rec }) {
  const listed = pickRecords(data, "places", "results", "items");
  const places = listed.length > 0 ? listed : coordsOf(data) || str(data.address) ? [data] : [];
  const { shown, expanded, toggle, total } = usePreview(places, PLACES_PREVIEW);
  const query = pickStr(data, "query");
  const near = pickStr(data, "location", "near");
  return (
    <div>
      {query && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          <span className="text-foreground">“{query}”</span>
          {near && ` near ${near}`} · {places.length} {places.length === 1 ? "place" : "places"}
        </p>
      )}
      {places.length === 0 ? (
        <Empty>No places matched.</Empty>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {shown.map((place, index) => (
              <Place key={rowKey(place, index, "name")} place={place} />
            ))}
          </ol>
          <ShowAll total={total} limit={PLACES_PREVIEW} expanded={expanded} onToggle={toggle} noun="places" />
        </>
      )}
    </div>
  );
}
