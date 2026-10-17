"""R18 provider-spend ceiling for ElevenLabs: a daily credit budget checked before every generation, an alarm in
the logs past 80 %, and the credits each call really cost (ElevenLabs' `character-cost` header) counted after it.

The count lives in this process: hako-api runs one worker (services/api/Dockerfile), so it is the whole server's.
"""

from datetime import UTC, datetime

import structlog

from hako_tools.framework.errors import ToolUnavailable

log = structlog.get_logger(__name__)

# The account has ~140k credits a month (Starter + rollover, 2026-10-17): one day may spend at most 15k of them.
DAILY_CREDITS_MAX = 15_000
ALARM_SHARE = 0.8
COST_HEADER = "character-cost"
_spent: dict[str, int] = {}


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def reserve(credits: int) -> None:
    """Refuse (503, nothing is charged) when this generation would pass today's ceiling."""
    spent = _spent.get(_today(), 0)
    if spent + credits > DAILY_CREDITS_MAX:
        log.error("elevenlabs_daily_ceiling", spent=spent, asked=credits, ceiling=DAILY_CREDITS_MAX)
        raise ToolUnavailable("Hako's daily ElevenLabs budget is used up; it resets at 00:00 UTC")


def record(headers: dict[str, str], estimate: int) -> None:
    """Count what the call cost (the provider's header, else the estimate); log the alarm past 80 %."""
    cost = headers.get(COST_HEADER, "")
    credits = int(cost) if cost.isdigit() else estimate
    day = _today()
    for old in [d for d in _spent if d != day]:
        del _spent[old]
    _spent[day] = _spent.get(day, 0) + credits
    if _spent[day] >= DAILY_CREDITS_MAX * ALARM_SHARE:
        log.warning("elevenlabs_spend_alarm", spent=_spent[day], ceiling=DAILY_CREDITS_MAX)
