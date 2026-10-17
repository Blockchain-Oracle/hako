"""ERC-20 facts read from the chain (symbol, name, decimals, supply, balances), and symbol → token resolution."""

import re
from dataclasses import dataclass
from typing import Any

from eth_abi.abi import decode
from eth_abi.exceptions import DecodingError
from eth_utils.address import to_checksum_address

from hako_tools.connectors.chain_evm.abi import Signature, encode_call, parse
from hako_tools.connectors.chain_evm.networks import ETH, EVM_NATIVE_ADDRESS, EvmNetwork
from hako_tools.connectors.chain_evm.rpc import ADDRESS_PATTERN, RpcError, batch, block_tag, hex_int
from hako_tools.connectors.lifi.tokens import lifi_token
from hako_tools.framework import RunContext

SYMBOL = parse("symbol() returns (string)")
NAME = parse("name() returns (string)")
DECIMALS = parse("decimals() returns (uint8)")
TOTAL_SUPPLY = parse("totalSupply() returns (uint256)")
BALANCE_OF = parse("balanceOf(address) returns (uint256)")
TOKEN_FACTS = (SYMBOL, NAME, DECIMALS, TOTAL_SUPPLY)
WORD_BYTES = 32
_ADDRESS = re.compile(ADDRESS_PATTERN)
# Any chain's native coin: these words, its own symbol, or LI.FI's zero address. "eth"/"ether" name the native coin
# only where it is ETH; on Polygon "ETH" is the bridged WETH token, resolved through LI.FI like any other symbol.
_NATIVE_ALIASES = frozenset({"native", "gas", EVM_NATIVE_ADDRESS})
_ETHER_ALIASES = frozenset({"eth", "ether"})


@dataclass(frozen=True, slots=True)
class Erc20:
    address: str
    symbol: str
    name: str
    decimals: int
    total_supply: int | None = None
    native: bool = False
    logo_url: str | None = None
    price_usd: float | None = None
    verified: bool | None = None


def is_address(text: str) -> bool:
    return bool(_ADDRESS.match(text))


def eth_call(sig: Signature, to: str, args: list[Any] | None = None,
             block: int | str | None = None) -> tuple[str, list[Any]]:
    return "eth_call", [{"to": to, "data": encode_call(sig, args or [])}, block_tag(block)]


def text_result(raw: Any) -> str | None:
    """A string return, or a bytes32 one (older tokens such as MKR), or None when the call failed."""
    if isinstance(raw, RpcError) or not isinstance(raw, str) or len(raw) <= len("0x"):
        return None
    data = bytes.fromhex(raw[2:])
    try:
        (value,) = decode(["string"], data)
        return str(value)
    except (DecodingError, OverflowError, ValueError):
        return data[:WORD_BYTES].rstrip(b"\0").decode("utf-8", "ignore") or None


def int_result(raw: Any) -> int | None:
    if isinstance(raw, RpcError) or not isinstance(raw, str) or len(raw) <= len("0x"):
        return None
    return hex_int(raw[:2 + 2 * WORD_BYTES])


def native_token(net: EvmNetwork) -> Erc20:
    c = net.native
    return Erc20(address=EVM_NATIVE_ADDRESS, symbol=c.symbol, name=c.name, decimals=c.decimals, native=True)


def known_token(net: EvmNetwork, token: str) -> Erc20 | None:
    """The chain's native coin or USDC, by symbol or address, without a network call."""
    word = token.strip().lower()
    symbol = net.native.symbol.lower()
    if word in _NATIVE_ALIASES or word == symbol or (symbol == ETH.symbol.lower() and word in _ETHER_ALIASES):
        return native_token(net)
    if word in ("usdc", net.usdc.address.lower()):
        u = net.usdc
        return Erc20(address=u.address, symbol=u.symbol, name=u.name, decimals=u.decimals)
    return None


def ether_hint(net: EvmNetwork, token: str) -> str:
    """Why 'ETH' found nothing on a chain whose native coin is not Ether (LI.FI lists bridged Ether as WETH only)."""
    if net.native.symbol != ETH.symbol and token.strip().lower() in _ETHER_ALIASES:
        return f" {net.name}'s native coin is {net.native.symbol}; Ether there is the WETH token."
    return ""


async def read_tokens(ctx: RunContext, net: EvmNetwork, addresses: list[str]) -> dict[str, Erc20]:
    """Symbol, name, decimals and supply of each contract in one batch; contracts that are not ERC-20 are left out."""
    calls = [eth_call(sig, a) for a in addresses for sig in TOKEN_FACTS]
    if not calls:
        return {}
    results = await batch(ctx, net, calls)
    out: dict[str, Erc20] = {}
    for i, address in enumerate(addresses):
        n = len(TOKEN_FACTS)
        symbol, name, decimals, supply = results[n * i:n * i + n]
        dec = int_result(decimals)
        sym = text_result(symbol)
        if dec is None or sym is None:
            continue
        out[address.lower()] = Erc20(address=to_checksum_address(address), symbol=sym, name=text_result(name) or sym,
                                     decimals=dec, total_supply=int_result(supply))
    return out


async def resolve(ctx: RunContext, net: EvmNetwork, token: str) -> Erc20 | None:
    """A token by address or symbol: the registry first, then the chain (address) or LI.FI's list (symbol)."""
    known = known_token(net, token)
    if known:
        return known
    if is_address(token):
        return (await read_tokens(ctx, net, [token])).get(token.lower())
    listed = await lifi_token(ctx, net.chain_id, token.strip())
    if listed is None:
        return None
    return Erc20(address=to_checksum_address(listed.address), symbol=listed.symbol, name=listed.name,
                 decimals=listed.decimals, logo_url=listed.logo_url, price_usd=listed.price_usd,
                 verified=listed.verified)
