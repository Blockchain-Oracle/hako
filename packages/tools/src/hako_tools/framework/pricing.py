"""Per-endpoint price card: one USD amount per call, settled in USDC atomic units."""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from hako_tools.constants import (
    PAYMENT_NETWORK,
    PRICE_LOCAL_USD,
    PRICE_PREMIUM_USD,
    PRICE_STANDARD_USD,
    USDC_DECIMALS,
)

_ATOMIC_PER_USD = Decimal(10) ** USDC_DECIMALS


class PriceTier(StrEnum):
    local = "local"
    standard = "standard"
    premium = "premium"


_TIER_USD = {
    PriceTier.local: PRICE_LOCAL_USD,
    PriceTier.standard: PRICE_STANDARD_USD,
    PriceTier.premium: PRICE_PREMIUM_USD,
}


@dataclass(frozen=True, slots=True)
class Price:
    tier: PriceTier

    @property
    def usd(self) -> str:
        return _TIER_USD[self.tier]

    @property
    def atomic(self) -> int:
        return int(Decimal(self.usd) * _ATOMIC_PER_USD)

    def doc(self) -> dict[str, str]:
        return {"usd": self.usd, "atomic": str(self.atomic), "tier": self.tier, "network": PAYMENT_NETWORK}


LOCAL = Price(PriceTier.local)
STANDARD = Price(PriceTier.standard)
PREMIUM = Price(PriceTier.premium)
