"""Shared LI.FI Earn shapes: the chain input (any EVM chain Earn indexes) and the token a vault holds."""

import re
from typing import Annotated, Any

from pydantic import AfterValidator, Field

from hako_tools.connectors.chain_evm.networks import CHAIN_IDS, lookup
from hako_tools.framework import ToolOutput, to_float

_EIP155 = re.compile(r"^eip155:(\d+)$")
PERCENT = 100  # Earn reports APY as a fraction (0.0534 = 5.34 %, earn-openapi.yaml); cards show percent
APY_PLACES = 4


def _to_caip2(value: str) -> str:
    text = value.strip().lower()
    if _EIP155.match(text):
        return text
    found = lookup(text)
    if found is None:
        raise ValueError(f"unsupported chain {value!r}: Earn vaults are on EVM chains ({CHAIN_IDS}, or any "
                         "eip155:<id>)")
    return found.caip2


EarnChain = Annotated[str, AfterValidator(_to_caip2), Field(
    description="An EVM chain as CAIP-2 (eip155:8453 = Base, eip155:1 = Ethereum, eip155:42161 = Arbitrum…).")]


def chain_id(caip2: str) -> int:
    return int(caip2.split(":", 1)[1])


class EarnToken(ToolOutput):
    symbol: str
    address: str
    decimals: int
    name: str | None = None
    logo_url: str | None = None


def percent(fraction: Any) -> float | None:
    value = to_float(fraction)
    return round(value * PERCENT, APY_PLACES) if value is not None else None
