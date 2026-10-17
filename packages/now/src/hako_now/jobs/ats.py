"""Public ATS job boards → normalized rows. Board list: data/job_boards.json (each slug verified live 2026-09-29
against its ATS API; a board that stops answering is skipped and reported, never guessed)."""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from hako_now.constants import MS_PER_S, THOUSAND

_MONEY_RE = re.compile(r"((?:CA|C|AU|A|NZ|S|HK|US)?\$|€|£)\s?([\d.,]+)\s?([KkMm]?)")
# "CA$215K" is Canadian dollars: a bare "$" is read as USD only when no country prefix precedes it.
_SYMBOL_CURRENCY = {
    "$": "USD",
    "US$": "USD",
    "CA$": "CAD",
    "C$": "CAD",
    "AU$": "AUD",
    "A$": "AUD",
    "NZ$": "NZD",
    "S$": "SGD",
    "HK$": "HKD",
    "€": "EUR",
    "£": "GBP",
}
MILLION = 1_000_000
REMOTE_WORDS = ("remote",)


@dataclass(slots=True)
class JobRow:
    company: str
    title: str
    location: str | None
    department: str | None
    remote: bool | None
    salary: str | None
    salary_min: int | None
    currency: str | None
    posted_at: int | None  # epoch seconds
    url: str


def _epoch(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso).timestamp())
    except ValueError:
        return None


def salary_floor(text: str | None) -> tuple[int | None, str | None]:
    """Lowest amount in a stated range ("$257K – $335K" → 257000, USD)."""
    if not text or not (m := _MONEY_RE.search(text)):
        return None, None
    amount = float(m.group(2).replace(",", ""))
    scale = {"k": THOUSAND, "m": MILLION}.get(m.group(3).lower(), 1)
    return int(amount * scale), _SYMBOL_CURRENCY.get(m.group(1))


def _remote_from(location: str | None) -> bool | None:
    return True if location and any(w in location.lower() for w in REMOTE_WORDS) else None


def greenhouse(slug: str, data: dict[str, Any]) -> list[JobRow]:
    rows = []
    for j in data.get("jobs", []):
        location = (j.get("location") or {}).get("name")
        rows.append(
            JobRow(
                company=j.get("company_name") or slug,
                title=j.get("title") or "",
                location=location,
                department=None,
                remote=_remote_from(location),
                salary=None,
                salary_min=None,
                currency=None,
                posted_at=_epoch(j.get("first_published") or j.get("updated_at")),
                url=j.get("absolute_url") or "",
            )
        )
    return rows


def lever(slug: str, data: list[dict[str, Any]]) -> list[JobRow]:
    rows = []
    for j in data:
        cats = j.get("categories") or {}
        salary = j.get("salaryRange") or {}
        low, currency = salary.get("min"), salary.get("currency")
        text = f"{currency} {low:,}–{salary.get('max'):,} {salary.get('interval', '')}".strip() if low else None
        location = ", ".join(cats.get("allLocations") or [cats.get("location") or ""]) or None
        rows.append(
            JobRow(
                company=slug,
                title=j.get("text") or "",
                location=location,
                department=cats.get("department") or cats.get("team"),
                remote=True if j.get("workplaceType") == "remote" else _remote_from(location),
                salary=text,
                salary_min=int(low) if low else None,
                currency=currency,
                posted_at=int(j["createdAt"]) // MS_PER_S if j.get("createdAt") else None,
                url=j.get("hostedUrl") or "",
            )
        )
    return rows


def ashby(slug: str, data: dict[str, Any]) -> list[JobRow]:
    rows = []
    for j in data.get("jobs", []):
        if j.get("isListed") is False:
            continue
        summary = (j.get("compensation") or {}).get("compensationTierSummary")
        low, currency = salary_floor(summary)
        location = j.get("location")
        rows.append(
            JobRow(
                company=slug,
                title=j.get("title") or "",
                location=location,
                department=j.get("department") or j.get("team"),
                remote=True if j.get("isRemote") or j.get("workplaceType") == "Remote" else _remote_from(location),
                salary=summary,
                salary_min=low,
                currency=currency,
                posted_at=_epoch(j.get("publishedAt")),
                url=j.get("jobUrl") or "",
            )
        )
    return rows
