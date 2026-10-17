"""Solana JSON-RPC (Helius first, then public RPCs) and SPL token facts shared by the chain-solana tools."""

from dataclasses import dataclass
from typing import Any

from solders.pubkey import Pubkey

from hako_tools.connectors.chain_solana.provider import (
    LIFI_CHAIN_ID,
    NATIVE_ADDRESS,
    NATIVE_DECIMALS,
    NATIVE_NAME,
    NATIVE_SYMBOL,
    USDC_DECIMALS,
    USDC_MINT,
    rpcs,
)
from hako_tools.connectors.lifi.tokens import lifi_token
from hako_tools.framework import RunContext
from hako_tools.framework.jsonrpc import RpcError, batch_on

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
TOKEN_STANDARDS = {TOKEN_PROGRAM: "spl-token", TOKEN_2022_PROGRAM: "token-2022"}
ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
PARSED = {"commitment": "confirmed", "encoding": "jsonParsed"}
COMMITMENT = {"commitment": "confirmed"}
SHORT_MINT_CHARS = 4
_NATIVE_WORDS = frozenset({"sol", "native", NATIVE_ADDRESS.lower()})


@dataclass(frozen=True, slots=True)
class SplToken:
    mint: str
    symbol: str
    name: str
    decimals: int | None
    native: bool = False
    logo_url: str | None = None
    price_usd: float | None = None
    verified: bool | None = None
    listed: bool = True  # False: LI.FI does not list it, so symbol and name are the mint's short form


async def batch(ctx: RunContext, calls: list[tuple[str, Any]]) -> list[Any]:
    return await batch_on(ctx, rpcs(), "Solana", calls)


async def call(ctx: RunContext, method: str, params: Any) -> Any:
    (result,) = await batch(ctx, [(method, params)])
    if isinstance(result, RpcError):
        raise result
    return result


def native_token() -> SplToken:
    return SplToken(mint=NATIVE_ADDRESS, symbol=NATIVE_SYMBOL, name=NATIVE_NAME, decimals=NATIVE_DECIMALS, native=True)


def short_mint(mint: str) -> str:
    return f"{mint[:SHORT_MINT_CHARS]}…{mint[-SHORT_MINT_CHARS:]}"


def is_native(token: str) -> bool:
    return token.strip().lower() in _NATIVE_WORDS


async def describe(ctx: RunContext, token: str) -> SplToken | None:
    """A token by mint or symbol through LI.FI's list; an unlisted mint keeps its short form as its label."""
    if is_native(token):
        return native_token()
    listed = await lifi_token(ctx, LIFI_CHAIN_ID, token.strip())
    if listed is not None:
        return SplToken(mint=listed.address, symbol=listed.symbol, name=listed.name, decimals=listed.decimals,
                        logo_url=listed.logo_url, price_usd=listed.price_usd, verified=listed.verified)
    if token.strip().upper() == "USDC" or token.strip() == USDC_MINT:
        return SplToken(mint=USDC_MINT, symbol="USDC", name="USD Coin", decimals=USDC_DECIMALS)
    return None


@dataclass(frozen=True, slots=True)
class Mint:
    """A mint account's facts: its token program, decimals and supply (from `getMultipleAccounts` / jsonParsed)."""

    program: str
    decimals: int
    supply: int | None


def mint_facts(account: Any) -> Mint | None:
    """None when the account is missing or is not a mint of the classic or Token-2022 program."""
    if not isinstance(account, dict) or account.get("owner") not in TOKEN_STANDARDS:
        return None
    parsed = (account.get("data") or {}).get("parsed") if isinstance(account.get("data"), dict) else None
    if not isinstance(parsed, dict) or parsed.get("type") != "mint":
        return None
    info = parsed.get("info") or {}
    supply = info.get("supply")
    return Mint(program=str(account["owner"]), decimals=int(info.get("decimals") or 0),
                supply=int(supply) if supply is not None else None)


def token_account_amount(account: Any) -> int:
    """Atomic amount in a parsed token account; 0 when the account does not exist (never opened or closed)."""
    if not isinstance(account, dict) or not isinstance(account.get("data"), dict):
        return 0
    info = (account["data"].get("parsed") or {}).get("info") or {}
    return int((info.get("tokenAmount") or {}).get("amount") or 0)


def associated_token_address(owner: str, mint: str, program: str) -> str:
    """The owner's associated token account for a mint (the account wallets and PayBox send to)."""
    seeds = [bytes(Pubkey.from_string(owner)), bytes(Pubkey.from_string(program)), bytes(Pubkey.from_string(mint))]
    return str(Pubkey.find_program_address(seeds, Pubkey.from_string(ASSOCIATED_TOKEN_PROGRAM))[0])
