"""Pure-ASGI middleware: body limit (handles chunked bodies) and per-service deadline."""

import uuid

import orjson
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from hako_core.constants.app import REQUEST_ID_HEADER
from hako_core.constants.http import HTTP_PAYLOAD_TOO_LARGE, JSON_MEDIA_TYPE, MAX_REQUEST_BYTES
from hako_core.contract.enums import ErrorCode
from hako_core.deadline import Deadline, set_deadline

_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})
_TOO_LARGE_BODY = orjson.dumps(
    {
        "error": {
            "code": ErrorCode.payload_too_large,
            "message": "Request body exceeds the size limit.",
            "retryable": False,
            "details": [f"max_bytes={MAX_REQUEST_BYTES}"],
        }
    }
)


async def _send_too_large(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": HTTP_PAYLOAD_TOO_LARGE,
            "headers": [
                (b"content-type", JSON_MEDIA_TYPE.encode()),
                (b"content-length", str(len(_TOO_LARGE_BODY)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


class BodyLimitMiddleware:
    """Buffers the request body (≤ MAX_REQUEST_BYTES) and replays it; rejects early when too large.

    A proxy may forward a body chunked with no Content-Length, so counting chunks is mandatory.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await _send_too_large(send)
            return
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await _send_too_large(send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class DeadlineMiddleware:
    """Starts the request clock for one service sub-app and tags the request id."""

    def __init__(self, app: ASGIApp, budget_s: float) -> None:
        self.app = app
        self.budget_s = budget_s

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            set_deadline(Deadline(self.budget_s))
            scope.setdefault("state", {})["request_id"] = uuid.uuid4().hex
            request_id = scope["state"]["request_id"].encode()

            async def send_with_id(message: Message) -> None:
                if message["type"] == "http.response.start":
                    message.setdefault("headers", []).append((REQUEST_ID_HEADER.encode(), request_id))
                await send(message)

            await self.app(scope, receive, send_with_id)
            return
        await self.app(scope, receive, send)
