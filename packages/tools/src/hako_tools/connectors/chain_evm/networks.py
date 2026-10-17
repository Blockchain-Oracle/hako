"""The EVM chains Hako reads, mirrored from @hako/networks (packages/networks/src/registry.ts, 2026-10-17).

Python cannot import the TypeScript registry, so `packages/tools/scripts/check_samples.py` compares this file with it
and fails on any drift (chain ids, CAIP-2 ids, RPC URLs, explorers, native coins, USDC).
"""

from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms
from hako_tools.framework.jsonrpc import Rpc

EVM_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000"  # how LI.FI names every EVM native coin
# One public RPC that hangs must leave time for the next one inside the 8 s run.
RPC_TIMEOUT_S = 3.0
RPC_CONNECT_S = 2.0
RPC_CONCURRENCY = 4


@dataclass(frozen=True, slots=True)
class Coin:
    symbol: str
    name: str
    decimals: int
    address: str


@dataclass(frozen=True, slots=True)
class EvmNetwork:
    key: str
    name: str
    caip2: str
    chain_id: int
    explorer: str
    rpc_urls: tuple[str, ...]
    native: Coin
    usdc: Coin

    def tx_url(self, tx_hash: str) -> str:
        return f"{self.explorer}/tx/{tx_hash}"

    def block_url(self, number: int) -> str:
        return f"{self.explorer}/block/{number}"


ETH = Coin("ETH", "Ether", 18, EVM_NATIVE_ADDRESS)
USDC_NAME = "USD Coin"
USDC_DECIMALS = 6


def _usdc(address: str) -> Coin:
    return Coin("USDC", USDC_NAME, USDC_DECIMALS, address)


BASE = EvmNetwork(
    "base", "Base", "eip155:8453", 8453, "https://basescan.org",
    ("https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"),
    ETH, _usdc("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"))
ETHEREUM = EvmNetwork(
    "ethereum", "Ethereum", "eip155:1", 1, "https://etherscan.io",
    ("https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"),
    ETH, _usdc("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"))
ARBITRUM = EvmNetwork(
    "arbitrum", "Arbitrum", "eip155:42161", 42161, "https://arbiscan.io",
    ("https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"),
    ETH, _usdc("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"))
OPTIMISM = EvmNetwork(
    "optimism", "OP Mainnet", "eip155:10", 10, "https://optimistic.etherscan.io",
    ("https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com", "https://optimism.drpc.org"),
    ETH, _usdc("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"))
POLYGON = EvmNetwork(
    "polygon", "Polygon", "eip155:137", 137, "https://polygonscan.com",
    ("https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"),
    Coin("POL", "Polygon Ecosystem Token", 18, EVM_NATIVE_ADDRESS),
    _usdc("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"))
NETWORKS: tuple[EvmNetwork, ...] = (BASE, ETHEREUM, ARBITRUM, OPTIMISM, POLYGON)

# Every spelling an agent may use for a chain: the CAIP-2 id, the key, the name and the bare chain id.
_BY_ALIAS: dict[str, EvmNetwork] = {}
for _net in NETWORKS:
    for _alias in (_net.caip2, _net.key, _net.name.lower(), str(_net.chain_id)):
        _BY_ALIAS[_alias] = _net
_BY_ALIAS.update({"mainnet": ETHEREUM, "eth": ETHEREUM, "arbitrum one": ARBITRUM, "op": OPTIMISM, "matic": POLYGON})
CHAIN_IDS = ", ".join(f"{n.caip2} ({n.name})" for n in NETWORKS)


def network(chain: str) -> EvmNetwork:
    """The network a normalised chain id (an `EvmChain` value) names."""
    return _BY_ALIAS[chain]


def _to_caip2(value: str) -> str:
    found = _BY_ALIAS.get(value.strip().lower())
    if found is None:
        raise ValueError(f"unsupported EVM chain {value!r}; use one of {CHAIN_IDS}")
    return found.caip2


EvmChain = Annotated[str, AfterValidator(_to_caip2), Field(
    description=f"The chain as a CAIP-2 id: {CHAIN_IDS}. 'base', 'ethereum', 'arbitrum', 'optimism' and 'polygon' "
    "work too.")]


def _rpc(net: EvmNetwork, url: str) -> Rpc:
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    return Rpc(
        provider=Provider(
            id=parts.netloc, display_name=f"{net.name} RPC ({parts.netloc})",
            summary=f"Public JSON-RPC for {net.name}.", homepage=origin, base_url=origin,
            categories=(Category.crypto,), terms=Terms.open, auth=NoAuth(), max_concurrency=RPC_CONCURRENCY,
            timeout_s=RPC_TIMEOUT_S, connect_s=RPC_CONNECT_S),
        path=parts.path or "/",
    )


RPCS: dict[str, tuple[Rpc, ...]] = {n.caip2: tuple(_rpc(n, url) for url in n.rpc_urls) for n in NETWORKS}
