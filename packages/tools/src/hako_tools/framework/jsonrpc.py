"""JSON-RPC over a list of interchangeable upstreams (a chain's RPCs): one batch per round trip, the next upstream
when one fails or is rate limited, node errors kept apart from answers. Used by the chain connectors."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from hako_tools.framework.context import RunContext
from hako_tools.framework.errors import (
    ProviderError,
    ProviderRateLimited,
    RunDeadlineExceeded,
    ToolNotFoundResult,
    ToolUnavailable,
)
from hako_tools.framework.provider import Provider

# Below this much run time left, a fallback RPC cannot answer in time: report the failure instead.
RPC_MIN_REMAINING_S = 0.6
# Node trouble (rate limits, overload, internal errors), not the request's fault: worth asking the next RPC. Nodes
# disagree on codes (Base's public RPC answers "request limit reached" with its own), so the message decides too.
LIMIT_EXCEEDED_CODE = -32005
NODE_ERROR_WORDS = ("limit", "rate", "internal", "timeout", "busy", "capacity", "unavailable", "too many")
ERROR_DETAIL_CHARS = 200
ERROR_DETAILS_MAX = 2  # the last RPC's status line and its body: enough to act on, short enough for a card


@dataclass(frozen=True, slots=True)
class Rpc:
    """One RPC URL as an upstream: its own client, concurrency and cooldown (`path` is posted to)."""

    provider: Provider
    path: str


class RpcError(Exception):
    """A JSON-RPC error object (`{"code", "message"}`): the node answered, and the answer is an error."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def _node_trouble(err: RpcError) -> bool:
    text = err.message.lower()
    return err.code == LIMIT_EXCEEDED_CODE or any(word in text for word in NODE_ERROR_WORDS)


def _results(answer: list[Any], count: int) -> list[Any]:
    by_id = {item.get("id"): item for item in answer if isinstance(item, dict)}
    out: list[Any] = []
    for i in range(count):
        item = by_id.get(i) or {}
        err = item.get("error")
        out.append(RpcError(int(err.get("code", 0)), str(err.get("message", "")), err.get("data"))
                   if isinstance(err, dict) else item.get("result"))
    return out


async def batch_on(ctx: RunContext, upstreams: tuple[Rpc, ...], label: str,
                   calls: list[tuple[str, Any]]) -> list[Any]:
    """Run `calls` as one JSON-RPC batch on the first upstream that answers; each result in order, or an
    `RpcError` in its place. `label` names the chain in the error when none answers."""
    payload = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    last: Exception | None = None
    for rpc in upstreams:
        if ctx.deadline.remaining() < RPC_MIN_REMAINING_S:
            break
        try:
            answer = await ctx.post_json(rpc.provider, rpc.path, json=payload)
        except (ProviderError, ProviderRateLimited, RunDeadlineExceeded, ToolNotFoundResult, ToolUnavailable) as exc:
            last = exc
            continue
        if not isinstance(answer, list) or len(answer) != len(calls):
            last = ProviderError(f"{rpc.provider.display_name} did not answer the batch")
            continue
        out = _results(answer, len(calls))
        if all(isinstance(r, RpcError) and _node_trouble(r) for r in out):
            last = ProviderError(f"{rpc.provider.display_name}: {out[0]}")
            continue
        return out
    if isinstance(last, RunDeadlineExceeded | ProviderRateLimited):
        raise last
    detail = str(getattr(last, "message", last))[:ERROR_DETAIL_CHARS] if last else ""
    # Keep the upstream's own body (ctx._check puts it in details): "ranges over 10000 blocks are not supported" tells
    # the caller what to change, where the status line alone reads as an outage.
    upstream: list[str] = list(getattr(last, "details", None) or [])
    raise ProviderError(f"No {label} RPC answered right now; retry shortly",
                        details=[d for d in [detail, *upstream] if d][:ERROR_DETAILS_MAX])


def units(atomic: int, decimals: int) -> str:
    """Exact token units from atomic units ("1.25"), never rounded, no exponent."""
    if decimals == 0:
        return str(atomic)
    text = format(Decimal(atomic).scaleb(-decimals), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text
