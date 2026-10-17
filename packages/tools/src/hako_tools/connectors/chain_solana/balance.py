"""chain-solana/balance: SOL, USDC and any SPL tokens asked for, held by one Solana address.

Token balances are read from the owner's associated token accounts (derived, then fetched with getMultipleAccounts):
non-indexed calls every public RPC serves, where getTokenAccountsByOwner needs an indexing node.
"""

import asyncio
import re

from pydantic import Field

from hako_tools.connectors.chain_evm.balance import USD_PLACES, BalanceOutput, BalanceRow
from hako_tools.connectors.chain_solana.provider import BASE58_PATTERN, CAIP2, CHAIN_SOLANA, SolanaAddress, SolanaChain
from hako_tools.connectors.chain_solana.rpc import (
    COMMITMENT,
    PARSED,
    SplToken,
    associated_token_address,
    batch,
    describe,
    mint_facts,
    native_token,
    short_mint,
    token_account_amount,
)
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, tool
from hako_tools.framework.jsonrpc import RpcError, units

TOKENS_MAX = 10
_MINT = re.compile(BASE58_PATTERN)


class SolBalanceInput(ToolInput):
    chain: SolanaChain = CAIP2
    address: SolanaAddress
    tokens: list[str] = Field(default_factory=list, max_length=TOKENS_MAX,
                              description="Extra SPL tokens by mint or symbol ('JUP', 'BONK'); SOL and USDC are "
                              "always read.")


def _row(token: SplToken, atomic: int, decimals: int) -> BalanceRow:
    amount = units(atomic, decimals)
    usd = round(float(amount) * token.price_usd, USD_PLACES) if token.price_usd is not None else None
    return BalanceRow(symbol=token.symbol, address=token.mint, decimals=decimals, amount_atomic=str(atomic),
                      amount=amount, name=token.name, usd=usd)


async def _tokens(ctx: RunContext, wanted: list[str], missing: list[str]) -> list[SplToken]:
    described = await asyncio.gather(*(describe(ctx, w) for w in wanted))
    tokens: list[SplToken] = []
    for name, found in zip(wanted, described, strict=True):
        if found is None and _MINT.match(name):
            found = SplToken(mint=name, symbol=short_mint(name), name=name, decimals=None, listed=False)
        if found is None:
            missing.append(name)
        elif not found.native and all(found.mint != t.mint for t in tokens):
            tokens.append(found)
    return tokens


@tool(
    provider=CHAIN_SOLANA,
    slug="balance",
    name="Solana Wallet Balance",
    summary="A Solana address's SOL, USDC and chosen SPL token balances, exact, with USD values for listed tokens.",
    description="Reads one Solana address (Helius, else public RPCs) at the confirmed commitment: SOL and USDC always, "
    "plus up to 10 SPL tokens (classic and Token-2022) named by mint or symbol; symbols resolve through LI.FI's "
    "token list, which also adds USD prices. Token amounts are what the owner's associated token account holds "
    "(where wallets and PayBox receive), exact as atomic integers and token units. It does not list every token "
    "the wallet holds (name the ones you want). For EVM chains use chain-evm/balance.",
    categories=(Category.crypto,),
    render=Render.balance,
    price=FREE,
    example={"chain": CAIP2, "address": "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY", "tokens": ["JUP"]},
    see_also=("chain-solana/token", "chain-solana/tx", "chain-evm/balance"),
    cache_ttl_s=TTL_LIVE_S,
)
async def balance(inp: SolBalanceInput, ctx: RunContext) -> BalanceOutput:
    missing: list[str] = []
    tokens = await _tokens(ctx, list(dict.fromkeys(t.strip() for t in ["USDC", *inp.tokens] if t.strip())), missing)
    sol_raw, slot, mints_raw = await batch(ctx, [
        ("getBalance", [inp.address, COMMITMENT]), ("getSlot", [COMMITMENT]),
        ("getMultipleAccounts", [[t.mint for t in tokens], PARSED])])
    if isinstance(sol_raw, RpcError) or not isinstance(sol_raw, dict):
        raise ProviderError(f"Solana RPC could not read the balance: {getattr(sol_raw, 'message', sol_raw)}")
    sol = native_token()
    rows = [_row(sol, int(sol_raw.get("value") or 0), sol.decimals or 0)]
    mint_accounts = mints_raw.get("value") if isinstance(mints_raw, dict) else None
    if not isinstance(mint_accounts, list):
        mint_accounts = [None] * len(tokens)
    held: list[tuple[SplToken, int, str]] = []
    for token, account in zip(tokens, mint_accounts, strict=True):
        facts = mint_facts(account)
        if facts is None:
            missing.append(token.symbol)
            continue
        held.append((token, facts.decimals, associated_token_address(inp.address, token.mint, facts.program)))
    if held:
        (atas_raw,) = await batch(ctx, [("getMultipleAccounts", [[ata for _, _, ata in held], PARSED])])
        accounts = atas_raw.get("value") if isinstance(atas_raw, dict) else None
        if not isinstance(accounts, list):
            raise ProviderError("Solana RPC could not read the token accounts; retry shortly")
        rows += [_row(token, token_account_amount(acc), decimals)
                 for (token, decimals, _), acc in zip(held, accounts, strict=True)]
    if missing:
        ctx.note(f"Not read: {', '.join(missing)} (unknown token or not an SPL mint).")
    if any(not t.listed for t in tokens):
        ctx.note("Tokens LI.FI does not list are labelled by their mint's short form.")
    block = slot if isinstance(slot, int) else None
    return BalanceOutput(chain=CAIP2, address=inp.address, balances=rows, block_number=block)
