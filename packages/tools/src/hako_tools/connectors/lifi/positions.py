"""lifi-earn/positions: a wallet's open DeFi positions across chains, from LI.FI Earn (needs LIFI_API_KEY)."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.chain_evm.rpc import EvmAddress
from hako_tools.connectors.lifi.earn import EarnChain, EarnToken
from hako_tools.connectors.lifi.provider import LIFI_EARN
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import (
    FREE,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolOutput,
    to_float,
    tool,
)

# The page size the OpenAPI document allows at most (earn.li.fi/docs-json, /v1/portfolio/{userAddress}/positions,
# 2026-10-17): one page holds a whole ordinary wallet, and nextCursor continues past it.
POSITIONS_PAGE_MAX = 500
# Below this much run time left, another page cannot come back in time: answer with the pages read, and say so.
PAGE_MIN_REMAINING_S = 1.0


class PositionsInput(ToolInput):
    address: EvmAddress = Field(description="The wallet (0x address).")
    chain: EarnChain | None = Field(default=None, description="Only positions on this chain (CAIP-2).")


class PositionVault(ToolOutput):
    address: str
    name: str
    protocol: str | None = None


class Position(ToolOutput):
    chain: str
    vault: PositionVault
    token: EarnToken = Field(description="The token representing the position (a vault share or yield token).")
    amount_atomic: str
    usd: float | None = None


class PositionsOutput(ToolOutput):
    address: str
    positions: list[Position]


def _position(row: dict[str, Any]) -> Position | None:
    asset = row.get("asset") or {}
    amount = str(row.get("balanceNative") or "")
    if not asset.get("address") or not amount.isdigit():
        return None
    token = EarnToken(symbol=str(asset.get("symbol") or ""), address=str(asset["address"]),
                      decimals=int(asset.get("decimals") or 0), name=asset.get("name"))
    return Position(
        chain=f"eip155:{row['chainId']}",
        vault=PositionVault(address=str(row.get("address") or asset["address"]),
                            name=str(asset.get("name") or asset.get("symbol") or ""), protocol=row.get("protocolName")),
        token=token, amount_atomic=amount, usd=to_float(row.get("balanceUsd")),
    )


@tool(
    provider=LIFI_EARN,
    slug="positions",
    name="LI.FI Earn Positions",
    summary="A wallet's open DeFi positions (lending, vaults) across EVM chains, with balances and USD values.",
    description="Reads LI.FI Earn's portfolio for one wallet: every active position it indexes (Aave, Morpho and "
    "other vaults) with the chain, the vault and protocol, the position token, the exact balance in atomic units "
    "and its USD value. Filter to one chain with chain. Use it before a withdraw (hako_draft_earn_withdraw) or to "
    "show what is earning. For vaults to deposit into use lifi-earn/vaults.",
    categories=(Category.crypto, Category.finance),
    render=Render.positions,
    price=FREE,
    example={"address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"},
    see_also=("lifi-earn/vaults", "chain-evm/balance"),
    cache_ttl_s=TTL_LIVE_S,
)
async def positions(inp: PositionsInput, ctx: RunContext) -> PositionsOutput:
    rows: list[Position] = []
    params: dict[str, Any] = {"limit": POSITIONS_PAGE_MAX}
    while True:
        data = await ctx.get_json(LIFI_EARN, f"/portfolio/{inp.address}/positions", params=params)
        if not isinstance(data, dict):
            raise ProviderError("LI.FI Earn answered the portfolio in a shape Hako cannot read")
        # The OpenAPI document pages rows under `data`; the prose guide shows `positions`. Read either.
        page = data.get("data") or data.get("positions") or []
        rows += [p for p in (_position(r) for r in page if isinstance(r, dict)) if p]
        cursor = data.get("nextCursor")
        if not cursor:
            break
        if ctx.deadline.remaining() < PAGE_MIN_REMAINING_S:
            ctx.note(f"LI.FI Earn has more positions than fit in the time; only the first {len(rows)} were read.")
            break
        params = {"limit": POSITIONS_PAGE_MAX, "cursor": cursor}
    if inp.chain:
        rows = [p for p in rows if p.chain == inp.chain]
    if not rows:
        ctx.note("No open positions LI.FI Earn indexes for this wallet" + (f" on {inp.chain}." if inp.chain else "."))
    return PositionsOutput(address=inp.address, positions=rows)
