"""R18 provider-spend ceiling for ElevenLabs: a daily credit budget a generation holds its estimate against before it
runs, an alarm in the logs past 80 %, and the hold settled at what the call really cost (ElevenLabs' `character-cost`
header) after it.

The count lives in this process: hako-api runs one worker (services/api/Dockerfile), so it is the whole server's. The
check and the hold happen together with no await between them, so concurrent generations cannot all pass the check
and overshoot the ceiling.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import structlog

from hako_tools.framework.errors import ProviderError, ProviderRateLimited, ToolNotFoundResult, ToolUnavailable

log = structlog.get_logger(__name__)

# The account has ~140k credits a month (Starter + rollover, 2026-10-17): one day may spend at most 15k of them.
DAILY_CREDITS_MAX = 15_000
ALARM_SHARE = 0.8
COST_HEADER = "character-cost"
# ElevenLabs refused the call (an error status, a rate limit, an unknown voice): nothing was generated, so the hold
# goes back. A deadline or a cancellation keeps it: the audio may have been made and charged after we stopped waiting.
_REFUSED = (ProviderError, ProviderRateLimited, ToolNotFoundResult, ToolUnavailable)
_spent: dict[str, int] = {}


def _today() -> str:
    day = datetime.now(UTC).date().isoformat()
    for old in [d for d in _spent if d != day]:
        del _spent[old]
    return day


def reserve(credits: int) -> None:
    """Hold `credits` of today's budget, or refuse (503, nothing is charged) when they would pass the ceiling."""
    day = _today()
    spent = _spent.get(day, 0)
    if spent + credits > DAILY_CREDITS_MAX:
        log.error("elevenlabs_daily_ceiling", spent=spent, asked=credits, ceiling=DAILY_CREDITS_MAX)
        raise ToolUnavailable("Hako's daily ElevenLabs budget is used up; it resets at 00:00 UTC")
    _spent[day] = spent + credits


def release(credits: int) -> None:
    """Give back a hold the provider never spent."""
    day = _today()
    _spent[day] = max(0, _spent.get(day, 0) - credits)


def record(headers: dict[str, str], estimate: int) -> None:
    """Settle the hold at what the call cost (the provider's header, else the estimate); log the alarm past 80 %."""
    cost = headers.get(COST_HEADER, "")
    credits = int(cost) if cost.isdigit() else estimate
    day = _today()
    _spent[day] = max(0, _spent.get(day, 0) + credits - estimate)
    if _spent[day] >= DAILY_CREDITS_MAX * ALARM_SHARE:
        log.warning("elevenlabs_spend_alarm", spent=_spent[day], ceiling=DAILY_CREDITS_MAX)


@contextmanager
def held(estimate: int) -> Iterator[None]:
    """Hold `estimate` credits around one generation call; give them back if ElevenLabs refused it."""
    reserve(estimate)
    try:
        yield
    except _REFUSED:
        release(estimate)
        raise
