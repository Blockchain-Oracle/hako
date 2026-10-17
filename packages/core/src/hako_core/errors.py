"""Exceptions raised inside Hako; handlers turn them into JSON bodies."""

from hako_core.constants.http import HTTP_UNPROCESSABLE
from hako_core.contract.enums import ErrorCode


class HakoError(Exception):
    status_code: int = HTTP_UNPROCESSABLE
    code: ErrorCode = ErrorCode.invalid_input
    retryable: bool = False

    def __init__(self, message: str, *, details: list[str] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []


class InvalidInput(HakoError):
    """The request was well-formed JSON but semantically invalid (422)."""


class UnsupportedInput(HakoError):
    code = ErrorCode.unsupported


class UpstreamFailure(Exception):
    """An upstream call failed. Never surfaces as a 5xx: it becomes a SourceRef status."""

    def __init__(self, name: str, kind: str, detail: str = "") -> None:
        super().__init__(f"{name}:{kind}")
        self.name = name
        self.kind = kind
        self.detail = detail
