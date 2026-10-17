"""chain-evm/gas: EIP-1559 fees right now (next block's base fee and slow / standard / fast tips) in gwei."""

from statistics import median

from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import RpcError, batch, gwei, hex_int
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool

FEE_HISTORY_BLOCKS = 10  # tips over the last 10 blocks: recent enough to be current, enough to smooth one outlier
# (label, reward percentile): what the cheapest quarter, the median and the top tenth of recent payers tipped.
LEVELS: tuple[tuple[str, int], ...] = (("slow", 25), ("standard", 50), ("fast", 90))
# @hako/config BASE_FEE_MULTIPLIER (fees.ts): a max fee of 2 × base + tip survives the base fee doubling, which is
# what /v1/broadcast prices wallet-sign requests with (plan B13).
BASE_FEE_MULTIPLIER = 2


class GasInput(ToolInput):
    chain: EvmChain


class GasLevel(ToolOutput):
    label: str
    max_fee: float
    priority_fee: float | None = None


class GasOutput(ToolOutput):
    chain: str
    unit: str = "gwei"
    levels: list[GasLevel]
    base_fee: float | None = None
    block_number: int | None = None


@tool(
    provider=CHAIN_EVM,
    slug="gas",
    name="EVM Gas Prices",
    summary="Gas right now on Base, Ethereum, Arbitrum, OP or Polygon: next base fee and slow, standard, fast tips.",
    description="Reads eth_feeHistory over the last 10 blocks from a public RPC and returns, in gwei, the next "
    "block's base fee and three levels (slow, standard, fast = the 25th, 50th and 90th percentile tips paid "
    "recently), each with a max fee of 2 × base fee + tip, the same rule Hako's broadcaster prices transactions "
    "with. No USD estimate (that needs the coin's price: coingecko/price). For Solana priority fees use "
    "chain-solana/gas.",
    categories=(Category.crypto,),
    render=Render.gas,
    price=FREE,
    example={"chain": "eip155:8453"},
    see_also=("chain-evm/block", "chain-solana/gas"),
    cache_ttl_s=TTL_LIVE_S,
)
async def gas(inp: GasInput, ctx: RunContext) -> GasOutput:
    net = network(inp.chain)
    history, price = await batch(ctx, net, [
        ("eth_feeHistory", [hex(FEE_HISTORY_BLOCKS), "latest", [p for _, p in LEVELS]]), ("eth_gasPrice", [])])
    if isinstance(history, RpcError) or not history or not history.get("baseFeePerGas"):
        if isinstance(price, RpcError) or price is None:
            raise ProviderError(f"{net.name} RPC did not report fees right now; retry shortly")
        legacy = gwei(hex_int(price))
        ctx.note(f"{net.name} RPC has no fee history; this is the single legacy gas price.")
        return GasOutput(chain=net.caip2, levels=[GasLevel(label="standard", max_fee=legacy)])
    next_base = hex_int(history["baseFeePerGas"][-1])
    rewards = [[hex_int(v) for v in row] for row in history.get("reward") or [] if row]
    levels: list[GasLevel] = []
    for i, (label, _) in enumerate(LEVELS):
        tip = round(median(row[i] for row in rewards)) if rewards else 0
        levels.append(GasLevel(label=label, max_fee=gwei(BASE_FEE_MULTIPLIER * next_base + tip),
                               priority_fee=gwei(tip)))
    newest = hex_int(history["oldestBlock"]) + len(history["baseFeePerGas"]) - 2
    return GasOutput(chain=net.caip2, levels=levels, base_fee=gwei(next_base), block_number=newest)
