"""chain-solana/token: one SPL token's facts by mint or symbol: the mint account on chain plus LI.FI's listing."""

import re

from pydantic import Field

from hako_tools.connectors.chain_evm.token import TokenOutput
from hako_tools.connectors.chain_solana.provider import BASE58_PATTERN, CAIP2, CHAIN_SOLANA, SolanaChain
from hako_tools.connectors.chain_solana.rpc import (
    PARSED,
    TOKEN_STANDARDS,
    batch,
    describe,
    is_native,
    mint_facts,
    native_token,
    short_mint,
)
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, tool
from hako_tools.framework.jsonrpc import RpcError

TOKEN_MAX_CHARS = 64
NATIVE = "native"


class SolTokenInput(ToolInput):
    chain: SolanaChain = CAIP2
    token: str = Field(min_length=1, max_length=TOKEN_MAX_CHARS,
                       description="Mint address or symbol ('USDC', 'JUP', 'SOL').")


@tool(
    provider=CHAIN_SOLANA,
    slug="token",
    name="Solana Token Info",
    summary="An SPL token's symbol, name, decimals, supply and program, plus logo, USD price and verification.",
    description="Looks up one Solana token by mint address or symbol. The mint account on chain gives decimals, "
    "supply and whether it is a classic SPL or Token-2022 mint; LI.FI's token list resolves symbols to mints (so "
    "'USDC' is Circle's USDC) and adds name, logo, USD price and verification. A mint LI.FI does not list keeps "
    "its short form as its label. Use it before drafting a Solana transfer. For EVM tokens use chain-evm/token.",
    categories=(Category.crypto,),
    render=Render.token,
    price=FREE,
    example={"chain": CAIP2, "token": "JUP"},
    see_also=("chain-solana/balance", "chain-evm/token"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def token(inp: SolTokenInput, ctx: RunContext) -> TokenOutput:
    if is_native(inp.token):
        sol = native_token()
        return TokenOutput(chain=CAIP2, address=sol.mint, symbol=sol.symbol, name=sol.name,
                           decimals=sol.decimals or 0, standard=NATIVE)
    listed = await describe(ctx, inp.token)
    mint = listed.mint if listed else inp.token.strip()
    if not re.match(BASE58_PATTERN, mint):
        raise ToolNotFoundResult(f"No Solana token {inp.token!r} on LI.FI's list; pass its mint address instead")
    (account_raw,) = await batch(ctx, [("getAccountInfo", [mint, PARSED])])
    account = account_raw.get("value") if isinstance(account_raw, dict) else None
    facts = None if isinstance(account_raw, RpcError) else mint_facts(account)
    if facts is None:
        raise ToolNotFoundResult(f"No SPL mint {inp.token!r} on Solana (unknown symbol, or not a token mint)")
    if listed is None:
        ctx.note("LI.FI does not list this mint: no symbol, logo or price beyond what the chain says.")
    symbol, name = (listed.symbol, listed.name) if listed else (short_mint(mint), "Unlisted token")
    logo, price, verified = (listed.logo_url, listed.price_usd, listed.verified) if listed else (None, None, None)
    return TokenOutput(chain=CAIP2, address=mint, symbol=symbol, name=name, decimals=facts.decimals,
                       standard=TOKEN_STANDARDS[facts.program],
                       total_supply_atomic=str(facts.supply) if facts.supply is not None else None,
                       logo_url=logo, price_usd=price, verified=verified)
