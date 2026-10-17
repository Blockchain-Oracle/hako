"""The `chain-evm` provider: JSON-RPC reads on the public RPCs @hako/networks lists (no Alchemy, no key).

Each RPC URL is its own upstream (`networks.py`), so one RPC's rate limit or outage never blocks another chain or
the next RPC of the same chain. This provider is the catalog's face for them.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

CHAIN_EVM = Provider(
    id="chain-evm",
    display_name="EVM Chains",
    summary="Live reads on Base, Ethereum, Arbitrum, OP Mainnet and Polygon over public RPCs: balances, tokens, "
    "transactions, blocks, gas, contract calls, event logs, ENS and Basenames.",
    homepage="https://ethereum.org",
    docs_url="https://ethereum.org/developers/docs/apis/json-rpc",
    base_url="https://mainnet.base.org",  # never called directly: each RPC URL is its own upstream
    categories=(Category.crypto, Category.developer),
    terms=Terms.open,
    auth=NoAuth(),
    logo_domain="ethereum.org",
)
