"""chain-solana/gas: priority fees right now, in micro-lamports per compute unit (Helius' estimate when its key is
set, else the percentiles of getRecentPrioritizationFees over the last 150 slots)."""

from statistics import quantiles

from pydantic import Field

from hako_tools.connectors.chain_evm.gas import GasLevel, GasOutput
from hako_tools.connectors.chain_solana.provider import CAIP2, CHAIN_SOLANA, HELIUS, SolanaAddress, SolanaChain
from hako_tools.connectors.chain_solana.rpc import batch
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, tool
from hako_tools.framework.errors import ProviderRateLimited, RunDeadlineExceeded, ToolUnavailable
from hako_tools.framework.jsonrpc import RpcError, batch_on

ACCOUNTS_MAX = 8
BASE_FEE_LAMPORTS = 5_000  # per signature, fixed by the protocol (solana.com/docs/core/fees)
# Helius' named levels, and the percentiles the public fallback reads for the same names.
HELIUS_LEVELS: tuple[tuple[str, str], ...] = (("low", "low"), ("medium", "medium"), ("high", "high"),
                                              ("very_high", "veryHigh"))
PERCENTILES: tuple[tuple[str, int], ...] = (("low", 25), ("medium", 50), ("high", 75), ("very_high", 95))
PERCENT = 100


class SolGasInput(ToolInput):
    chain: SolanaChain = CAIP2
    accounts: list[SolanaAddress] = Field(default_factory=list, max_length=ACCOUNTS_MAX,
                                          description="Writable accounts your transaction touches (a pool, a "
                                          "program's state): fees are local to the accounts in contention.")


async def _helius(ctx: RunContext, accounts: list[str]) -> list[GasLevel] | None:
    if not HELIUS.provider.available:
        return None
    options: dict[str, object] = {"options": {"includeAllPriorityFeeLevels": True}}
    if accounts:
        options["accountKeys"] = accounts
    try:
        (estimate,) = await batch_on(ctx, (HELIUS,), "Helius", [("getPriorityFeeEstimate", [options])])
    except (ProviderError, ProviderRateLimited, RunDeadlineExceeded, ToolUnavailable):
        return None
    levels = (estimate or {}).get("priorityFeeLevels") if isinstance(estimate, dict) else None
    if not isinstance(levels, dict):
        return None
    return [GasLevel(label=label, max_fee=float(levels[key]), priority_fee=float(levels[key]))
            for label, key in HELIUS_LEVELS if key in levels]


@tool(
    provider=CHAIN_SOLANA,
    slug="gas",
    name="Solana Priority Fees",
    summary="Solana priority fees right now (low, medium, high, very high) in micro-lamports per compute unit.",
    description="Priority fees on Solana mainnet in micro-lamports per compute unit: Helius' estimate when Hako's key "
    "is set, else the 25th/50th/75th/95th percentiles of fees paid over the last 150 slots "
    "(getRecentPrioritizationFees). "
    "Pass the writable accounts your transaction touches for a local estimate (fees rise on contended accounts). "
    "The base fee is a fixed 5,000 lamports per signature on top. For EVM gas use chain-evm/gas.",
    categories=(Category.crypto,),
    render=Render.gas,
    price=FREE,
    example={"chain": CAIP2},
    see_also=("chain-evm/gas", "chain-solana/tx"),
    cache_ttl_s=TTL_LIVE_S,
)
async def gas(inp: SolGasInput, ctx: RunContext) -> GasOutput:
    ctx.note(f"Plus the base fee: {BASE_FEE_LAMPORTS:,} lamports per signature.")
    helius = await _helius(ctx, inp.accounts)
    if helius:
        (slot,) = await batch(ctx, [("getSlot", [{"commitment": "confirmed"}])])
        block = slot if isinstance(slot, int) else None
        return GasOutput(chain=CAIP2, unit="micro_lamports", levels=helius, block_number=block)
    (recent,) = await batch(ctx, [("getRecentPrioritizationFees", [inp.accounts] if inp.accounts else [])])
    if isinstance(recent, RpcError) or not isinstance(recent, list) or not recent:
        raise ProviderError("Solana RPC did not report recent priority fees; retry shortly")
    fees = sorted(int(r.get("prioritizationFee") or 0) for r in recent if isinstance(r, dict))
    cuts = quantiles(fees, n=PERCENT, method="inclusive") if len(fees) > 1 else [float(fees[0])] * (PERCENT - 1)
    levels = [GasLevel(label=label, max_fee=float(cuts[p - 1]), priority_fee=float(cuts[p - 1]))
              for label, p in PERCENTILES]
    if not inp.accounts and not any(fees):
        ctx.note("No accounts given: these are network-wide minimums; pass the accounts your transaction writes for "
                 "a local estimate.")
    newest = max((int(r.get("slot") or 0) for r in recent if isinstance(r, dict)), default=None)
    return GasOutput(chain=CAIP2, unit="micro_lamports", levels=levels, block_number=newest)
