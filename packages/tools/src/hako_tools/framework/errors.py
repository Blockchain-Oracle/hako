"""Run failures. Each maps to one HTTP status + code; any non-2xx means the x402 payment is never settled."""

from enum import StrEnum

from hako_core.constants.http import HTTP_NOT_FOUND, HTTP_UNPROCESSABLE

HTTP_TOO_MANY: int = 429
HTTP_BAD_GATEWAY: int = 502
HTTP_UNAVAILABLE: int = 503
HTTP_GATEWAY_DEADLINE: int = 504


class ToolErrorCode(StrEnum):
    unknown_endpoint = "unknown_endpoint"
    invalid_input = "invalid_input"
    tool_unavailable = "tool_unavailable"
    provider_error = "provider_error"
    provider_rate_limited = "provider_rate_limited"
    deadline_exceeded = "deadline_exceeded"
    output_contract = "output_contract"


class ToolError(Exception):
    status: int = HTTP_BAD_GATEWAY
    code: ToolErrorCode = ToolErrorCode.provider_error
    retryable: bool = False

    def __init__(self, message: str, *, details: list[str] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []


class UnknownEndpoint(ToolError):
    status = HTTP_NOT_FOUND
    code = ToolErrorCode.unknown_endpoint


class InvalidToolInput(ToolError):
    status = HTTP_UNPROCESSABLE
    code = ToolErrorCode.invalid_input


class ToolUnavailable(ToolError):
    status = HTTP_UNAVAILABLE
    code = ToolErrorCode.tool_unavailable


class ProviderError(ToolError):
    """The provider answered with an error (or something we cannot read). The run settles at zero."""


class ProviderRateLimited(ToolError):
    status = HTTP_TOO_MANY
    code = ToolErrorCode.provider_rate_limited
    retryable = True


class RunDeadlineExceeded(ToolError):
    status = HTTP_GATEWAY_DEADLINE
    code = ToolErrorCode.deadline_exceeded
    retryable = True


class OutputContractError(ToolError):
    code = ToolErrorCode.output_contract


class ToolNotFoundResult(Exception):
    """Raised by a handler when the upstream says the thing does not exist. This is an answer, not a failure: the
    engine returns 200 with `found: false` so the agent learns it, and `billable: false`, so the gateway never
    settles the payment (an unmatched lookup completes as data and is never charged)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
