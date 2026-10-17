"""chain-evm/name: ENS (Ethereum) and Basenames (Base), forward (name → address) or reverse (address → name).

Reverse answers are checked forward (the name must resolve back to the address), so a spoofed reverse record never
shows. Basename reverse reads the L2 reverse registrar (ENSIP-19) first, then the legacy 80002105.reverse records.
"""

from typing import Any, Self

from eth_utils.address import to_checksum_address
from eth_utils.crypto import keccak
from pydantic import Field, model_validator

from hako_tools.connectors.chain_evm.abi import parse
from hako_tools.connectors.chain_evm.erc20 import eth_call, text_result
from hako_tools.connectors.chain_evm.networks import BASE, ETHEREUM, EvmChain, EvmNetwork, network
from hako_tools.connectors.chain_evm.provider import CHAIN_EVM
from hako_tools.connectors.chain_evm.rpc import EvmAddress, RpcError, batch
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool
from hako_tools.framework.errors import InvalidToolInput

ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"  # docs.ens.domains/learn/deployments (Ethereum)
BASENAMES_REGISTRY = "0xB94704422c2a1E396835A571837Aa5AE53285a95"  # github.com/base/basenames README (Base)
BASE_L2_REVERSE_REGISTRAR = "0x0000000000D8e504002cC26E3Ec46D81971C1664"  # ENSIP-19 primary names on Base
BASE_REVERSE_PARENT = "80002105.reverse"  # coin type 0x80000000 | 8453, the legacy Basenames reverse node
ENS_REVERSE_PARENT = "addr.reverse"
NAME_MAX_CHARS = 255
ADDRESS_WORD_HEX = 40
ZERO_ADDRESS = "0x" + "0" * ADDRESS_WORD_HEX
NODE_BYTES = 32
HTTPS = "https://"

RESOLVER = parse("resolver(bytes32) returns (address)")
ADDR = parse("addr(bytes32) returns (address)")
NAME = parse("name(bytes32) returns (string)")
TEXT = parse("text(bytes32,string) returns (string)")
NAME_FOR_ADDR = parse("nameForAddr(address) returns (string)")


class NameInput(ToolInput):
    chain: EvmChain = Field(description="eip155:1 for ENS names, eip155:8453 for Basenames (name.base.eth).")
    name: str | None = Field(default=None, min_length=3, max_length=NAME_MAX_CHARS,
                             description="A name to resolve to an address ('vitalik.eth', 'jesse.base.eth').")
    address: EvmAddress | None = Field(default=None, description="An address whose primary name to look up.")

    @model_validator(mode="after")
    def _one(self) -> Self:
        if (self.name is None) == (self.address is None):
            raise ValueError("give either name (forward) or address (reverse), not both")
        return self


class NameOutput(ToolOutput):
    chain: str
    name: str
    address: str
    service: str = Field(description="ens or basename.")
    direction: str = Field(description="forward (name → address) or reverse (address → name).")
    avatar_url: str | None = None


def namehash(name: str) -> bytes:
    node = b"\0" * NODE_BYTES
    for label in reversed([p for p in name.split(".") if p]):
        node = keccak(node + keccak(text=label))
    return node


def _address(raw: Any) -> str | None:
    if isinstance(raw, RpcError) or not isinstance(raw, str) or len(raw) < ADDRESS_WORD_HEX:
        return None
    found = "0x" + raw[-ADDRESS_WORD_HEX:]
    return None if found == ZERO_ADDRESS else to_checksum_address(found)


def _registry(net: EvmNetwork) -> str:
    return ENS_REGISTRY if net is ETHEREUM else BASENAMES_REGISTRY


async def _forward(ctx: RunContext, net: EvmNetwork, name: str) -> tuple[str | None, str | None]:
    """The address a name resolves to, and its https avatar if it set one."""
    node = namehash(name)
    (resolver_raw,) = await batch(ctx, net, [eth_call(RESOLVER, _registry(net), ["0x" + node.hex()])])
    resolver = _address(resolver_raw)
    if resolver is None:
        return None, None
    addr_raw, avatar_raw = await batch(ctx, net, [eth_call(ADDR, resolver, ["0x" + node.hex()]),
                                                  eth_call(TEXT, resolver, ["0x" + node.hex(), "avatar"])])
    avatar = text_result(avatar_raw)
    return _address(addr_raw), avatar if avatar and avatar.startswith(HTTPS) else None


async def _reverse(ctx: RunContext, net: EvmNetwork, address: str) -> str | None:
    hex_addr = address.lower().removeprefix("0x")
    if net is BASE:
        (primary,) = await batch(ctx, net, [eth_call(NAME_FOR_ADDR, BASE_L2_REVERSE_REGISTRAR, [address])])
        if text_result(primary):
            return text_result(primary)
        node = keccak(namehash(BASE_REVERSE_PARENT) + keccak(text=hex_addr))
    else:
        node = namehash(f"{hex_addr}.{ENS_REVERSE_PARENT}")
    (resolver_raw,) = await batch(ctx, net, [eth_call(RESOLVER, _registry(net), ["0x" + node.hex()])])
    resolver = _address(resolver_raw)
    if resolver is None:
        return None
    (name_raw,) = await batch(ctx, net, [eth_call(NAME, resolver, ["0x" + node.hex()])])
    return text_result(name_raw)


@tool(
    provider=CHAIN_EVM,
    slug="name",
    name="ENS and Basename Lookup",
    summary="Resolve an ENS name or Basename to its address, or an address to its primary name (checked both ways).",
    description="Forward: 'vitalik.eth' on eip155:1 or 'jesse.base.eth' on eip155:8453 → the address it points to, "
    "with its avatar URL when set. Reverse: an address → its primary ENS name (Ethereum) or Basename (Base), shown "
    "only when that name resolves back to the same address. Reads the official registries on public RPCs. It does "
    "not follow off-chain (CCIP-read) resolvers such as cb.id or uni.eth subnames, and other chains have no names "
    "here.",
    categories=(Category.crypto,),
    render=Render.chain_name,
    price=FREE,
    example={"chain": "eip155:1", "name": "vitalik.eth"},
    see_also=("chain-evm/balance",),
    cache_ttl_s=TTL_SEARCH_S,
)
async def name(inp: NameInput, ctx: RunContext) -> NameOutput:
    net = network(inp.chain)
    if net not in (ETHEREUM, BASE):
        raise InvalidToolInput("names live on Ethereum (ENS, eip155:1) and Base (Basenames, eip155:8453)")
    service = "ens" if net is ETHEREUM else "basename"
    if inp.name:
        wanted = inp.name.strip().lower()
        address, avatar = await _forward(ctx, net, wanted)
        if address is None:
            raise ToolNotFoundResult(f"{wanted} does not resolve to an address on {net.name}")
        return NameOutput(chain=net.caip2, name=wanted, address=address, service=service, direction="forward",
                          avatar_url=avatar)
    assert inp.address is not None  # the validator guarantees one of the two
    found = await _reverse(ctx, net, inp.address)
    if not found:
        raise ToolNotFoundResult(f"{inp.address} has no primary {service} name on {net.name}")
    check, avatar = await _forward(ctx, net, found)
    if check != inp.address:
        raise ToolNotFoundResult(f"{inp.address}'s reverse record names {found}, which does not point back to it")
    return NameOutput(chain=net.caip2, name=found, address=inp.address, service=service, direction="reverse",
                      avatar_url=avatar)
