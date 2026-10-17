"""How a provider's credential reaches the upstream. Keys are read from the environment at call time and are
injected only inside the transport (never into inputs, outputs, logs or the catalog)."""

import os
from dataclasses import dataclass
from typing import Any


def secret(env: str) -> str | None:
    value = os.environ.get(env, "").strip()
    return value or None


@dataclass(frozen=True, slots=True)
class NoAuth:
    @property
    def envs(self) -> tuple[str, ...]:
        return ()

    def inject(self, request: dict[str, Any]) -> None:
        return None


@dataclass(frozen=True, slots=True)
class Header:
    """`<name>: <prefix><key>`, e.g. `X-API-KEY: …`."""

    name: str
    env: str
    prefix: str = ""
    optional: bool = False  # True: the provider works without it (keyless limits) and uses it when present

    @property
    def envs(self) -> tuple[str, ...]:
        return () if self.optional else (self.env,)

    def inject(self, request: dict[str, Any]) -> None:
        key = secret(self.env)
        if key or not self.optional:
            request.setdefault("headers", {})[self.name] = f"{self.prefix}{key or ''}"


def Bearer(env: str, *, optional: bool = False) -> Header:
    return Header("Authorization", env, prefix="Bearer ", optional=optional)


@dataclass(frozen=True, slots=True)
class Query:
    """`?<param>=<key>` for upstreams that only take the key in the query string."""

    param: str
    env: str
    fallback: str | None = None  # a public demo key (e.g. NASA's DEMO_KEY) used when ours is not configured

    @property
    def envs(self) -> tuple[str, ...]:
        return () if self.fallback else (self.env,)

    def inject(self, request: dict[str, Any]) -> None:
        request.setdefault("params", {})[self.param] = secret(self.env) or self.fallback or ""


Auth = NoAuth | Header | Query
