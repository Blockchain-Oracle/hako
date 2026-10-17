"""Wikidata endpoints: entity search, and one entity's key facts with item values resolved to labels."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from pydantic import Field

from hako_tools.connectors.wikidata.provider import WIKIDATA
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import (
    LOCAL,
    Category,
    Link,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

API_PATH = "/w/api.php"
DEFAULT_LANG = "en"
LANG_PATTERN = r"^[a-z]{2,3}(-[a-z]{2,8})?$"
ENTITY_ID_PATTERN = r"^[Qq][1-9][0-9]{0,11}$"
SEARCH_LIMIT_DEFAULT = 5
SEARCH_LIMIT_MAX = 20
MAX_VALUES_PER_FACT = 5  # population or award lists can run to hundreds of statements
MAX_IDS_PER_CALL = 50  # wbgetentities accepts at most 50 ids (Wikidata:Data_access)
MAX_ALIASES = 5
# Wikibase time precision codes (mediawiki.org/wiki/Wikibase/DataModel#Dates_and_times)
PRECISION_DAY = 11
PRECISION_MONTH = 10
POINT_IN_TIME = "P585"
UNITLESS = "1"

# The facts agents ask for most, in display order (everything else needs the full entity JSON or SPARQL).
CLAIMS: dict[str, str] = {
    "P31": "instance of",
    "P279": "subclass of",
    "P17": "country",
    "P27": "country of citizenship",
    "P131": "located in",
    "P36": "capital",
    "P625": "coordinates",
    "P1082": "population",
    "P2046": "area",
    "P571": "inception",
    "P576": "dissolved",
    "P569": "date of birth",
    "P570": "date of death",
    "P19": "place of birth",
    "P20": "place of death",
    "P106": "occupation",
    "P69": "educated at",
    "P112": "founded by",
    "P169": "chief executive officer",
    "P159": "headquarters",
    "P452": "industry",
    "P1128": "employees",
    "P50": "author",
    "P57": "director",
    "P577": "publication date",
    "P136": "genre",
    "P37": "official language",
    "P38": "currency",
    "P35": "head of state",
    "P6": "head of government",
    "P856": "official website",
    "P18": "image",
}


def _lang() -> Any:
    return Field(DEFAULT_LANG, pattern=LANG_PATTERN, description="Label language, e.g. 'en', 'de', 'ja'.")


def _entity_url(qid: str) -> str:
    return f"https://www.wikidata.org/wiki/{qid}"


async def _api(ctx: RunContext, params: dict[str, Any]) -> dict[str, Any]:
    data = await ctx.get_json(WIKIDATA, API_PATH, params={**params, "format": "json"})
    error = data.get("error") if isinstance(data, dict) else None
    if error:
        if error.get("code") == "no-such-entity":
            raise ToolNotFoundResult(f"Wikidata has no entity {params.get('ids')}")
        raise ProviderError(f"Wikidata answered an error: {error.get('code')}", details=[str(error.get("info"))])
    return data


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=250, description="A name or label, e.g. 'Alan Turing' or 'Kyoto'.")
    limit: int = Field(SEARCH_LIMIT_DEFAULT, ge=1, le=SEARCH_LIMIT_MAX)
    lang: str = _lang()


class EntityHit(Link):
    id: str


class SearchOutput(ToolOutput):
    query: str
    results: list[EntityHit]


@tool(
    provider=WIKIDATA,
    slug="search",
    name="Wikidata Entity Search",
    summary="Find Wikidata entities (Q-ids) by name, with label and one-line description to tell them apart.",
    description="Matches labels and aliases (prefix match, so 'Alan Tur' works) and returns each candidate's Q-id, "
    "label and description, e.g. to tell Paris the city from Paris Hilton. Pass the chosen id to wikidata/entity for "
    "its facts. It matches names, not facts: 'tallest building in Japan' will not work; use hako/answer or "
    "wikipedia/search for questions.",
    categories=(Category.knowledge,),
    render=Render.search_results,
    price=LOCAL,
    example={"query": "Alan Turing", "limit": 3},
    see_also=("wikidata/entity", "wikipedia/search"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    data = await _api(ctx, {"action": "wbsearchentities", "search": inp.query, "language": inp.lang,
                            "uselang": inp.lang, "type": "item", "limit": inp.limit})
    hits = [
        EntityHit(id=row["id"], title=row.get("label") or row["id"], url=_entity_url(row["id"]),
                  snippet=row.get("description"), source="wikidata", position=i + 1)
        for i, row in enumerate(data.get("search") or [])
        if row.get("id")
    ]
    return SearchOutput(query=inp.query, results=hits)


class EntityInput(ToolInput):
    id: str = Field(pattern=ENTITY_ID_PATTERN, description="A Wikidata item id, e.g. 'Q7251'.")
    lang: str = _lang()


class Fact(ToolOutput):
    property: str
    pid: str
    values: list[str]
    ids: list[str] | None = None  # the Q-ids behind item values, for a follow-up wikidata/entity call


class EntityOutput(ToolOutput):
    id: str
    label: str | None = None
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    url: str
    wikipedia_url: str | None = None
    facts: list[Fact]
    property_count: int  # how many properties the entity has in total; facts shows a curated subset


@dataclass(slots=True)
class _Value:
    text: str = ""
    item: str | None = None  # Q-id shown as its label
    unit: str | None = None  # Q-id of a quantity's unit, appended as its label


def _time(value: dict[str, Any]) -> str:
    raw = str(value.get("time", ""))
    sign, body = raw[:1], raw[1:]
    year, month, day = [*body.split("T")[0].split("-"), "00", "00"][:3]
    year = year.lstrip("0") or "0"
    precision = int(value.get("precision", 0))
    if sign == "-":
        return f"{year} BCE"
    if precision >= PRECISION_DAY:
        return f"{year}-{month}-{day}"
    if precision == PRECISION_MONTH:
        return f"{year}-{month}"
    return year


def _qualifier_year(statement: dict[str, Any]) -> str | None:
    snaks = (statement.get("qualifiers") or {}).get(POINT_IN_TIME) or []
    value = ((snaks[0].get("datavalue") or {}).get("value") or {}) if snaks else {}
    return _time(value)[:4] if value else None


def _value(statement: dict[str, Any]) -> _Value | None:
    snak = statement.get("mainsnak") or {}
    if snak.get("snaktype") != "value":
        return None
    datavalue = snak.get("datavalue") or {}
    value, kind = datavalue.get("value"), datavalue.get("type")
    if kind == "wikibase-entityid" and isinstance(value, dict):
        return _Value(item=value.get("id"))
    if kind == "time" and isinstance(value, dict):
        return _Value(text=_time(value))
    if kind == "quantity" and isinstance(value, dict):
        amount = str(value.get("amount", "")).lstrip("+")
        year = _qualifier_year(statement)
        unit = str(value.get("unit", UNITLESS))
        return _Value(text=f"{amount} ({year})" if year else amount,
                      unit=None if unit == UNITLESS else unit.rsplit("/", 1)[-1])
    if kind == "globecoordinate" and isinstance(value, dict):
        return _Value(text=f"{value.get('latitude')}, {value.get('longitude')}")
    if kind == "monolingualtext" and isinstance(value, dict):
        return _Value(text=str(value.get("text", "")))
    if snak.get("datatype") == "commonsMedia":
        return _Value(text=f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(str(value).replace(' ', '_'))}")
    return _Value(text=str(value)) if value is not None else None


def _best(statements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Preferred-rank statements when there are any (e.g. the latest population), else the normal ones."""
    live = [s for s in statements if s.get("rank") != "deprecated"]
    preferred = [s for s in live if s.get("rank") == "preferred"]
    return (preferred or live)[:MAX_VALUES_PER_FACT]


def _first_label(entity: dict[str, Any], lang: str) -> str | None:
    labels = entity.get("labels") or {}
    chosen = labels.get(lang) or next(iter(labels.values()), None)
    return chosen.get("value") if chosen else None


async def _labels(ctx: RunContext, ids: list[str], lang: str) -> dict[str, str]:
    if not ids:
        return {}
    data = await _api(ctx, {"action": "wbgetentities", "ids": "|".join(ids[:MAX_IDS_PER_CALL]), "props": "labels",
                            "languages": lang, "languagefallback": 1})
    found = {qid: _first_label(e, lang) for qid, e in (data.get("entities") or {}).items()}
    return {qid: label for qid, label in found.items() if label}


@tool(
    provider=WIKIDATA,
    slug="entity",
    name="Wikidata Entity Facts",
    summary="Key facts about one Wikidata entity: what it is, country, dates, place, people, population, website.",
    description="Reads one item (Q-id) and returns its label, description, aliases, Wikipedia link and a curated "
    "set of about 30 common properties (instance of, country, inception, birth/death, headquarters, CEO, "
    "population, area, official website, image…), with item values resolved to labels and their Q-ids kept for "
    "follow-ups. Only the best-ranked values are kept (up to 5 per property). It does not run SPARQL or list every "
    "property; for prose use wikipedia/summary. Find the Q-id with wikidata/search.",
    categories=(Category.knowledge,),
    render=Render.json,
    price=LOCAL,
    example={"id": "Q7251"},
    see_also=("wikidata/search", "wikipedia/summary"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def entity(inp: EntityInput, ctx: RunContext) -> EntityOutput:
    qid = inp.id.upper()
    site = f"{inp.lang.split('-')[0]}wiki"
    data = await _api(ctx, {"action": "wbgetentities", "ids": qid, "languages": inp.lang, "languagefallback": 1,
                            "props": "labels|descriptions|aliases|claims|sitelinks/urls", "sitefilter": site})
    ent = next(iter((data.get("entities") or {}).values()), {})
    if not ent or "missing" in ent:
        raise ToolNotFoundResult(f"Wikidata has no entity {qid}")
    claims: dict[str, list[dict[str, Any]]] = ent.get("claims") or {}
    raw: list[tuple[str, list[_Value]]] = []
    for pid in CLAIMS:
        values = [v for v in (_value(s) for s in _best(claims.get(pid) or [])) if v]
        if values:
            raw.append((pid, values))
    wanted = list(dict.fromkeys(ref for _, vals in raw for v in vals for ref in (v.item, v.unit) if ref))
    labels = await _labels(ctx, wanted, inp.lang)
    facts: list[Fact] = []
    for pid, values in raw:
        items = [v.item for v in values if v.item]
        rendered = [
            labels.get(v.item, v.item) if v.item else f"{v.text} {labels.get(v.unit, v.unit)}" if v.unit else v.text
            for v in values
        ]
        facts.append(Fact(property=CLAIMS[pid], pid=pid, values=rendered, ids=items or None))
    description = (ent.get("descriptions") or {}).get(inp.lang) or next(iter((ent.get("descriptions") or {}).values()),
                                                                        {})
    aliases = [a.get("value", "") for a in (ent.get("aliases") or {}).get(inp.lang) or []][:MAX_ALIASES]
    return EntityOutput(
        id=ent.get("id", qid),
        label=_first_label(ent, inp.lang),
        description=description.get("value") if description else None,
        aliases=aliases,
        url=_entity_url(ent.get("id", qid)),
        wikipedia_url=((ent.get("sitelinks") or {}).get(site) or {}).get("url"),
        facts=facts,
        property_count=len(claims),
    )
