"""Parallel upstream calls under a deadline, collecting partial results (never a TaskGroup)."""

import asyncio
from collections.abc import Awaitable, Iterable, Mapping
from dataclasses import dataclass, field

from hako_core.deadline import Deadline

DEADLINE_EXCEEDED = "deadline_exceeded"


@dataclass(slots=True)
class FanOutResult[T]:
    ok: dict[str, T] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)  # name -> safe reason word


async def fan_out[T](named: Mapping[str, Awaitable[T]], deadline: Deadline) -> FanOutResult[T]:
    """Run every awaitable concurrently; cancel whatever is still pending at the deadline."""
    result: FanOutResult[T] = FanOutResult()
    if not named:
        return result
    tasks = {asyncio.ensure_future(coro): name for name, coro in named.items()}
    done, pending = await asyncio.wait(tasks, timeout=deadline.remaining())
    for task in pending:
        task.cancel()
        result.failed[tasks[task]] = DEADLINE_EXCEEDED
    for task in done:
        name = tasks[task]
        if task.cancelled():
            result.failed[name] = DEADLINE_EXCEEDED
        elif (exc := task.exception()) is not None:
            result.failed[name] = getattr(exc, "kind", type(exc).__name__.lower())
        else:
            result.ok[name] = task.result()
    return result


async def gather_limited[T](aws: Iterable[Awaitable[T]], limit: int) -> list[T | BaseException]:
    """Like gather(return_exceptions=True) but with at most `limit` in flight."""
    gate = asyncio.Semaphore(limit)

    async def run(aw: Awaitable[T]) -> T:
        async with gate:
            return await aw

    return await asyncio.gather(*(run(aw) for aw in aws), return_exceptions=True)
