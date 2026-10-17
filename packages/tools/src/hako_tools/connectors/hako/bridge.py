"""Bridge from the live-facts library (hako_now) to the tool engine.

hako_now services raise hako_core errors and return `(results, sources, unavailable[, notes])`. Here those
errors become the engine's run outcomes (a missing place or entity is a not-found answer, a bad argument is
invalid input, an upstream that did not answer is a provider error), and sources, notes and unavailable sources
reach the envelope. The services read the run's deadline from the ContextVar the engine sets.
"""

from collections.abc import Awaitable, Callable, Iterable

import anyio

from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.errors import HakoError, UpstreamFailure
from hako_tools.framework import ProviderError, RunContext, ToolNotFoundResult
from hako_tools.framework.errors import InvalidToolInput, ProviderRateLimited, RunDeadlineExceeded

# hako_now reports "that does not exist" as invalid input; these phrases mark the not-found answers among them.
NOT_FOUND_MARKS = (
    "No place called",
    "No time zone found for",
    "Nothing on Wikidata is called",
    "No Wikidata property matches",
    "does not exist on Wikidata",
    "No central bank publishes",
    "No holiday calendar for",
)
_DEADLINE = "deadline_exceeded"


def _upstream(failure: UpstreamFailure) -> Exception:
    if failure.kind == _DEADLINE:
        return RunDeadlineExceeded(f"{failure.name} did not answer within the deadline")
    if failure.kind == SourceStatus.rate_limited:
        return ProviderRateLimited(f"{failure.name} is rate limiting Hako; retry shortly")
    return ProviderError(f"{failure.name} is unavailable right now; retry shortly")


def _translate(exc: HakoError | UpstreamFailure) -> Exception:
    if isinstance(exc, UpstreamFailure):
        return _upstream(exc)
    if isinstance(exc.__cause__, UpstreamFailure):  # "Could not look up …", "Wikidata is not answering …"
        return ProviderError(exc.message, details=exc.details)
    if any(mark in exc.message for mark in NOT_FOUND_MARKS):
        return ToolNotFoundResult(exc.message)
    return InvalidToolInput(exc.message, details=exc.details)


async def call_now[T](call: Awaitable[T]) -> T:
    """Await an async hako_now service, mapping its errors onto the engine's."""
    try:
        return await call
    except (HakoError, UpstreamFailure) as exc:
        raise _translate(exc) from exc


async def call_now_sync[A, T](fn: Callable[[A], T], arg: A) -> T:
    """Run a synchronous hako_now service (SQLite index, calendar walk) off the event loop."""
    try:
        return await anyio.to_thread.run_sync(fn, arg)
    except (HakoError, UpstreamFailure) as exc:
        raise _translate(exc) from exc


def report(ctx: RunContext, sources: Iterable[SourceRef], unavailable: Iterable[str] = (),
           notes: Iterable[str] = ()) -> list[str]:
    """Add the service's sources and notes to the run; returns the unavailable source names for the output."""
    ctx.sources.extend(sources)
    for text in notes:
        ctx.note(text)
    missing = list(dict.fromkeys(unavailable))
    if missing:
        ctx.note(f"Unavailable right now: {', '.join(missing)}.")
    return missing
