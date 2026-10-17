"""Base models for tool inputs and outputs, the shared shapes result cards understand, and the parser for the
numbers upstreams send as strings."""

from typing import Any

from pydantic import BaseModel, ConfigDict


class ToolInput(BaseModel):
    """Inputs reject unknown fields, so a typo fails before anything is paid for."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ToolOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Link(BaseModel):
    title: str
    url: str
    snippet: str | None = None
    source: str | None = None
    published: str | None = None
    position: int | None = None


class Citation(BaseModel):
    index: int
    title: str
    url: str


def to_float(value: Any) -> float | None:
    """A number an upstream sent as a number or a numeric string ("1523.45"); None when it is absent or not a number."""
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
