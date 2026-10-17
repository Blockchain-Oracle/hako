"""lifi-earn/vaults: where a token earns most, from LI.FI Earn's vault index (needs LIFI_API_KEY)."""

from enum import StrEnum
from typing import Any

from pydantic import Field

from hako_tools.connectors.lifi.earn import EarnChain, EarnToken, chain_id, percent
from hako_tools.connectors.lifi.provider import LIFI_EARN
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import (
    FREE,
    Category,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    to_float,
    tool,
)

# @hako/cards contract.config.ts: VAULTS_LIMIT_DEFAULT, VAULTS_LIMIT_MAX.
LIMIT_DEFAULT = 10
LIMIT_MAX = 50
TOKEN_MAX_CHARS = 64


class Sort(StrEnum):
    apy = "apy"
    tvl = "tvl"


class VaultsInput(ToolInput):
    chain: EarnChain | None = Field(default=None, description="Only vaults on this chain (CAIP-2).")
    token: str | None = Field(default=None, min_length=1, max_length=TOKEN_MAX_CHARS,
                              description="Underlying token by symbol or address ('USDC').")
    sort: Sort = Field(Sort.apy, description="apy (highest first) or tvl (largest first).")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)


class Vault(ToolOutput):
    address: str
    chain: str
    name: str
    protocol: str
    token: EarnToken
    apy: float = Field(description="Total APY now, in percent (4.2 = 4.2 %).")
    apy_base: float | None = None
    apy_reward: float | None = None
    apy_7d: float | None = Field(default=None, description="Trailing 7-day APY, percent.")
    tvl_usd: float | None = None
    url: str | None = None
    logo_url: str | None = None
    tags: list[str] | None = None
    deposit_only: bool | None = Field(default=None, description="True when LI.FI cannot withdraw from it.")


class VaultsOutput(ToolOutput):
    vaults: list[Vault]
    chain: str | None = None
    token: str | None = None


def _vault(row: dict[str, Any]) -> Vault | None:
    analytics = row.get("analytics") or {}
    apy = percent((analytics.get("apy") or {}).get("total"))
    underlying = (row.get("underlyingTokens") or [None])[0]
    if apy is None or not isinstance(underlying, dict):
        return None
    protocol = row.get("protocol") or {}
    return Vault(
        address=str(row["address"]), chain=f"eip155:{row['chainId']}", name=str(row.get("name") or row["address"]),
        protocol=str(protocol.get("name") or ""),
        token=EarnToken(symbol=str(underlying.get("symbol") or ""), address=str(underlying.get("address") or ""),
                        decimals=int(underlying.get("decimals") or 0)),
        apy=apy, apy_base=percent((analytics.get("apy") or {}).get("base")),
        apy_reward=percent((analytics.get("apy") or {}).get("reward")), apy_7d=percent(analytics.get("apy7d")),
        tvl_usd=to_float((analytics.get("tvl") or {}).get("usd")), url=protocol.get("url"),
        logo_url=protocol.get("logoUri"), tags=list(row.get("tags") or []) or None,
        deposit_only=row.get("isRedeemable") is False or None,
    )


@tool(
    provider=LIFI_EARN,
    slug="vaults",
    name="LI.FI Earn Vaults",
    summary="DeFi vaults where a token earns most (Morpho, Aave, Euler…): APY base and rewards, TVL, protocol.",
    description="Ranks the vaults LI.FI Earn indexes across EVM chains by APY or TVL, optionally for one chain and "
    "one underlying token ('USDC' on Base): vault and protocol, the token it holds, total APY now with its base and "
    "reward parts and the 7-day trailing APY (all in percent), TVL in USD, tags, and whether it is deposit-only. Only "
    "vaults LI.FI can deposit into are listed, so a row can be drafted with hako_draft_earn_deposit. For a wallet's "
    "open positions use lifi-earn/positions.",
    categories=(Category.crypto, Category.finance),
    render=Render.yield_,
    price=FREE,
    example={"chain": "eip155:8453", "token": "USDC", "sort": "apy", "limit": 5},
    see_also=("lifi-earn/positions", "defillama/protocol"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def vaults(inp: VaultsInput, ctx: RunContext) -> VaultsOutput:
    params: dict[str, Any] = {"sortBy": inp.sort.value, "limit": inp.limit, "isTransactional": "true"}
    if inp.chain:
        params["chainId"] = chain_id(inp.chain)
    if inp.token:
        params["asset"] = inp.token
    data = await ctx.get_json(LIFI_EARN, "/vaults", params=params)
    found = [v for v in (_vault(r) for r in (data or {}).get("data") or [] if isinstance(r, dict)) if v]
    if not found:
        raise ToolNotFoundResult("LI.FI Earn lists no vaults for this chain and token")
    return VaultsOutput(vaults=found, chain=inp.chain, token=inp.token)
