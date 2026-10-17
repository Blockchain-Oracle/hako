"""Agreement between independent numeric sources: median, spread, and an agree/minor/conflict label."""

import statistics
from dataclasses import dataclass

from hako_core.contract.enums import Agreement

PERCENT = 100.0


@dataclass(frozen=True, slots=True)
class Consensus:
    value: float
    spread_pct: float | None
    agreement: Agreement


def numeric(values: list[float], agree_pct: float, minor_pct: float) -> Consensus:
    """Spread is (max − min) / median in percent; one value is single_source."""
    median = statistics.median(values)
    if len(values) < 2:  # noqa: PLR2004 (agreement needs two sources)
        return Consensus(median, None, Agreement.single_source)
    spread = (max(values) - min(values)) / median * PERCENT if median else 0.0
    agreement = (
        Agreement.agree if spread <= agree_pct else Agreement.minor_diff if spread <= minor_pct else Agreement.conflict
    )
    return Consensus(median, round(spread, 4), agreement)
