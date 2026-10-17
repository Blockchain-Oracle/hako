"""chain-evm/token: one token's facts, by contract address or symbol, read from the chain and LI.FI's list."""

import asyncio

from pydantic import Field

from hako_tools.connectors.chain_evm.erc20 import is_address, read_tokens, resolve
from hako_tools.connectors.chain_evm.networks import EvmChain, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.lifi.tokens import lifi_token
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

TOKEN_MAX_CHARS = 64
ERC20 = "erc20"
NATIVE = "native"


class TokenInput(ToolInput):
    chain: EvmChain
    token: str = Field(min_length=1, max_length=TOKEN_MAX_CHARS,
                       description="Contract address (0x…) or symbol ('USDC', 'WETH', 'ETH').")


class TokenOutput(ToolOutput):
    chain: str
    address: str
    symbol: str
    name: str
    decimals: int
    standard: str | None = None
    total_supply_atomic: str | None = None
    logo_url: str | None = None
    price_usd: float | None = None
    verified: bool | None = Field(default=None, description="Verified on LI.FI's token list.")


@tool(
    provider=CHAIN_EVM,
    slug="token",
    name="EVM Token Info",
    summary="An ERC-20's symbol, name, decimals and supply, plus logo, USD price and verification, by address or "
    "symbol.",
    description="Looks up one token on Base, Ethereum, Arbitrum, OP Mainnet or Polygon. By contract address it reads "
    "symbol, name, decimals and total supply from the chain itself; by symbol it resolves the address through "
    "LI.FI's token list first (so 'USDC' means native USDC, never a bridged copy). LI.FI adds a logo, a USD price "
    "and whether the token is verified when it lists it. Use it before drafting a transfer to get the right address "
    "and decimals. It does not read holders or balances (chain-evm/balance does).",
    categories=(Category.crypto,),
    render=Render.token,
    price=FREE,
    example={"chain": "eip155:8453", "token": "USDC"},
    see_also=("chain-evm/balance", "chain-solana/token"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def token(inp: TokenInput, ctx: RunContext) -> TokenOutput:
    net = network(inp.chain)
    found = await resolve(ctx, net, inp.token)
    if found is None:
        raise ToolNotFoundResult(f"No token {inp.token!r} on {net.name} (not an ERC-20 there, or not on LI.FI's list)")
    if found.native:
        return TokenOutput(chain=net.caip2, address=found.address, symbol=found.symbol, name=found.name,
                           decimals=found.decimals, standard=NATIVE)
    onchain, listed = await asyncio.gather(
        read_tokens(ctx, net, [found.address]),
        lifi_token(ctx, net.chain_id, found.address) if is_address(inp.token) or found.logo_url is None else _none(),
    )
    chain_facts = onchain.get(found.address.lower())
    if chain_facts is None:
        raise ToolNotFoundResult(f"{found.address} on {net.name} does not answer as an ERC-20")
    logo = found.logo_url or (listed.logo_url if listed else None)
    price = found.price_usd if found.price_usd is not None else (listed.price_usd if listed else None)
    verified = found.verified if found.verified is not None else (listed.verified if listed else None)
    supply = chain_facts.total_supply
    return TokenOutput(chain=net.caip2, address=chain_facts.address, symbol=chain_facts.symbol, name=chain_facts.name,
                       decimals=chain_facts.decimals, standard=ERC20,
                       total_supply_atomic=str(supply) if supply is not None else None, logo_url=logo,
                       price_usd=price, verified=verified)


async def _none() -> None:
    return None
