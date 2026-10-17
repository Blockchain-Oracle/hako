"""JSON-RPC over a chain's public RPCs: one batch per round trip, the next RPC when one fails, typed errors."""

from decimal import Decimal
from typing import Annotated, Any

from eth_utils.address import to_checksum_address
from pydantic import AfterValidator, Field

from hako_tools.connectors.chain_evm.networks import RPCS, EvmNetwork
from hako_tools.framework import ProviderError, RunContext, ToolNotFoundResult
from hako_tools.framework.errors import ProviderRateLimited, RunDeadlineExceeded

ADDRESS_PATTERN = r"^0x[0-9a-fA-F]{40}$"
TX_HASH_PATTERN = r"^0x[0-9a-fA-F]{64}$"
HEX_BASE = 16
# Below this much run time left, a fallback RPC cannot answer in time: report the failure instead.
RPC_MIN_REMAINING_S = 0.6
GWEI_DECIMALS = 9
# Node trouble (rate limits, overload, internal errors), not the request's fault: worth asking the next RPC. Nodes
# disagree on codes (Base's public RPC answers "request limit reached" with its own), so the message decides too.
LIMIT_EXCEEDED_CODE = -32005
NODE_ERROR_WORDS = ("limit", "rate", "internal", "timeout", "busy", "capacity", "unavailable", "too many")


class RpcError(Exception):
    """A JSON-RPC error object (`{"code", "message"}`): the node answered, and the answer is an error."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def _checksum(value: str) -> str:
    return to_checksum_address(value)


EvmAddress = Annotated[str, Field(pattern=ADDRESS_PATTERN), AfterValidator(_checksum)]
TxHash = Annotated[str, Field(pattern=TX_HASH_PATTERN), AfterValidator(str.lower)]


async def batch(ctx: RunContext, net: EvmNetwork, calls: list[tuple[str, list[Any]]]) -> list[Any]:
    """Run `calls` as one JSON-RPC batch; each result in order, or an `RpcError` in its place."""
    payload = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    last: Exception | None = None
    for rpc in RPCS[net.caip2]:
        if ctx.deadline.remaining() < RPC_MIN_REMAINING_S:
            break
        try:
            answer = await ctx.post_json(rpc.provider, rpc.path, json=payload)
        except (ProviderError, ProviderRateLimited, RunDeadlineExceeded, ToolNotFoundResult) as exc:
            last = exc
            continue
        if not isinstance(answer, list) or len(answer) != len(calls):
            last = ProviderError(f"{rpc.provider.display_name} did not answer the batch")
            continue
        by_id = {item.get("id"): item for item in answer if isinstance(item, dict)}
        out: list[Any] = []
        for i in range(len(calls)):
            item = by_id.get(i) or {}
            err = item.get("error")
            out.append(RpcError(int(err.get("code", 0)), str(err.get("message", "")), err.get("data"))
                       if isinstance(err, dict) else item.get("result"))
        if all(isinstance(r, RpcError) and _node_trouble(r) for r in out):
            last = ProviderError(f"{rpc.provider.display_name}: {out[0]}")
            continue
        return out
    if isinstance(last, RunDeadlineExceeded | ProviderRateLimited):
        raise last
    raise ProviderError(f"No {net.name} RPC answered right now; retry shortly",
                        details=[str(getattr(last, "message", last))[:200]] if last else [])


async def call(ctx: RunContext, net: EvmNetwork, method: str, params: list[Any]) -> Any:
    """One JSON-RPC call; an error object raises `RpcError`."""
    (result,) = await batch(ctx, net, [(method, params)])
    if isinstance(result, RpcError):
        raise result
    return result


def _node_trouble(err: RpcError) -> bool:
    """Errors about the node, not the request (rate limits, internal errors): worth asking the next RPC."""
    text = err.message.lower()
    return err.code == LIMIT_EXCEEDED_CODE or any(word in text for word in NODE_ERROR_WORDS)


def hex_int(value: Any) -> int:
    return int(str(value), HEX_BASE) if value not in (None, "0x") else 0


def block_tag(block: int | str | None) -> str:
    return hex(block) if isinstance(block, int) else "latest"


def units(atomic: int, decimals: int) -> str:
    """Exact token units from atomic units ("1.25"), never rounded, no exponent."""
    if decimals == 0:
        return str(atomic)
    text = format(Decimal(atomic).scaleb(-decimals), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def gwei(wei: int) -> float:
    return float(Decimal(wei).scaleb(-GWEI_DECIMALS))
