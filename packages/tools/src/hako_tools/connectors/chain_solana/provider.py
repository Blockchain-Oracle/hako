"""The `chain-solana` provider and its RPC upstreams, mirrored from @hako/networks' SOLANA entry (registry.ts).

Helius (`HELIUS_API_KEY`) answers first when configured; the public RPCs @hako/networks lists take over when it is
missing, rate limited or out of credits (2026-10-17: the dev key answered 429 "max usage reached"), so the tools never
depend on one key. The key travels as Helius' `api-key` query parameter and never reaches a source URL.
"""

from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Query, Terms
from hako_tools.framework.jsonrpc import Rpc

CAIP2 = "solana:mainnet"
CAIP2_ALIASES = ("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana", "sol", "solana-mainnet")
NATIVE_ADDRESS = "11111111111111111111111111111111"  # how LI.FI names SOL: the system program id
NATIVE_SYMBOL = "SOL"
NATIVE_NAME = "Solana"
NATIVE_DECIMALS = 9
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_DECIMALS = 6
LIFI_CHAIN_ID = 1151111081099710
EXPLORER = "https://solscan.io"
PUBLIC_RPC_URLS = ("https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com")
HELIUS_URL = "https://mainnet.helius-rpc.com"
HELIUS_KEY_ENV = "HELIUS_API_KEY"
RPC_TIMEOUT_S = 3.0
RPC_CONNECT_S = 2.0
RPC_CONCURRENCY = 4
BASE58_PATTERN = r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"
SIGNATURE_PATTERN = r"^[1-9A-HJ-NP-Za-km-z]{64,90}$"

CHAIN_SOLANA = Provider(
    id="chain-solana",
    display_name="Solana",
    summary="Live Solana reads: SOL and SPL token balances, token facts, transaction status and priority fees.",
    homepage="https://solana.com",
    docs_url="https://solana.com/docs/rpc",
    base_url=PUBLIC_RPC_URLS[0],  # never called directly: each RPC below is its own upstream
    categories=(Category.crypto, Category.developer),
    terms=Terms.open,
    auth=NoAuth(),
    logo_domain="solana.com",
)


HELIUS = Rpc(
    provider=Provider(
        id="helius", display_name="Helius", summary="Solana RPC and priority-fee estimates.",
        homepage="https://www.helius.dev", base_url=HELIUS_URL, categories=(Category.crypto,), terms=Terms.allowed,
        auth=Query("api-key", HELIUS_KEY_ENV), max_concurrency=RPC_CONCURRENCY, timeout_s=RPC_TIMEOUT_S,
        connect_s=RPC_CONNECT_S),
    path="/",
)


def _public(url: str) -> Rpc:
    host = urlsplit(url).netloc
    return Rpc(
        provider=Provider(
            id=host, display_name=f"Solana RPC ({host})", summary="Public Solana JSON-RPC.", homepage=url,
            base_url=url, categories=(Category.crypto,), terms=Terms.open, auth=NoAuth(),
            max_concurrency=RPC_CONCURRENCY, timeout_s=RPC_TIMEOUT_S, connect_s=RPC_CONNECT_S),
        path="/",
    )


PUBLIC_RPCS = tuple(_public(url) for url in PUBLIC_RPC_URLS)


def rpcs() -> tuple[Rpc, ...]:
    """Helius first when its key is set, then the public RPCs."""
    return (HELIUS, *PUBLIC_RPCS) if HELIUS.provider.available else PUBLIC_RPCS


def _to_caip2(value: str) -> str:
    if value.strip().lower() not in (CAIP2, *(a.lower() for a in CAIP2_ALIASES)):
        raise ValueError(f"unsupported chain {value!r}; Solana is {CAIP2}")
    return CAIP2


SolanaChain = Annotated[str, AfterValidator(_to_caip2), Field(
    description=f"The chain: {CAIP2} (the genesis-hash CAIP-2 id and 'solana' work too).")]
SolanaAddress = Annotated[str, Field(pattern=BASE58_PATTERN, description="A base58 Solana address.")]


def tx_url(signature: str) -> str:
    return f"{EXPLORER}/tx/{signature}"
