"""The success envelope. FIELD ORDER IS BYTE ORDER: safe metadata first, untrusted results later."""

from pydantic import BaseModel, Field

from hako_core.contract.enums import ErrorCode, ResponseStatus
from hako_core.contract.sources import SourceRef


class Envelope[T](BaseModel):
    service: str
    operation: str
    version: str
    status: ResponseStatus
    as_of: str
    deadline_ms: int
    elapsed_ms: int
    unavailable: list[str] = Field(default_factory=list)  # upstream names only — safe words
    summary: dict[str, int] = Field(default_factory=dict)  # counts per verdict
    results: list[T] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    retryable: bool
    details: list[str] = Field(default_factory=list)


class ErrorEnvelope(BaseModel):
    error: ErrorBody
