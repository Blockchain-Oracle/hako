"""One token's facts from LI.FI's token list (`GET /token`): how the chain reads resolve "USDT" to an address and
add a logo, a USD price and LI.FI's verification to what the chain itself says."""

from dataclasses import dataclass

from hako_tools.connectors.lifi.provider import LIFI
from hako_tools.framework import ProviderError, RunContext, ToolNotFoundResult, to_float

_HTTP_BAD_REQUEST = "HTTP 400"  # LI.FI answers an unknown symbol or address with 400 (code 1011), not 404
VERIFIED = "verified"


@dataclass(frozen=True, slots=True)
class LifiToken:
    address: str
    symbol: str
    name: str
    decimals: int
    logo_url: str | None
    price_usd: float | None
    verified: bool | None


async def lifi_token(ctx: RunContext, chain: int | str, token: str) -> LifiToken | None:
    """The token LI.FI lists under `token` (symbol or address) on `chain` (LI.FI chain id), or None when unknown."""
    try:
        data = await ctx.get_json(LIFI, "/token", params={"chain": chain, "token": token})
    except ToolNotFoundResult:
        return None
    except ProviderError as exc:
        if _HTTP_BAD_REQUEST in exc.message:
            return None
        raise
    if not isinstance(data, dict) or not data.get("address"):
        return None
    status = data.get("verificationStatus")
    return LifiToken(
        address=str(data["address"]), symbol=str(data.get("symbol") or ""), name=str(data.get("name") or ""),
        decimals=int(data.get("decimals") or 0), logo_url=data.get("logoURI") or None,
        price_usd=to_float(data.get("priceUSD")), verified=(status == VERIFIED) if status else None,
    )
