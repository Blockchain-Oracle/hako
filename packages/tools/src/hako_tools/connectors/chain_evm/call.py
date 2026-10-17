"""chain-evm/call: a contract view call by its human-readable signature, decoded (eth_call)."""

from typing import Any, Literal

from eth_abi.exceptions import DecodingError, EncodingError
from pydantic import Field

from hako_tools.connectors.chain_evm.abi import SIGNATURE_MAX_CHARS, SignatureError, decode_values, encode_call, parse
from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import EvmAddress, RpcError, batch, block_tag, hex_int
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import (
    FREE,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)
from hako_tools.framework.errors import InvalidToolInput
from hako_tools.framework.jsonrpc import ERROR_DETAIL_CHARS

# @hako/cards CONTRACT_ARGS_MAX (contract.config.ts): the most arguments one call takes.
CONTRACT_ARGS_MAX = 16


class CallInput(ToolInput):
    chain: EvmChain
    address: EvmAddress = Field(description="The contract to call.")
    function: str = Field(min_length=3, max_length=SIGNATURE_MAX_CHARS,
                          description="The function's signature, e.g. 'balanceOf(address) view returns (uint256)' "
                          "or 'function getReserves() view returns (uint112, uint112, uint32)'. Without 'returns' "
                          "the raw bytes come back.")
    args: list[Any] = Field(default_factory=list, max_length=CONTRACT_ARGS_MAX,
                            description="Arguments in order: integers as numbers or strings, bytes as 0x hex, "
                            "tuples and arrays as lists.")
    block: int | Literal["latest"] = Field("latest", description="Read at this block number, or the head.")


class CallOutput(ToolOutput):
    chain: str
    address: str
    function: str = Field(description="The canonical signature the call was encoded and decoded with.")
    args: list[Any]
    result: Any = Field(description="One value for one output, a list for several; integers as base-10 strings.")
    block_number: int | None = None


@tool(
    provider=CHAIN_EVM,
    slug="call",
    name="EVM Contract Read",
    summary="Call any view function on a contract by its signature and get the decoded result (no ABI file needed).",
    description="Runs eth_call on Base, Ethereum, Arbitrum, OP Mainnet or Polygon with the function written as a "
    "human-readable signature ('balanceOf(address) view returns (uint256)', 'getReserves() returns (uint112,uint112,"
    "uint32)'), the arguments as JSON, at the head or a past block. Integers come back as exact base-10 strings, "
    "bytes as 0x hex, tuples as lists. It never sends a transaction or changes state; a call that reverts says so. "
    "For token facts and balances the dedicated chain-evm/token and chain-evm/balance are simpler.",
    categories=(Category.crypto, Category.developer),
    render=Render.contract_read,
    price=FREE,
    example={"chain": "eip155:8453", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
             "function": "balanceOf(address) view returns (uint256)",
             "args": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]},
    see_also=("chain-evm/token", "chain-evm/logs"),
    cache_ttl_s=TTL_LIVE_S,
)
async def contract_call(inp: CallInput, ctx: RunContext) -> CallOutput:
    net = network(inp.chain)
    try:
        sig = parse(inp.function)
        data = encode_call(sig, inp.args)
    except (SignatureError, EncodingError, ValueError, TypeError) as exc:
        raise InvalidToolInput("the function signature or its arguments could not be encoded",
                               details=[str(exc)[:ERROR_DETAIL_CHARS]]) from exc
    raw, head = await batch(ctx, net, [("eth_call", [{"to": inp.address, "data": data}, block_tag(inp.block)]),
                                       ("eth_blockNumber", [])])
    if isinstance(raw, RpcError):
        raise ProviderError(f"The call reverted or failed on {net.name}: {raw.message}",
                            details=[str(raw.data)[:ERROR_DETAIL_CHARS]])
    if sig.outputs and raw in (None, "0x"):
        raise ToolNotFoundResult(f"Empty answer: no contract at {inp.address} on {net.name}, or no such function")
    if sig.outputs:
        try:
            values = decode_values([p.type for p in sig.outputs], bytes.fromhex(str(raw)[2:]))
        except (DecodingError, OverflowError, ValueError) as exc:
            raise ProviderError(f"The answer does not decode as ({','.join(p.type for p in sig.outputs)}); "
                                "check the returns types", details=[str(raw)[:ERROR_DETAIL_CHARS]]) from exc
        result: Any = values[0] if len(values) == 1 else values
    else:
        result = raw
    number = inp.block if isinstance(inp.block, int) else (None if isinstance(head, RpcError) else hex_int(head))
    return CallOutput(chain=net.caip2, address=inp.address, function=sig.text, args=inp.args, result=result,
                      block_number=number)
