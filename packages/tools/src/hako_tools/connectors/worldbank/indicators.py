"""worldbank/indicator: the latest non-empty yearly values of one indicator for one country or region."""

import re
from typing import Any

from pydantic import Field, field_validator

from hako_tools.connectors.worldbank.provider import WORLDBANK
from hako_tools.constants import RUN_DEADLINE_MAX_S, TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

YEARS_DEFAULT = 10
YEARS_MAX = 60  # WDI series start in 1960
# `mrnev` (most recent non-empty) took 12–17 s on cold queries where `mrv` took 1–8 s (2026-10-07), so ask for a
# few extra recent years with `mrv` and drop the empty ones; sparse series (Gini, poverty) need the slack.
EMPTY_YEAR_SLACK = 5
_CODE = re.compile(r"^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+$")
# Friendly names for the series agents ask for most → World Development Indicators codes (verified 2026-10-07).
ALIASES: dict[str, str] = {
    "gdp": "NY.GDP.MKTP.CD",
    "gdp_per_capita": "NY.GDP.PCAP.CD",
    "gdp_growth": "NY.GDP.MKTP.KD.ZG",
    "population": "SP.POP.TOTL",
    "inflation": "FP.CPI.TOTL.ZG",
    "unemployment": "SL.UEM.TOTL.ZS",
    "life_expectancy": "SP.DYN.LE00.IN",
    "internet_users": "IT.NET.USER.ZS",
    "co2_per_capita": "EN.GHG.CO2.PC.CE.AR5",
    "gini": "SI.POV.GINI",
    "fdi_inflows": "BX.KLT.DINV.CD.WD",
    "exports_pct_gdp": "NE.EXP.GNFS.ZS",
    "government_debt_pct_gdp": "GC.DOD.TOTL.GD.ZS",
    "urban_population_pct": "SP.URB.TOTL.IN.ZS",
}


class IndicatorInput(ToolInput):
    country: str = Field(pattern=r"^[A-Za-z0-9]{2,3}$",
                         description="ISO 3166 alpha-2 or alpha-3 code ('BR', 'BRA'), or a region such as 'WLD' "
                         "(world) or 'EUU' (European Union).")
    indicator: str = Field(min_length=2, max_length=40,
                           description=f"A WDI code such as 'NY.GDP.MKTP.CD', or one of: {', '.join(ALIASES)}.")
    years: int = Field(YEARS_DEFAULT, ge=1, le=YEARS_MAX, description="How many most recent non-empty years.")

    @field_validator("indicator")
    @classmethod
    def _code(cls, value: str) -> str:
        alias = ALIASES.get(value.strip().lower().replace(" ", "_").replace("-", "_"))
        if alias:
            return alias
        if not _CODE.match(value):
            raise ValueError(f"expected a WDI code like NY.GDP.MKTP.CD or one of: {', '.join(ALIASES)}")
        return value.upper()


class YearValue(ToolOutput):
    year: str
    value: float


class IndicatorOutput(ToolOutput):
    country: str
    country_name: str | None = None
    indicator: str
    indicator_name: str | None = None
    last_updated: str | None = None
    rows: list[YearValue]  # newest first


@tool(
    provider=WORLDBANK,
    slug="indicator",
    name="World Bank Indicator",
    summary="Yearly values of a World Bank indicator (GDP, population, inflation…) for a country, newest first.",
    description="Returns the most recent non-empty yearly values of one World Development Indicator for one country "
    "or aggregate (world, EU, income groups), with the indicator's full name and the data's last update. Pass a "
    "WDI code or a friendly alias (gdp, gdp_per_capita, gdp_growth, population, inflation, unemployment, "
    "life_expectancy, internet_users, co2_per_capita, gini, …). Values are annual and lag 1–2 years; it has no "
    "monthly, live market or forecast data. An unknown country or code answers found=false. A query nobody has "
    "asked recently can take several seconds upstream; repeats are cached for a day.",
    categories=(Category.finance, Category.government),
    render=Render.table,
    price=LOCAL,
    example={"country": "BR", "indicator": "gdp", "years": 5},
    see_also=("wikidata/entity", "hako/answer"),
    deadline_s=RUN_DEADLINE_MAX_S,  # the API is slow on cold queries (see EMPTY_YEAR_SLACK)
    cache_ttl_s=TTL_REFERENCE_S,
)
async def indicator(inp: IndicatorInput, ctx: RunContext) -> IndicatorOutput:
    path = f"/v2/country/{inp.country.upper()}/indicator/{inp.indicator}"
    span = inp.years + EMPTY_YEAR_SLACK
    data = await ctx.get_json(WORLDBANK, path, params={"format": "json", "mrv": span, "per_page": span})
    meta: dict[str, Any] = data[0] if isinstance(data, list) and data else {}
    raw: list[dict[str, Any]] = (data[1] if isinstance(data, list) and len(data) > 1 else None) or []
    rows = [r for r in raw if r.get("value") is not None][: inp.years]
    if "message" in meta or not rows:
        raise ToolNotFoundResult(f"The World Bank has no {inp.indicator} data for {inp.country.upper()}")
    first = rows[0]
    return IndicatorOutput(
        country=first.get("countryiso3code") or inp.country.upper(),
        country_name=(first.get("country") or {}).get("value"),
        indicator=inp.indicator,
        indicator_name=(first.get("indicator") or {}).get("value"),
        last_updated=meta.get("lastupdated"),
        rows=[YearValue(year=str(r["date"]), value=r["value"]) for r in rows],
    )
