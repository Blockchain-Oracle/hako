"""/fx request and result."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from hako_now.constants import CURRENCY_CODE_LEN, FX_MAX_QUOTES
from hako_now.provenance import Freshness, Provenance

CURRENCY_PATTERN = f"^[A-Za-z]{{{CURRENCY_CODE_LEN}}}$"
CurrencyCode = Annotated[
    str,
    Field(
        min_length=CURRENCY_CODE_LEN,
        max_length=CURRENCY_CODE_LEN,
        pattern=CURRENCY_PATTERN,
        description="ISO 4217, e.g. USD",
    ),
]


class FxRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"base": "USD", "quotes": ["EUR", "JPY"], "amount": 1000}]}
    )

    base: CurrencyCode
    quotes: list[CurrencyCode] = Field(min_length=1, max_length=FX_MAX_QUOTES)
    amount: float | None = Field(default=None, gt=0)
    date: dt.date | None = Field(default=None, description="Historical date (default: latest)")

    @field_validator("base")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("quotes")
    @classmethod
    def _uppers(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(q.upper() for q in v))


class ProviderRate(BaseModel):
    provider: str
    name: str
    rate: float
    date: str
    rate_type: str | None = None
    issuer: bool = False  # the quote currency's own central bank (its fixing is the headline rate)
    cadence: str | None = None
    freshness: Freshness
    business_days_old: int


class FxResult(BaseModel):
    kind: Literal["fx_rate"] = "fx_rate"
    base: str
    quote: str
    rate: float  # the issuer's fixing when current, else the median of current fixings
    date: str  # newest provider date
    amount: float | None = None
    converted: float | None = None
    providers: list[ProviderRate]
    provenance: Provenance
