"""chain-evm/tx: a transaction and its receipt: status, fee, block time, confirmations and token transfers."""

from datetime import UTC, datetime
from typing import Any

from eth_utils.address import to_checksum_address
from pydantic import ConfigDict, Field

from hako_tools.connectors.chain_evm.abi import parse
from hako_tools.connectors.chain_evm.erc20 import known_token, read_tokens
from hako_tools.connectors.chain_evm.networks import EvmChain, EvmNetwork, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import RpcError, TxHash, batch, call, hex_int
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool

TRANSFER = parse("event Transfer(address indexed from, address indexed to, uint256 value)")
TRANSFER_TOPICS = 3  # topic0 + indexed from + indexed to (ERC-721 adds the token id as a fourth)
TRANSFERS_MAX = 20
TOKENS_TO_NAME_MAX = 8  # one batch of symbol/decimals reads for the tokens a receipt moved
ADDRESS_HEX_CHARS = 40
RECEIPT_SUCCESS = 1


class TxInput(ToolInput):
    chain: EvmChain
    hash: TxHash = Field(description="The transaction hash (0x + 64 hex).")


# `from` is a Python keyword: the field is `from_` and serialises as `from` (the tx_receipt card's name).
_BY_ALIAS = ConfigDict(extra="ignore", serialize_by_alias=True, validate_by_name=True, validate_by_alias=True)


class Transfer(ToolOutput):
    model_config = _BY_ALIAS
    token: str
    from_: str = Field(serialization_alias="from", alias="from")
    to: str
    amount_atomic: str
    symbol: str | None = None
    decimals: int | None = None


class TxOutput(ToolOutput):
    model_config = _BY_ALIAS
    chain: str
    hash: str
    status: str = Field(description="success, reverted, pending or not_found.")
    block_number: int | None = None
    from_: str | None = Field(default=None, serialization_alias="from", alias="from")
    to: str | None = None
    value_atomic: str | None = None
    gas_used: str | None = None
    fee_atomic: str | None = None
    timestamp: str | None = None
    confirmations: int | None = None
    explorer_url: str | None = None
    transfers: list[Transfer] | None = None


def _topic_address(topic: str) -> str:
    return to_checksum_address("0x" + topic[-ADDRESS_HEX_CHARS:])


def _transfers(logs: list[dict[str, Any]]) -> list[Transfer]:
    out: list[Transfer] = []
    for log in logs:
        topics = log.get("topics") or []
        if len(topics) != TRANSFER_TOPICS or topics[0] != TRANSFER.topic or log.get("data") in (None, "0x"):
            continue
        out.append(Transfer.model_validate({
            "token": to_checksum_address(log["address"]), "from": _topic_address(topics[1]),
            "to": _topic_address(topics[2]), "amount_atomic": str(hex_int(log["data"]))}))
    return out[:TRANSFERS_MAX]


@tool(
    provider=CHAIN_EVM,
    slug="tx",
    name="EVM Transaction Receipt",
    summary="Whether a transaction succeeded, with its block, time, fee, confirmations and ERC-20 transfers.",
    description="Looks up one transaction hash on Base, Ethereum, Arbitrum, OP Mainnet or Polygon: status (success, "
    "reverted, pending in the mempool, or not_found on this chain), block and its time, sender, recipient, value, "
    "gas used, the fee actually paid, confirmations, the explorer link, and the ERC-20 transfers its receipt logged "
    "(with symbols). Use it to confirm a payment or a bridge's source leg. It does not trace internal calls or "
    "decode arbitrary events (chain-evm/logs decodes any event).",
    categories=(Category.crypto,),
    render=Render.tx_receipt,
    price=FREE,
    example={"chain": "eip155:8453",
             "hash": "0x4ec610153dc450e66c5b57ae067ee5f96049e039743110033675b639da741138"},
    see_also=("chain-evm/logs", "chain-evm/block", "chain-solana/tx"),
)
async def tx(inp: TxInput, ctx: RunContext) -> TxOutput:
    net = network(inp.chain)
    found, receipt, head = await batch(ctx, net, [
        ("eth_getTransactionByHash", [inp.hash]), ("eth_getTransactionReceipt", [inp.hash]), ("eth_blockNumber", [])])
    if isinstance(found, RpcError):
        raise ProviderError(f"{net.name} RPC could not look the transaction up: {found.message}")
    out = TxOutput(chain=net.caip2, hash=inp.hash, status="not_found", explorer_url=net.tx_url(inp.hash))
    if not found:
        ctx.note(f"No transaction with this hash on {net.name}; check the chain, or it may not have propagated yet.")
        return out
    out.from_ = to_checksum_address(found["from"])
    out.to = to_checksum_address(found["to"]) if found.get("to") else None
    out.value_atomic = str(hex_int(found.get("value")))
    if not receipt or isinstance(receipt, RpcError):
        out.status = "pending"
        return out
    number = hex_int(receipt["blockNumber"])
    out.status = "success" if hex_int(receipt.get("status")) == RECEIPT_SUCCESS else "reverted"
    out.block_number = number
    out.gas_used = str(hex_int(receipt.get("gasUsed")))
    price = hex_int(receipt.get("effectiveGasPrice") or found.get("gasPrice"))
    l1_fee = hex_int(receipt.get("l1Fee")) if receipt.get("l1Fee") else 0  # OP-stack chains add an L1 data fee
    out.fee_atomic = str(hex_int(receipt.get("gasUsed")) * price + l1_fee)
    if not isinstance(head, RpcError):
        out.confirmations = max(0, hex_int(head) - number + 1)
    block = await call(ctx, net, "eth_getBlockByNumber", [hex(number), False])
    if block:
        out.timestamp = datetime.fromtimestamp(hex_int(block["timestamp"]), UTC).isoformat(timespec="seconds")
    transfers = _transfers(receipt.get("logs") or [])
    if transfers:
        await _name_tokens(ctx, net, transfers)
        out.transfers = transfers
    return out


async def _name_tokens(ctx: RunContext, net: EvmNetwork, transfers: list[Transfer]) -> None:
    """Fill symbol and decimals: registry tokens free, the rest in one batch of chain reads."""
    unknown = list(dict.fromkeys(t.token for t in transfers if not known_token(net, t.token)))
    facts = await read_tokens(ctx, net, unknown[:TOKENS_TO_NAME_MAX])
    for t in transfers:
        meta = known_token(net, t.token) or facts.get(t.token.lower())
        if meta:
            t.symbol, t.decimals = meta.symbol, meta.decimals
