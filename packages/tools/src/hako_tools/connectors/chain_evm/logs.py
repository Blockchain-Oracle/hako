"""chain-evm/logs: event logs in a block range (eth_getLogs), decoded when the event signature is given."""

from typing import Annotated, Any, Literal, Self

from eth_abi.exceptions import DecodingError
from eth_utils.address import to_checksum_address
from pydantic import Field, model_validator

from hako_tools.connectors.chain_evm.abi import SIGNATURE_MAX_CHARS, Signature, SignatureError, decode_values, parse
from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import EvmAddress, RpcError, batch, hex_int
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool
from hako_tools.framework.errors import InvalidToolInput
from hako_tools.framework.jsonrpc import ERROR_DETAIL_CHARS

# @hako/cards LOGS_MAX_ROWS (contract.config.ts): one card shows at most 200 logs.
LOGS_MAX_ROWS = 200
# Public RPCs refuse wider eth_getLogs ranges (drpc's free tier and Base's public RPC cap at 10,000 blocks).
LOGS_MAX_BLOCK_RANGE = 10_000
TOPICS_MAX = 4
TOPIC_PATTERN = r"^0x[0-9a-fA-F]{64}$"
_DYNAMIC = frozenset({"string", "bytes"})  # indexed dynamic values are stored as their hash: kept as the raw topic
Topic = Annotated[str, Field(pattern=TOPIC_PATTERN)]


class LogsInput(ToolInput):
    chain: EvmChain
    address: EvmAddress | None = Field(default=None, description="Only logs emitted by this contract.")
    event: str | None = Field(default=None, min_length=3, max_length=SIGNATURE_MAX_CHARS,
                              description="The event's signature, e.g. 'Transfer(address indexed from, address "
                              "indexed to, uint256 value)': filters on it and decodes each log's arguments.")
    topics: list[Topic | None] | None = Field(default=None, max_length=TOPICS_MAX,
                                            description="Raw topic filters (0x + 64 hex, or null for any); with "
                                            "event, topic 0 is the event's.")
    from_block: int | Literal["latest"] = Field(description="First block (a number, or 'latest').")
    to_block: int | Literal["latest"] = Field("latest", description="Last block, at most 10,000 after from_block.")

    @model_validator(mode="after")
    def _filtered(self) -> Self:
        if not (self.address or self.event or any(self.topics or [])):
            raise ValueError("give an address, an event or a topic: an unfiltered range is too large to read")
        return self


class LogRow(ToolOutput):
    block_number: int
    tx_hash: str
    log_index: int
    address: str
    topics: list[str]
    data: str
    event: str | None = None
    args: dict[str, Any] | None = None


class LogsOutput(ToolOutput):
    chain: str
    logs: list[LogRow]
    address: str | None = None
    from_block: int | None = None
    to_block: int | None = None
    truncated: bool | None = None


def _decode(sig: Signature, log: dict[str, Any]) -> dict[str, Any] | None:
    topics = log.get("topics") or []
    indexed = [p for p in sig.inputs if p.indexed]
    plain = [p for p in sig.inputs if not p.indexed]
    if len(topics) != len(indexed) + 1:
        return None
    try:
        values: dict[str, Any] = {}
        for i, (param, topic) in enumerate(zip(indexed, topics[1:], strict=True)):
            key = param.name or f"arg{i}"
            dynamic = param.type in _DYNAMIC or param.type.endswith("]") or param.type.startswith("(")
            values[key] = topic if dynamic else decode_values([param.type], bytes.fromhex(topic[2:]))[0]
        data = decode_values([p.type for p in plain], bytes.fromhex(str(log.get("data", "0x"))[2:]))
        for i, (param, value) in enumerate(zip(plain, data, strict=True)):
            values[param.name or f"arg{len(indexed) + i}"] = value
    except (DecodingError, OverflowError, ValueError):
        return None
    return values


@tool(
    provider=CHAIN_EVM,
    slug="logs",
    name="EVM Event Logs",
    summary="Event logs from a contract or for an event in a block range, decoded from the event's signature.",
    description="Runs eth_getLogs on Base, Ethereum, Arbitrum, OP Mainnet or Polygon over at most 10,000 blocks, "
    "filtered by contract, event signature and/or raw topics (at least one filter). Give the event as "
    "'Transfer(address indexed from, address indexed to, uint256 value)' and each log comes back with its "
    "arguments decoded by name (integers as exact strings). At most 200 logs, the newest kept when there are more. "
    "For one transaction's transfers chain-evm/tx is simpler.",
    categories=(Category.crypto, Category.developer),
    render=Render.logs,
    price=FREE,
    example={"chain": "eip155:8453", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
             "event": "Transfer(address indexed from, address indexed to, uint256 value)", "from_block": "latest"},
    see_also=("chain-evm/tx", "chain-evm/call"),
)
async def logs(inp: LogsInput, ctx: RunContext) -> LogsOutput:
    net = network(inp.chain)
    try:
        sig = parse(inp.event) if inp.event else None
    except SignatureError as exc:
        raise InvalidToolInput("the event signature could not be read",
                               details=[str(exc)[:ERROR_DETAIL_CHARS]]) from exc
    topics = list(inp.topics or [])
    if sig:
        topics = [sig.topic, *topics[1:]]
    head_raw, = await batch(ctx, net, [("eth_blockNumber", [])])
    if isinstance(head_raw, RpcError):
        raise ProviderError(f"{net.name} RPC did not report its head block: {head_raw.message}")
    head = hex_int(head_raw)
    start = head if inp.from_block == "latest" else inp.from_block
    end = head if inp.to_block == "latest" else inp.to_block
    if end < start:
        raise InvalidToolInput("to_block is before from_block")
    truncated = end - start + 1 > LOGS_MAX_BLOCK_RANGE
    if truncated:
        end = start + LOGS_MAX_BLOCK_RANGE - 1
        ctx.note(f"Read blocks {start}–{end} only: public RPCs cap one query at {LOGS_MAX_BLOCK_RANGE:,} blocks.")
    flt: dict[str, Any] = {"fromBlock": hex(start), "toBlock": hex(end)}
    if inp.address:
        flt["address"] = inp.address
    if topics:
        flt["topics"] = [t.lower() if t else None for t in topics]
    try:
        found, = await batch(ctx, net, [("eth_getLogs", [flt])])
    except ProviderError as exc:  # the head block came back, so the RPCs are up: they refused this query's size
        raise ProviderError(f"{net.name} RPCs refused this log query; narrow from_block/to_block or add an "
                            "event/topic filter", details=exc.details) from exc
    if isinstance(found, RpcError):
        raise ProviderError(f"{net.name} RPC refused the log query: {found.message}; narrow the range or filters")
    rows = found or []
    if len(rows) > LOGS_MAX_ROWS:
        ctx.note(f"{len(rows)} logs matched; the newest {LOGS_MAX_ROWS} are shown.")
        rows, truncated = rows[-LOGS_MAX_ROWS:], True
    out: list[LogRow] = []
    for log in rows:
        args = _decode(sig, log) if sig and (log.get("topics") or [None])[0] == sig.topic else None
        out.append(LogRow(block_number=hex_int(log["blockNumber"]), tx_hash=log["transactionHash"],
                          log_index=hex_int(log["logIndex"]), address=to_checksum_address(log["address"]),
                          topics=log.get("topics") or [], data=log.get("data") or "0x",
                          event=sig.text if args is not None and sig else None, args=args))
    return LogsOutput(chain=net.caip2, logs=out, address=inp.address, from_block=start, to_block=end,
                      truncated=truncated or None)
