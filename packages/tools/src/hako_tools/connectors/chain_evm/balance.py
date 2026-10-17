"""chain-evm/balance: what an address holds on one EVM chain (native coin, USDC, any token asked for)."""

import asyncio

from pydantic import Field

from hako_tools.connectors.chain_evm.erc20 import (
    BALANCE_OF,
    Erc20,
    eth_call,
    ether_hint,
    int_result,
    known_token,
    resolve,
)
from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import EvmAddress, RpcError, batch, hex_int, units
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool

TOKENS_MAX = 10
USD_PLACES = 2


class BalanceInput(ToolInput):
    chain: EvmChain
    address: EvmAddress = Field(description="The wallet or contract to read (0x address).")
    tokens: list[str] = Field(default_factory=list, max_length=TOKENS_MAX,
                              description="Extra tokens by contract address or symbol ('WETH', 'DAI'); the native "
                              "coin and USDC are always read.")


class BalanceRow(ToolOutput):
    symbol: str
    address: str = Field(description="Token contract; the zero address for the native coin.")
    decimals: int
    amount_atomic: str
    amount: str = Field(description="Exact amount in token units.")
    name: str | None = None
    usd: float | None = None


class BalanceOutput(ToolOutput):
    chain: str
    address: str
    balances: list[BalanceRow]
    block_number: int | None = None


def _row(token: Erc20, atomic: int) -> BalanceRow:
    amount = units(atomic, token.decimals)
    usd = round(float(amount) * token.price_usd, USD_PLACES) if token.price_usd is not None else None
    return BalanceRow(symbol=token.symbol, address=token.address, decimals=token.decimals, amount_atomic=str(atomic),
                      amount=units(atomic, token.decimals), name=token.name, usd=usd)


@tool(
    provider=CHAIN_EVM,
    slug="balance",
    name="EVM Wallet Balance",
    summary="An address's native coin, USDC and chosen ERC-20 balances on Base, Ethereum, Arbitrum, OP or Polygon.",
    description="Reads one address on one EVM chain straight from public RPCs at the latest block: the native coin "
    "(ETH, or POL on Polygon) and native USDC always, plus up to 10 more tokens named by contract address or symbol "
    "(symbols resolve through LI.FI's token list). Amounts are exact, as atomic integers and token units. It does "
    "not list every token a wallet ever touched (name the ones you want), and it reads one chain per call. For "
    "Solana use chain-solana/balance; for one token's facts use chain-evm/token.",
    categories=(Category.crypto,),
    render=Render.balance,
    price=FREE,
    example={"chain": "eip155:8453", "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "tokens": ["WETH"]},
    see_also=("chain-evm/token", "chain-solana/balance", "chain-evm/tx"),
    cache_ttl_s=TTL_LIVE_S,
)
async def balance(inp: BalanceInput, ctx: RunContext) -> BalanceOutput:
    net = network(inp.chain)
    tokens: list[Erc20] = [t for t in (known_token(net, "native"), known_token(net, "usdc")) if t]
    missing: list[str] = []
    wanted = list(dict.fromkeys(t.strip() for t in inp.tokens if t.strip()))
    for name, found in zip(wanted, await asyncio.gather(*(resolve(ctx, net, w) for w in wanted)), strict=True):
        if found is None:
            missing.append(name)
        elif all(found.address.lower() != t.address.lower() for t in tokens):
            tokens.append(found)
    calls = [("eth_blockNumber", []), ("eth_getBalance", [inp.address, "latest"])]
    calls += [eth_call(BALANCE_OF, t.address, [inp.address]) for t in tokens if not t.native]
    head, native_raw, *token_raw = await batch(ctx, net, calls)
    if isinstance(native_raw, RpcError):
        raise ProviderError(f"{net.name} RPC could not read the balance: {native_raw.message}")
    rows = [_row(tokens[0], hex_int(native_raw))]
    for token, raw in zip(tokens[1:], token_raw, strict=True):
        atomic = int_result(raw)
        if atomic is None:
            missing.append(token.symbol)
            continue
        rows.append(_row(token, atomic))
    if missing:
        hint = "".join(dict.fromkeys(ether_hint(net, m) for m in missing))
        ctx.note(f"Not read on {net.name}: {', '.join(missing)} (unknown token or not an ERC-20 there).{hint}")
    block = None if isinstance(head, RpcError) else hex_int(head)
    return BalanceOutput(chain=net.caip2, address=inp.address, balances=rows, block_number=block)
