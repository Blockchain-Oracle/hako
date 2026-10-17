"""IPinfo Lite lookup: one public IP → country, continent and ASN."""

import ipaddress

from pydantic import Field, field_validator

from hako_tools.connectors.ipinfo.provider import IPINFO
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import STANDARD, Category, Render, RunContext, ToolInput, ToolOutput, tool

IP_MAX_CHARS = 45  # the longest textual IPv6 form (IPv4-mapped, fully expanded)


class LookupInput(ToolInput):
    ip: str = Field(min_length=2, max_length=IP_MAX_CHARS, description="A public IPv4 or IPv6 address, e.g. "
                    "'8.8.8.8' or '2606:4700::1111'.")

    @field_validator("ip")
    @classmethod
    def _public_ip(cls, value: str) -> str:
        try:
            address = ipaddress.ip_address(value)
        except ValueError as exc:
            raise ValueError("not an IPv4 or IPv6 address") from exc
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        if not address.is_global or address.is_multicast:
            raise ValueError("private, loopback, link-local, multicast and reserved addresses have no public "
                             "owner to look up")
        return address.compressed


class LookupOutput(ToolOutput):
    ip: str
    country_code: str | None = None
    country: str | None = None
    continent_code: str | None = None
    continent: str | None = None
    asn: str | None = None
    as_name: str | None = None
    as_domain: str | None = None
    anycast: bool | None = None


@tool(
    provider=IPINFO,
    slug="lookup",
    name="IPinfo IP Lookup",
    summary="Who runs an IP address and where: country, continent, ASN, network name and domain.",
    description="Looks up one public IPv4 or IPv6 address in IPinfo's Lite database: ISO country and continent, "
    "and the autonomous system that announces it (ASN such as AS15169, its name and domain), plus whether it is "
    "anycast. Country-level only: no city, coordinates, ISP contact, VPN/proxy flags or hostnames. Private, "
    "loopback and reserved ranges are rejected as invalid input.",
    categories=(Category.network,),
    render=Render.json,
    price=STANDARD,
    example={"ip": "8.8.8.8"},
    see_also=(),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def lookup(inp: LookupInput, ctx: RunContext) -> LookupOutput:
    data = await ctx.get_json(IPINFO, f"/lite/{inp.ip}")
    return LookupOutput(
        ip=data.get("ip") or inp.ip,
        country_code=data.get("country_code"),
        country=data.get("country"),
        continent_code=data.get("continent_code"),
        continent=data.get("continent"),
        asn=data.get("asn"),
        as_name=data.get("as_name"),
        as_domain=data.get("as_domain"),
        anycast=data.get("is_anycast") if "is_anycast" in data else data.get("anycast"),
    )
