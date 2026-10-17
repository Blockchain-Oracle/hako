"""nasa/asteroids: NeoWs close approaches for up to a week, closest first."""

import datetime as dt
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.nasa.provider import NASA
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

MAX_SPAN_DAYS = 7  # NeoWs feed limit (api.nasa.gov, "Neo - Feed")
LIMIT_DEFAULT = 10
LIMIT_MAX = 25


class AsteroidsInput(ToolInput):
    start_date: dt.date | None = Field(None, description="YYYY-MM-DD; defaults to today (UTC).")
    end_date: dt.date | None = Field(None, description="YYYY-MM-DD, at most 7 days after start_date; defaults to it.")
    hazardous_only: bool = Field(False, description="Only objects NASA flags as potentially hazardous.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)

    @model_validator(mode="after")
    def _span(self) -> Self:
        start = self.start_date or dt.datetime.now(dt.UTC).date()
        end = self.end_date or start
        if not 0 <= (end - start).days <= MAX_SPAN_DAYS:
            raise ValueError(f"end_date must be on or after start_date and at most {MAX_SPAN_DAYS} days later")
        return self


class Approach(ToolOutput):
    name: str
    id: str
    approach_time: str | None = None  # UTC, e.g. "2026-Oct-03 16:31"
    miss_distance_km: float | None = None
    miss_distance_lunar: float | None = None  # in Earth–Moon distances
    velocity_km_s: float | None = None
    diameter_min_m: float | None = None
    diameter_max_m: float | None = None
    hazardous: bool = False
    sentry: bool = False  # on JPL's Sentry impact-monitoring list
    url: str | None = None


class AsteroidsOutput(ToolOutput):
    start_date: str
    end_date: str
    total: int
    hazardous: int
    rows: list[Approach]


def _float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _approach(neo: dict[str, Any]) -> Approach:
    close = (neo.get("close_approach_data") or [{}])[0]
    miss = close.get("miss_distance") or {}
    size = (neo.get("estimated_diameter") or {}).get("meters") or {}
    return Approach(
        name=str(neo.get("name", "")).strip("() ") or str(neo.get("id", "")),
        id=str(neo.get("id", "")),
        approach_time=close.get("close_approach_date_full") or close.get("close_approach_date"),
        miss_distance_km=_float(miss.get("kilometers")),
        miss_distance_lunar=_float(miss.get("lunar")),
        velocity_km_s=_float((close.get("relative_velocity") or {}).get("kilometers_per_second")),
        diameter_min_m=_float(size.get("estimated_diameter_min")),
        diameter_max_m=_float(size.get("estimated_diameter_max")),
        hazardous=bool(neo.get("is_potentially_hazardous_asteroid")),
        sentry=bool(neo.get("is_sentry_object")),
        url=neo.get("nasa_jpl_url"),
    )


@tool(
    provider=NASA,
    slug="asteroids",
    name="NASA Near-Earth Asteroids",
    summary="Asteroids passing Earth over up to 7 days: miss distance, speed, size and hazard flag, closest first.",
    description="Reads NASA's NeoWs feed (JPL CNEOS data) for up to a week and returns the count, how many are "
    "flagged potentially hazardous, and the closest approaches with time, miss distance (km and lunar distances), "
    "speed, estimated diameter and JPL's page. 'Potentially hazardous' is an orbital classification, not a "
    "prediction of impact. It does not compute impact probabilities; JPL's Sentry list is flagged per object.",
    categories=(Category.science,),
    render=Render.table,
    price=LOCAL,
    example={"start_date": "2026-10-01", "end_date": "2026-10-03", "limit": 5},
    see_also=("nasa/apod",),
    cache_ttl_s=TTL_PAGE_S,
)
async def asteroids(inp: AsteroidsInput, ctx: RunContext) -> AsteroidsOutput:
    start = inp.start_date or dt.datetime.now(dt.UTC).date()
    end = inp.end_date or start
    data = await ctx.get_json(NASA, "/neo/rest/v1/feed",
                              params={"start_date": start.isoformat(), "end_date": end.isoformat()})
    neos = [_approach(n) for day in (data.get("near_earth_objects") or {}).values() for n in day]
    hazardous = sum(1 for n in neos if n.hazardous)
    picked = [n for n in neos if n.hazardous] if inp.hazardous_only else neos
    picked.sort(key=lambda n: n.miss_distance_km if n.miss_distance_km is not None else float("inf"))
    return AsteroidsOutput(start_date=start.isoformat(), end_date=end.isoformat(),
                           total=data.get("element_count") or len(neos), hazardous=hazardous,
                           rows=picked[: inp.limit])
