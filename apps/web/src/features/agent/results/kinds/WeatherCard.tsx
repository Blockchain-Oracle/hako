"use client";

import { Droplets, MapPin, Sunrise, Sunset, Wind } from "lucide-react";

import { COORD_DECIMALS, HOURLY_PREVIEW, OSM_ZOOM, TEMP_DECIMALS, WEATHER_ICON_PX } from "../constants";
import { compass, formatDay, formatNumber, humanize, wallClock } from "../format";
import { coordsOf, pickNum, pickStr, type Rec, rec, records, rowKey, str, strings } from "../parse";
import { ExtLink, Meta, Notice, Section, Stat, Thumb, TimeAgo } from "../primitives";
import { AgreementPill } from "./Provenance";

interface Units {
  temp: string;
  wind: string;
  precip: string;
}

// hako/weather reports SI with the unit in each field name; OpenWeather sends its unit labels.
const SI_UNITS: Units = { temp: "°C", wind: "m/s", precip: "mm" };

function readUnits(data: Rec): Units {
  const units = rec(data.units);
  return {
    temp: pickStr(units, "temperature", "temp") ?? SI_UNITS.temp,
    wind: pickStr(units, "wind_speed", "wind") ?? SI_UNITS.wind,
    precip: pickStr(units, "precipitation", "precip") ?? SI_UNITS.precip,
  };
}

// hako/weather's place carries the gazetteer's description: "Chicago (city and county seat of …)".
const PLACE_WITH_NOTE = /^(.+?)\s*\((.+)\)$/;

function placeOf(data: Rec): string | null {
  const location = rec(data.location);
  const parts = [pickStr(location, "name"), pickStr(location, "state"), pickStr(location, "country")].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : pickStr(data, "place", "name", "city");
}

const temp = (value: number | null, units: Units) => (value !== null ? `${formatNumber(value, TEMP_DECIMALS)}${units.temp}` : null);

function Current({ now, units }: { now: Rec; units: Units }) {
  const t = pickNum(now, "temp", "temperature_c", "temperature");
  const conditions = pickStr(now, "description", "conditions", "condition");
  const wind = pickNum(now, "wind_speed", "wind_speed_ms");
  const windDeg = pickNum(now, "wind_deg", "wind_from_deg");
  const gust = pickNum(now, "wind_gust");
  const precip = pickNum(now, "rain_1h_mm", "precipitation_next_hour_mm", "precipitation_mm");
  const snow = pickNum(now, "snow_1h_mm");
  const humidity = pickNum(now, "humidity_pct", "humidity");
  const tMin = pickNum(now, "temp_min");
  const tMax = pickNum(now, "temp_max");
  return (
    <div>
      <div className="flex items-center gap-3">
        <p className="font-display text-5xl leading-none font-semibold tracking-[-0.04em] text-foreground">{temp(t, units) ?? "—"}</p>
        <Thumb src={now.icon_url} alt="" width={WEATHER_ICON_PX} height={WEATHER_ICON_PX} className="size-12 border-0 bg-transparent" />
        <div className="min-w-0">
          {conditions && <p className="text-[0.9375rem] font-medium text-foreground">{humanize(conditions)}</p>}
          {tMin !== null && tMax !== null && (
            <p className="text-xs text-muted-foreground">
              {temp(tMin, units)} / {temp(tMax, units)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Feels like" value={temp(pickNum(now, "feels_like"), units)} />
        <Stat
          label="Wind"
          value={wind !== null ? `${formatNumber(wind, 1)} ${units.wind}${windDeg !== null ? ` ${compass(windDeg)}` : ""}` : null}
          title={gust !== null ? `Gusts ${formatNumber(gust, 1)} ${units.wind}` : undefined}
        />
        <Stat label="Humidity" value={humidity !== null ? `${formatNumber(humidity, 0)}%` : null} />
        <Stat label={"precipitation_next_hour_mm" in now ? "Rain next hour" : "Rain 1 h"} value={precip !== null ? `${formatNumber(precip, 1)} ${units.precip}` : null} />
        {snow !== null && <Stat label="Snow 1 h" value={`${formatNumber(snow, 1)} ${units.precip}`} />}
        <Stat label="Pressure" value={pickNum(now, "pressure_hpa") !== null ? `${pickNum(now, "pressure_hpa")} hPa` : null} />
        <Stat label="Clouds" value={pickNum(now, "clouds_pct") !== null ? `${pickNum(now, "clouds_pct")}%` : null} />
      </div>
      {(wallClock(now.sunrise) || wallClock(now.sunset)) && (
        <Meta className="mt-3">
          {wallClock(now.sunrise) && (
            <span className="inline-flex items-center gap-1">
              <Sunrise className="size-3" aria-hidden /> {wallClock(now.sunrise)}
            </span>
          )}
          {wallClock(now.sunset) && (
            <span className="inline-flex items-center gap-1">
              <Sunset className="size-3" aria-hidden /> {wallClock(now.sunset)}
            </span>
          )}
        </Meta>
      )}
    </div>
  );
}

function Hourly({ steps, units }: { steps: Rec[]; units: Units }) {
  return (
    <Section label="Next hours">
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {steps.slice(0, HOURLY_PREVIEW).map((step, index) => {
          const chance = pickNum(step, "precip_chance_pct");
          return (
            <li key={rowKey(step, index, "time")} className="min-w-[4.25rem] shrink-0 rounded-sm bg-subtle px-2 py-1.5 text-center">
              <p className="font-mono text-[0.6875rem] text-muted-foreground">{wallClock(step.time) ?? "—"}</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{temp(pickNum(step, "temp"), units) ?? "—"}</p>
              {chance !== null && (
                <p className="inline-flex items-center gap-0.5 text-[0.6875rem] text-ink-2">
                  <Droplets className="size-2.5" aria-hidden /> {chance}%
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Daily({ days, units }: { days: Rec[]; units: Units }) {
  return (
    <Section label="Days ahead">
      <ol className="divide-y divide-line">
        {days.map((day, index) => {
          const chance = pickNum(day, "precip_chance_max_pct");
          const wind = pickNum(day, "wind_max");
          return (
            <li key={rowKey(day, index, "date")} className="grid grid-cols-[6.5rem_1fr_auto] items-baseline gap-3 py-1.5 text-[0.8125rem]">
              <span className="font-medium text-foreground">{formatDay(day.date) ?? "—"}</span>
              <span className="min-w-0 truncate text-ink-2">
                {pickStr(day, "description") ? humanize(pickStr(day, "description") ?? "") : ""}
                {chance !== null && <span className="text-muted-foreground"> · {chance}% rain</span>}
                {wind !== null && <span className="text-muted-foreground"> · wind {formatNumber(wind, 1)} {units.wind}</span>}
              </span>
              <span className="font-mono whitespace-nowrap text-foreground">
                {temp(pickNum(day, "temp_min"), units) ?? "—"} <span className="text-muted-foreground">/</span>{" "}
                {temp(pickNum(day, "temp_max"), units) ?? "—"}
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Readings({ readings, units }: { readings: Rec[]; units: Units }) {
  return (
    <Section label="Each source">
      <ul className="space-y-1 text-[0.8125rem]">
        {readings.map((reading, index) => {
          const wind = pickNum(reading, "wind_speed_ms", "wind_speed");
          const humidity = pickNum(reading, "humidity_pct");
          return (
            <li key={rowKey(reading, index, "source")} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{str(reading.source) ?? "source"}</span>
              <span className="font-mono text-foreground">{temp(pickNum(reading, "temperature_c", "temp"), units) ?? "—"}</span>
              <Meta>
                {pickStr(reading, "conditions") && humanize(pickStr(reading, "conditions") ?? "")}
                {wind !== null && (
                  <span className="inline-flex items-center gap-0.5">
                    <Wind className="size-3" aria-hidden /> {formatNumber(wind, 1)} {units.wind}
                  </span>
                )}
                {humidity !== null && `${formatNumber(humidity, 0)}%`}
                {str(reading.issued_at) && <TimeAgo value={reading.issued_at} />}
              </Meta>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Weather now and ahead (hako/weather, openweather/current, openweather/forecast). */
export function WeatherCard({ data }: { data: Rec }) {
  const units = readUnits(data);
  const now = Object.keys(rec(data.current)).length > 0 ? rec(data.current) : data;
  const hasNow = pickNum(now, "temp", "temperature_c", "temperature") !== null || pickStr(now, "conditions", "description") !== null;
  const coords = coordsOf(rec(data.location)) ?? coordsOf(data);
  const placeFull = placeOf(data);
  const [, placeName, placeNote] = (placeFull && PLACE_WITH_NOTE.exec(placeFull)) || [null, placeFull, null];
  const place = placeName ?? placeFull;
  const when = now.observed_at ?? data.valid_for ?? now.valid_for;
  const hourly = records(data.next_24h ?? data.hourly);
  const days = records(data.days ?? data.daily);
  const readings = records(data.readings);
  const alerts = strings(data.alerts);
  const provenance = rec(data.provenance);
  return (
    <div>
      {(place || coords) && (
        <div className="mb-3">
          {place && <p className="font-display text-base leading-snug font-semibold tracking-[-0.02em] text-foreground">{place}</p>}
          {placeNote && <p className="text-xs text-muted-foreground">{placeNote}</p>}
          <Meta className="mt-0.5">
            {coords && (
              <ExtLink
                href={`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=${OSM_ZOOM}/${coords.lat}/${coords.lon}`}
                className="inline-flex items-center gap-0.5 font-mono"
              >
                <MapPin className="size-3" aria-hidden />
                {formatNumber(coords.lat, COORD_DECIMALS)}, {formatNumber(coords.lon, COORD_DECIMALS)}
              </ExtLink>
            )}
            {str(when) && <TimeAgo value={when} />}
            {str(provenance.agreement) && <AgreementPill provenance={provenance} />}
          </Meta>
        </div>
      )}
      {alerts.map((alert, i) => (
        <Notice key={i} className="mb-3">
          {alert}
        </Notice>
      ))}
      {hasNow && <Current now={now} units={units} />}
      {hourly.length > 0 && <Hourly steps={hourly} units={units} />}
      {days.length > 0 && <Daily days={days} units={units} />}
      {readings.length > 1 && <Readings readings={readings} units={units} />}
      {!hasNow && hourly.length === 0 && days.length === 0 && (
        <p className="text-sm text-muted-foreground">No readings in this response.</p>
      )}
    </div>
  );
}
