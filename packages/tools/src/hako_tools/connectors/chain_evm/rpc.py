"""EVM JSON-RPC on a chain's public RPCs (framework.jsonrpc does the batching and failover), plus EVM value types."""

from decimal import Decimal
from typing import Annotated, Any

from eth_utils.address import to_checksum_address
from pydantic import AfterValidator, Field

from hako_tools.connectors.chain_evm.networks import RPCS, EvmNetwork
from hako_tools.framework import RunContext
from hako_tools.framework.jsonrpc import RpcError, batch_on, units

__all__ = ["RpcError", "units"]

ADDRESS_PATTERN = r"^0x[0-9a-fA-F]{40}$"
TX_HASH_PATTERN = r"^0x[0-9a-fA-F]{64}$"
HEX_BASE = 16
GWEI_DECIMALS = 9


def _checksum(value: str) -> str:
    return to_checksum_address(value)


EvmAddress = Annotated[str, Field(pattern=ADDRESS_PATTERN), AfterValidator(_checksum)]
TxHash = Annotated[str, Field(pattern=TX_HASH_PATTERN), AfterValidator(str.lower)]


async def batch(ctx: RunContext, net: EvmNetwork, calls: list[tuple[str, list[Any]]]) -> list[Any]:
    """Run `calls` as one JSON-RPC batch; each result in order, or an `RpcError` in its place."""
    return await batch_on(ctx, RPCS[net.caip2], net.name, calls)


async def call(ctx: RunContext, net: EvmNetwork, method: str, params: list[Any]) -> Any:
    """One JSON-RPC call; an error object raises `RpcError`."""
    (result,) = await batch(ctx, net, [(method, params)])
    if isinstance(result, RpcError):
        raise result
    return result


def hex_int(value: Any) -> int:
    return int(str(value), HEX_BASE) if value not in (None, "0x") else 0


def block_tag(block: int | str | None) -> str:
    return hex(block) if isinstance(block, int) else "latest"


def gwei(wei: int) -> float:
    return float(Decimal(wei).scaleb(-GWEI_DECIMALS))
