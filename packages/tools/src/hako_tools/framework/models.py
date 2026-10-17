"""Base models for tool inputs and outputs, and the shared shapes result cards understand."""

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
