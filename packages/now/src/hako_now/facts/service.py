"""/fact: the current value(s) of one Wikidata property for one item, with the statement rules made explicit."""

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache
from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.errors import InvalidInput, UpstreamFailure
from hako_now import clients
from hako_now.constants import (
    HEAD_ALIAS,
    HEAD_OFFICES,
    HEAD_PROPERTIES,
    LABEL_LANGUAGES,
    MAX_FACT_VALUES,
    OFFICE_FOR,
    TTL_FACT_ENTITY,
    TTL_LABELS,
    WIKIDATA_API,
    WIKIDATA_END_TIME,
    WIKIDATA_OFFICEHOLDER,
    WIKIDATA_POINT_IN_TIME,
    WIKIDATA_START_TIME,
)
from hako_now.facts.models import FactRequest, FactResult, FactValue
from hako_now.facts.properties import PROPERTY_ALIASES
from hako_now.provenance import Freshness, Provenance, age_seconds

QID_RE = re.compile(r"^Q\d+$", re.I)
PID_RE = re.compile(r"^P\d+$", re.I)
DAY_PRECISION = 11  # Wikidata time precision: 11 = day, 10 = month, 9 = year
YEAR_PRECISION = 9
MONTH_PRECISION = 10
YEAR_CHARS, MONTH_CHARS, DAY_CHARS = 4, 7, 10
ENTITY_BATCH = 50  # wbgetentities id limit
WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/{title}"


async def _get(path: str) -> dict[str, Any]:
    data, _ = await clients.wikidata().get_json(path)
    return data


async def _search(text: str, kind: str) -> str | None:
    data = await _get(
        f"/w/api.php?action=wbsearchentities&search={quote(text)}&language=en&type={kind}&limit=5&format=json"
    )
    hits = data.get("search", [])
    wanted = text.strip().casefold()
    hits.sort(key=lambda h: (h.get("label") or "").casefold() != wanted)  # exact label first
    return hits[0]["id"] if hits else None


async def _entity(qid: str) -> dict[str, Any]:
    key = cache_key("now", "wikidata", "entity", qid)
    if (hit := await cache.get(key)) is None:
        data = await _get(
            f"/w/api.php?action=wbgetentities&ids={qid}&props=claims|info|labels|sitelinks"
            f"&languages={'|'.join(LABEL_LANGUAGES)}&sitefilter=enwiki&format=json"
        )
        hit = data.get("entities", {}).get(qid) or {}
        await cache.set(key, hit, TTL_FACT_ENTITY)
    return hit


def label_of(entity: dict[str, Any], fallback: str) -> str:
    """English label, then Wikidata's `mul` default, then the enwiki title (some items lack an English label)."""
    labels = entity.get("labels", {})
    for lang in LABEL_LANGUAGES:
        if lang in labels:
            return labels[lang]["value"]
    return (entity.get("sitelinks", {}).get("enwiki") or {}).get("title") or fallback


async def labels(ids: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    missing = []
    for i in ids:
        if (hit := await cache.get(cache_key("now", "wikidata", "label", i))) is not None:
            out[i] = hit
        else:
            missing.append(i)
    for start in range(0, len(missing), ENTITY_BATCH):
        batch = missing[start : start + ENTITY_BATCH]
        data = await _get(
            f"/w/api.php?action=wbgetentities&ids={'|'.join(batch)}&props=labels|sitelinks"
            f"&languages={'|'.join(LABEL_LANGUAGES)}&sitefilter=enwiki&format=json"
        )
        for i in batch:
            out[i] = label_of(data.get("entities", {}).get(i, {}), i)
            await cache.set(cache_key("now", "wikidata", "label", i), out[i], TTL_LABELS)
    return out


def _qualifier_time(statement: dict[str, Any], prop: str) -> str | None:
    for q in statement.get("qualifiers", {}).get(prop, []):
        if (dv := q.get("datavalue")) and isinstance(dv.get("value"), dict):
            return dv["value"].get("time")
    return None


def _as_datetime(wikidata_time: str) -> datetime | None:
    try:
        return datetime.fromisoformat(wikidata_time.lstrip("+").replace("-00", "-01"))
    except ValueError:
        return None


def current_statements(statements: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """(current statements, how many ended). Not deprecated; no end time in the past; preferred rank wins;
    among dated statements (point in time) only the latest date survives."""
    now = datetime.now(UTC)
    live = [s for s in statements if s.get("rank") != "deprecated" and s.get("mainsnak", {}).get("datavalue")]
    current = []
    for s in live:
        end = _qualifier_time(s, WIKIDATA_END_TIME)
        ended = end is not None and (when := _as_datetime(end)) is not None and when <= now
        if not ended:
            current.append(s)
    ended_count = len(live) - len(current)
    preferred = [s for s in current if s.get("rank") == "preferred"]
    chosen = preferred or current
    dated = [(t, s) for s in chosen if (t := _qualifier_time(s, WIKIDATA_POINT_IN_TIME))]
    if dated and len(dated) == len(chosen):
        latest = max(t for t, _ in dated)
        chosen = [s for t, s in dated if t == latest]
    return chosen[:MAX_FACT_VALUES], ended_count


def _time_text(value: dict[str, Any]) -> str:
    text = value.get("time", "").lstrip("+")
    precision = value.get("precision", DAY_PRECISION)
    cut = DAY_CHARS if precision >= DAY_PRECISION else MONTH_CHARS if precision == MONTH_PRECISION else YEAR_CHARS
    return text[:cut]


def _render(statement: dict[str, Any], names: dict[str, str]) -> FactValue:
    dv = statement["mainsnak"]["datavalue"]
    value, kind = dv["value"], dv["type"]
    qid = unit = None
    if kind == "wikibase-entityid":
        item: str = value["id"]
        qid, text = item, names.get(item, item)
    elif kind == "quantity":
        text = value["amount"].lstrip("+")
        unit_id = value.get("unit", "").rsplit("/", 1)[-1]
        unit = names.get(unit_id) if QID_RE.match(unit_id or "") else None
    elif kind == "time":
        text = _time_text(value)
    elif kind == "monolingualtext":
        text = value["text"]
    elif kind == "globecoordinate":
        text = f"{value['latitude']}, {value['longitude']}"
    else:
        text = str(value)
    start = _qualifier_time(statement, WIKIDATA_START_TIME)
    point = _qualifier_time(statement, WIKIDATA_POINT_IN_TIME)
    return FactValue(
        value=text,
        qid=qid,
        unit=unit,
        start=start.lstrip("+")[:DAY_CHARS] if start else None,
        point_in_time=point.lstrip("+")[:DAY_CHARS] if point else None,
        rank="preferred" if statement.get("rank") == "preferred" else "normal",
    )


async def _resolve(entity: dict[str, Any], pid: str) -> tuple[str, list[dict[str, Any]], int, str | None]:
    """(the property that answered, its current statements, how many ended, the office followed or None).

    The subject's own statements first. When it has none that are current, follow the office it names to that
    office's current officeholder (United Nations → P2388 → Secretary-General → P1308).
    """
    claims = entity.get("claims", {})
    direct = HEAD_PROPERTIES if pid == HEAD_ALIAS else (pid,)
    for prop in direct:
        chosen, ended = current_statements(claims.get(prop, []))
        if chosen:
            return prop, chosen, ended, None
    offices = HEAD_OFFICES if pid == HEAD_ALIAS else tuple(o for o in (OFFICE_FOR.get(pid),) if o)
    for office_pid in offices:
        for statement in current_statements(claims.get(office_pid, []))[0]:
            value = statement["mainsnak"]["datavalue"]["value"]
            if not (isinstance(value, dict) and "id" in value):
                continue
            office = await _entity(value["id"])
            holders, ended = current_statements(office.get("claims", {}).get(WIKIDATA_OFFICEHOLDER, []))
            if holders:
                return office_pid, holders, ended, value["id"]
    chosen, ended = current_statements(claims.get(direct[0], []))
    return direct[0], chosen, ended, None


async def get_fact(req: FactRequest) -> tuple[FactResult, list[SourceRef]]:
    try:
        return await _get_fact(req), [SourceRef(name=WIKIDATA_API.name, status=SourceStatus.ok, licence="CC0")]
    except UpstreamFailure as failure:
        raise InvalidInput("Wikidata is not answering right now; retry shortly.") from failure


async def _get_fact(req: FactRequest) -> FactResult:
    subject = req.subject.strip()
    qid = subject.upper() if QID_RE.match(subject) else await _search(subject, "item")
    if qid is None:
        raise InvalidInput(f"Nothing on Wikidata is called '{subject}'.")
    prop = req.property.strip()
    pid = (
        prop.upper() if PID_RE.match(prop) else PROPERTY_ALIASES.get(prop.casefold()) or await _search(prop, "property")
    )
    if pid is None:
        raise InvalidInput(f"No Wikidata property matches '{prop}'.")
    entity = await _entity(qid)
    if not entity or "missing" in entity:
        raise InvalidInput(f"{qid} does not exist on Wikidata.")
    pid, chosen, ended, office = await _resolve(entity, pid)
    refs = {pid} | ({office} if office else set())
    for s in chosen:
        value = s["mainsnak"]["datavalue"]["value"]
        if isinstance(value, dict) and "id" in value:
            refs.add(value["id"])
        if isinstance(value, dict) and QID_RE.match(unit := value.get("unit", "").rsplit("/", 1)[-1] or ""):
            refs.add(unit)
    names = await labels(sorted(refs))
    modified = entity.get("modified")
    title = (entity.get("sitelinks", {}).get("enwiki") or {}).get("title")
    return FactResult(
        subject_qid=qid,
        subject_label=label_of(entity, qid),
        property_pid=pid,
        property_label=names.get(pid),
        values=[_render(s, names) for s in chosen],
        ended_values=ended,
        via_office=f"{names.get(office, office)} ({office})" if office else None,
        wikipedia_url=WIKIPEDIA_URL.format(title=quote(title.replace(" ", "_"))) if title else None,
        provenance=Provenance(
            sources=[WIKIDATA_API.name],
            as_of=modified,
            age_seconds=age_seconds(datetime.fromisoformat(modified)) if modified else None,
            freshness=Freshness.fresh,
            licence="CC0",
            attribution=WIKIDATA_API.attribution,
        ),
    )
