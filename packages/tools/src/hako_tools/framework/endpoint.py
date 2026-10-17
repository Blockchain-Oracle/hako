"""An endpoint is one typed async handler plus the metadata agents rank and read (`@tool` registers it)."""

import typing
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from hako_tools.categories import Category, Render
from hako_tools.constants import RUN_DEADLINE_DEFAULT_S, RUN_DEADLINE_MAX_S, RUN_PATH_PREFIX
from hako_tools.framework.models import ToolInput, ToolOutput
from hako_tools.framework.pricing import Price
from hako_tools.framework.provider import Provider

if typing.TYPE_CHECKING:
    from hako_tools.framework.context import RunContext

Handler = Callable[[Any, "RunContext"], Awaitable[ToolOutput]]
_MS_PER_S = 1000


@dataclass(frozen=True, slots=True)
class Endpoint:
    provider: Provider
    slug: str
    display_name: str
    summary: str
    description: str  # written for an agent: what it does, what it will not do, what to call instead
    categories: tuple[Category, ...]
    render: Render
    price: Price
    example: dict[str, Any]
    input_model: type[ToolInput]
    output_model: type[ToolOutput]
    handler: Handler
    notes: tuple[str, ...] = ()
    see_also: tuple[str, ...] = ()  # endpoint ids worth trying next or instead
    deadline_s: float = RUN_DEADLINE_DEFAULT_S
    cache_ttl_s: int | None = None
    requires: tuple[Provider, ...] = ()  # other providers a composite calls (ctx.call): their keys gate this one too

    @property
    def id(self) -> str:
        return f"{self.provider.id}/{self.slug}"

    @property
    def path(self) -> str:
        return f"{RUN_PATH_PREFIX}/{self.id}"

    @property
    def available(self) -> bool:
        return self.provider.available and all(p.available for p in self.requires)

    @property
    def keyless(self) -> bool:
        """Runs without any of our provider keys, directly or through a composite's calls (free to probe)."""
        return not any(p.auth.envs for p in (self.provider, *self.requires))

    def summary_doc(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "provider": self.provider.id,
            "providerName": self.provider.display_name,
            "slug": self.slug,
            "displayName": self.display_name,
            "summary": self.summary,
            "categories": [c.value for c in self.categories],
            "render": self.render.value,
            "price": self.price.doc(),
            "method": "POST",
            "path": self.path,
            "available": self.available,
        }

    def doc(self) -> dict[str, Any]:
        return {
            **self.summary_doc(),
            "description": self.description,
            "notes": list(self.notes),
            "seeAlso": list(self.see_also),
            "deadlineMs": round(self.deadline_s * _MS_PER_S),
            "cacheTtlS": self.cache_ttl_s,
            "terms": self.provider.terms.value,
            "input": _schema(self.input_model),
            "output": _schema(self.output_model),
            "example": self.example,
        }


def _schema(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema(mode="validation")


REGISTRY: dict[str, Endpoint] = {}


def tool(
    *,
    provider: Provider,
    slug: str,
    name: str,
    summary: str,
    description: str,
    categories: tuple[Category, ...],
    render: Render,
    price: Price,
    example: dict[str, Any],
    notes: tuple[str, ...] = (),
    see_also: tuple[str, ...] = (),
    deadline_s: float = RUN_DEADLINE_DEFAULT_S,
    cache_ttl_s: int | None = None,
    requires: tuple[Provider, ...] = (),
) -> Callable[[Handler], Handler]:
    """Register `async def handler(inp: SomeInput, ctx: RunContext) -> SomeOutput` as `<provider>/<slug>`."""
    if deadline_s > RUN_DEADLINE_MAX_S:
        raise ValueError(f"{provider.id}/{slug}: deadline {deadline_s}s exceeds {RUN_DEADLINE_MAX_S}s")

    def register(handler: Handler) -> Handler:
        hints = typing.get_type_hints(handler)
        params = [p for p in hints if p != "return"]
        input_model, output_model = hints[params[0]], hints["return"]
        if not (issubclass(input_model, ToolInput) and issubclass(output_model, ToolOutput)):
            raise TypeError(f"{provider.id}/{slug}: handler must take a ToolInput and return a ToolOutput")
        endpoint = Endpoint(
            provider=provider,
            slug=slug,
            display_name=name,
            summary=summary,
            description=description,
            categories=categories,
            render=render,
            price=price,
            example=example,
            input_model=input_model,
            output_model=output_model,
            handler=handler,
            notes=notes,
            see_also=see_also,
            deadline_s=deadline_s,
            cache_ttl_s=cache_ttl_s,
            requires=requires,
        )
        if endpoint.id in REGISTRY:
            raise ValueError(f"duplicate endpoint id {endpoint.id}")
        input_model.model_validate(example)  # the published example must itself be valid input
        REGISTRY[endpoint.id] = endpoint
        return handler

    return register
