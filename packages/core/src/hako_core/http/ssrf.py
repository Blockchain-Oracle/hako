"""Guard for fetching user-supplied URLs (citation web checks): public addresses only, bounded reads."""

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx2

from hako_core.errors import InvalidInput

ALLOWED_SCHEMES = frozenset({"http", "https"})
MAX_REDIRECTS = 5
URL_FETCH_MAX_BYTES = 65_536
MAX_URL_CHARS = 2_048
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
# Docker/Compose service names and internal suffixes must never be reachable from user input.
BLOCKED_HOST_SUFFIXES = (".internal", ".local", ".localhost", ".svc", ".cluster.local")


class UnresolvableHost(InvalidInput):
    """The host has no DNS answer: for a cited URL that is evidence (dead domain), not a bad request."""


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


async def _resolve_public(host: str) -> str:
    """Resolve once and return the address to connect to. Every answer must be public (no mixed A records)."""
    try:
        return str(_public_ip(ipaddress.ip_address(host)))
    except ValueError:
        pass
    if "." not in host or host.endswith(BLOCKED_HOST_SUFFIXES):
        raise InvalidInput("URL host is not a public internet host.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnresolvableHost("URL host does not resolve.") from exc
    addresses = [_public_ip(ipaddress.ip_address(info[4][0])) for info in infos]
    return str(addresses[0])


def _public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    if not _is_public(ip):
        raise InvalidInput("URL resolves to a non-public address.")
    return ip


def _pinned(url: str, ip: str) -> str:
    """Same URL with the host replaced by the vetted IP (closes the DNS-rebinding window)."""
    parts = urlsplit(url)
    host = f"[{ip}]" if ":" in ip else ip
    netloc = f"{host}:{parts.port}" if parts.port else host
    return urlunsplit(parts._replace(netloc=netloc))


def validate_url(url: str) -> str:
    if len(url) > MAX_URL_CHARS:
        raise InvalidInput("URL is too long.")
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES or not parts.hostname:
        raise InvalidInput("URL must be http(s) with a host.")
    try:  # literal IPs are checked directly
        if not _is_public(ipaddress.ip_address(parts.hostname)):
            raise InvalidInput("URL points at a non-public address.")
    except ValueError:
        pass
    return url


@dataclass(slots=True)
class FetchedPage:
    status: int
    final_url: str
    body: bytes
    content_type: str


async def safe_get(client: httpx2.AsyncClient, url: str, budget_s: float) -> FetchedPage:
    """GET with manual redirects; every hop is re-validated, re-resolved and pinned to the vetted IP; body capped.

    Connecting to the IP (Host header + TLS SNI keep the real name, so certificates still verify) means a second DNS
    answer can never point the request at an internal address. `connection: close` keeps pooled sockets from being
    reused under another hostname's SNI.
    """
    current = validate_url(url)
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(current)
        host = parts.hostname or ""
        ip = await _resolve_public(host)
        extensions = {"sni_hostname": host} if parts.scheme == "https" else {}
        host_header = f"{host}:{parts.port}" if parts.port else host  # never forward userinfo
        async with client.stream(
            "GET",
            _pinned(current, ip),
            timeout=budget_s,
            follow_redirects=False,
            headers={"host": host_header, "range": f"bytes=0-{URL_FETCH_MAX_BYTES - 1}", "connection": "close"},
            extensions=extensions,
        ) as resp:
            if resp.status_code in REDIRECT_STATUSES and (loc := resp.headers.get("location")):
                current = validate_url(urljoin(current, loc))
                continue
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size >= URL_FETCH_MAX_BYTES:
                    break
            return FetchedPage(
                resp.status_code,
                current,
                b"".join(chunks)[:URL_FETCH_MAX_BYTES],
                resp.headers.get("content-type", ""),
            )
    raise InvalidInput("Too many redirects.")
