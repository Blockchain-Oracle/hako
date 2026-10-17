"""ECB's own daily XML: the fallback when Frankfurter is unreachable (EUR-based; cross rates computed)."""

import re
from functools import cache

from hako_core.http.client import UpstreamClient
from hako_now import clients
from hako_now.constants import ECB_XML

client = cache(lambda: UpstreamClient(ECB_XML))
clients.register(client)

_TIME_RE = re.compile(r"time='(\d{4}-\d{2}-\d{2})'")
_RATE_RE = re.compile(r"currency='([A-Z]{3})' rate='([\d.]+)'")
EURO = "EUR"


async def daily() -> tuple[str | None, dict[str, float]]:
    """(date, EUR→currency rates) from eurofxref-daily.xml."""
    resp = await client().request("GET", "/stats/eurofxref/eurofxref-daily.xml")
    text = resp.text if resp.is_success else ""
    day = m.group(1) if (m := _TIME_RE.search(text)) else None
    rates = {code: float(rate) for code, rate in _RATE_RE.findall(text)}
    rates[EURO] = 1.0
    return day, rates


def cross(rates: dict[str, float], base: str, quote: str) -> float | None:
    if base in rates and quote in rates:
        return rates[quote] / rates[base]
    return None
