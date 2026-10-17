"""Per-endpoint price card: one USD amount per call, settled in USDC atomic units."""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from hako_tools.constants import (
    PAYMENT_NETWORK,
    PRICE_FREE_USD,
    PRICE_LOCAL_USD,
    PRICE_MEDIA_LARGE_USD,
    PRICE_MEDIA_MEDIUM_USD,
    PRICE_MEDIA_SMALL_USD,
    PRICE_PREMIUM_USD,
    PRICE_STANDARD_USD,
    USDC_DECIMALS,
)

_ATOMIC_PER_USD = Decimal(10) ** USDC_DECIMALS


class PriceTier(StrEnum):
    free = "free"  # a free read: the gateway serves it on /v1 and never sells it on /v2
    local = "local"
    standard = "standard"
    premium = "premium"
    media_small = "media-small"
    media_medium = "media-medium"
    media_large = "media-large"


_TIER_USD = {
    PriceTier.free: PRICE_FREE_USD,
    PriceTier.local: PRICE_LOCAL_USD,
    PriceTier.standard: PRICE_STANDARD_USD,
    PriceTier.premium: PRICE_PREMIUM_USD,
    PriceTier.media_small: PRICE_MEDIA_SMALL_USD,
    PriceTier.media_medium: PRICE_MEDIA_MEDIUM_USD,
    PriceTier.media_large: PRICE_MEDIA_LARGE_USD,
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

    @property
    def free(self) -> bool:
        return self.tier is PriceTier.free

    def doc(self) -> dict[str, str]:
        return {"usd": self.usd, "atomic": str(self.atomic), "tier": self.tier, "network": PAYMENT_NETWORK}


FREE = Price(PriceTier.free)
LOCAL = Price(PriceTier.local)
STANDARD = Price(PriceTier.standard)
PREMIUM = Price(PriceTier.premium)
MEDIA_SMALL = Price(PriceTier.media_small)
MEDIA_MEDIUM = Price(PriceTier.media_medium)
MEDIA_LARGE = Price(PriceTier.media_large)
