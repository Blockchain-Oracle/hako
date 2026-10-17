"""Per-request deadline carried in a ContextVar so every upstream call can budget itself."""

import time
from contextvars import ContextVar
from dataclasses import dataclass, field

from hako_core.constants.deadlines import DEADLINE_SAFETY_MARGIN_S

_MS_PER_S = 1000


@dataclass(frozen=True, slots=True)
class Deadline:
    budget_s: float
    started: float = field(default_factory=time.monotonic)

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    def remaining(self) -> float:
        return max(0.0, self.budget_s - self.elapsed())

    def for_call(self, cap_s: float) -> float:
        """Timeout for one upstream call: its own cap, bounded by what is left minus the safety margin."""
        return max(0.0, min(cap_s, self.remaining() - DEADLINE_SAFETY_MARGIN_S))

    @property
    def budget_ms(self) -> int:
        return round(self.budget_s * _MS_PER_S)

    def elapsed_ms(self) -> int:
        return round(self.elapsed() * _MS_PER_S)


_current: ContextVar[Deadline | None] = ContextVar("hako_deadline", default=None)


def set_deadline(deadline: Deadline) -> None:
    _current.set(deadline)


def current_deadline(default_budget_s: float) -> Deadline:
    """The request's deadline, or a fresh one (e.g. in worker jobs)."""
    return _current.get() or Deadline(default_budget_s)
