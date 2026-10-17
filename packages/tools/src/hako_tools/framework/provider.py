"""A provider: who serves the data, how we authenticate, how hard we may call it, and on what terms."""

from dataclasses import dataclass, field
from enum import StrEnum

from hako_core.http.registry import UpstreamSpec
from hako_tools.categories import Category
from hako_tools.constants import PROVIDER_CONCURRENCY_DEFAULT, PROVIDER_CONNECT_S, PROVIDER_TIMEOUT_DEFAULT_S
from hako_tools.framework.auth import Auth, NoAuth, secret


class Terms(StrEnum):
    """Our reading of the provider's terms for serving its output to our callers (provider research, 2026-10-07)."""

    open = "open"  # open data / licence allows redistribution (with attribution where stated)
    allowed = "allowed"  # terms let our end users receive output through our application
    value_added = "value-added"  # only as-is mirroring is banned; we normalise and add provenance
    consent_pending = "consent-pending"  # resale needs the provider's written OK, not yet given
    ours = "ours"  # Hako's own computation


@dataclass(frozen=True, slots=True)
class Provider:
    id: str  # url-safe slug, e.g. "firecrawl"
    display_name: str
    summary: str
    homepage: str
    base_url: str
    categories: tuple[Category, ...]
    terms: Terms
    auth: Auth = field(default_factory=NoAuth)
    max_concurrency: int = PROVIDER_CONCURRENCY_DEFAULT
    rate: str | None = None  # `limits` string, e.g. "5/second"
    timeout_s: float = PROVIDER_TIMEOUT_DEFAULT_S
    connect_s: float = PROVIDER_CONNECT_S
    licence: str | None = None
    attribution: str | None = None
    docs_url: str | None = None
    logo_domain: str | None = None  # the web draws the provider mark from this domain

    @property
    def available(self) -> bool:
        """True when every credential the provider needs is configured (keyless providers always are)."""
        return all(secret(env) for env in self.auth.envs)

    def upstream_spec(self) -> UpstreamSpec:
        return UpstreamSpec(
            name=self.id,
            base_url=self.base_url,
            max_concurrency=self.max_concurrency,
            total_s=self.timeout_s,
            connect_s=self.connect_s,
            rate=self.rate,
            retry_attempts=1,  # a paid run must not silently double an upstream charge
            licence=self.licence,
            attribution=self.attribution,
        )

    def doc(self, endpoint_count: int) -> dict[str, object]:
        return {
            "id": self.id,
            "displayName": self.display_name,
            "summary": self.summary,
            "homepage": self.homepage,
            "docsUrl": self.docs_url,
            "categories": [c.value for c in self.categories],
            "terms": self.terms.value,
            "licence": self.licence,
            "attribution": self.attribution,
            "logoDomain": self.logo_domain or self.homepage.split("//")[-1].split("/")[0],
            "endpointCount": endpoint_count,
            "available": self.available,
        }
