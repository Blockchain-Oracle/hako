"""chain-evm/block: one block (the head by default): number, hash, time, transactions, gas and base fee."""

from datetime import UTC, datetime
from typing import Literal

from eth_utils.address import to_checksum_address
from pydantic import Field

from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import block_tag, call, gwei, hex_int
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool


class BlockInput(ToolInput):
    chain: EvmChain
    block: int | Literal["latest"] = Field("latest", description="A block number, or 'latest' for the chain head.")


class BlockOutput(ToolOutput):
    chain: str
    number: int
    hash: str
    timestamp: str
    tx_count: int
    gas_used: str | None = None
    gas_limit: str | None = None
    base_fee_gwei: float | None = None
    miner: str | None = Field(default=None, description="Fee recipient (the sequencer on rollups).")
    explorer_url: str | None = None


@tool(
    provider=CHAIN_EVM,
    slug="block",
    name="EVM Block",
    summary="A block on Base, Ethereum, Arbitrum, OP or Polygon: number, hash, time, transaction count, gas, base fee.",
    description="Reads one block from a public RPC, the chain head by default or any block number: its number, hash, "
    "UTC time, how many transactions it holds, gas used and limit, the base fee in gwei and the fee recipient, with "
    "the explorer link. Use it for 'what block are we on' or 'when was block N'. It does not list the "
    "transactions (look one up with chain-evm/tx) and Solana has no equivalent here.",
    categories=(Category.crypto,),
    render=Render.block,
    price=FREE,
    example={"chain": "eip155:1"},
    see_also=("chain-evm/gas", "chain-evm/tx"),
    cache_ttl_s=TTL_LIVE_S,
)
async def block(inp: BlockInput, ctx: RunContext) -> BlockOutput:
    net = network(inp.chain)
    found = await call(ctx, net, "eth_getBlockByNumber", [block_tag(inp.block), False])
    if not found:
        raise ToolNotFoundResult(f"{net.name} has no block {inp.block} yet")
    number = hex_int(found["number"])
    base_fee = found.get("baseFeePerGas")
    return BlockOutput(
        chain=net.caip2, number=number, hash=found["hash"],
        timestamp=datetime.fromtimestamp(hex_int(found["timestamp"]), UTC).isoformat(timespec="seconds"),
        tx_count=len(found.get("transactions") or []), gas_used=str(hex_int(found.get("gasUsed"))),
        gas_limit=str(hex_int(found.get("gasLimit"))), base_fee_gwei=gwei(hex_int(base_fee)) if base_fee else None,
        miner=to_checksum_address(found["miner"]) if found.get("miner") else None, explorer_url=net.block_url(number),
    )
