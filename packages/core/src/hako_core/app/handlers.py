"""Exception handlers: every error is a JSON object {error:{code,message,retryable,details}}."""

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from hako_core.app.responses import HakoJSONResponse
from hako_core.constants.http import (
    HTTP_BAD_REQUEST,
    HTTP_INTERNAL,
    HTTP_METHOD_NOT_ALLOWED,
    HTTP_NOT_FOUND,
    HTTP_PAYLOAD_TOO_LARGE,
    HTTP_UNPROCESSABLE,
)
from hako_core.contract.enums import ErrorCode
from hako_core.contract.envelope import ErrorBody, ErrorEnvelope
from hako_core.errors import HakoError

log = structlog.get_logger(__name__)

MAX_ERROR_DETAILS = 10
MAX_DETAIL_CHARS = 200
_JSON_DECODE_ERROR_TYPE = "json_invalid"
_STATUS_TO_CODE = {
    HTTP_NOT_FOUND: ErrorCode.not_found,
    HTTP_METHOD_NOT_ALLOWED: ErrorCode.method_not_allowed,
    HTTP_PAYLOAD_TOO_LARGE: ErrorCode.payload_too_large,
    HTTP_BAD_REQUEST: ErrorCode.invalid_json,
    HTTP_UNPROCESSABLE: ErrorCode.invalid_input,
}


def error_response(
    status: int, code: ErrorCode, message: str, *, retryable: bool = False, details: list[str] | None = None
) -> HakoJSONResponse:
    body = ErrorEnvelope(error=ErrorBody(code=code, message=message, retryable=retryable, details=details or []))
    return HakoJSONResponse(body.model_dump(mode="json"), status_code=status)


_UNION_TAG_SUFFIX = "-str"  # e.g. "constrained-str"
_BARE_TYPE_TAGS = frozenset({"str", "int", "float", "bool"})


def _is_union_tag(part: object) -> bool:
    """Pydantic names the union branch in `loc` ("function-after[...]", "constrained-str"); callers need the field."""
    if not isinstance(part, str):
        return False
    return "[" in part or part.endswith(_UNION_TAG_SUFFIX) or part in _BARE_TYPE_TAGS


def _format_validation(exc: RequestValidationError) -> list[str]:
    # Field-by-field, never the raw repr (which leaks internal file/line info — FastAPI docs).
    out: list[str] = []
    for err in exc.errors()[:MAX_ERROR_DETAILS]:
        loc = ".".join(str(p) for p in err.get("loc", ())[1:] if not _is_union_tag(p)) or "body"
        out.append(f"{loc}: {err.get('msg', 'invalid')}"[:MAX_DETAIL_CHARS])
    return out


async def _on_validation(_: Request, exc: RequestValidationError) -> HakoJSONResponse:
    if any(e.get("type") == _JSON_DECODE_ERROR_TYPE for e in exc.errors()):
        return error_response(HTTP_BAD_REQUEST, ErrorCode.invalid_json, "Request body is not valid JSON.")
    return error_response(
        HTTP_UNPROCESSABLE,
        ErrorCode.invalid_input,
        "Request body failed validation.",
        details=_format_validation(exc),
    )


async def _on_http(_: Request, exc: StarletteHTTPException) -> HakoJSONResponse:
    code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.invalid_input)
    response = error_response(exc.status_code, code, str(exc.detail))
    if exc.headers:  # e.g. Starlette's `Allow` on a 405 (RFC 9110 §15.5.6)
        response.headers.update(exc.headers)
    return response


async def _on_hako(_: Request, exc: HakoError) -> HakoJSONResponse:
    return error_response(exc.status_code, exc.code, exc.message, retryable=exc.retryable, details=exc.details)


async def _on_unhandled(request: Request, exc: Exception) -> HakoJSONResponse:
    log.exception("unhandled_error", path=request.url.path, error=type(exc).__name__)
    return error_response(HTTP_INTERNAL, ErrorCode.internal, "Internal error.", retryable=True)


def install_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _on_validation)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _on_http)  # type: ignore[arg-type]
    app.add_exception_handler(HakoError, _on_hako)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _on_unhandled)
