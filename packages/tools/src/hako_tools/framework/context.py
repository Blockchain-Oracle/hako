"""What a handler gets: authenticated JSON/text calls to its providers, the deadline, sources, notes, and the
ability to call another endpoint (composites such as hako/answer)."""

import time
from datetime import UTC, datetime
from typing import Any

import httpx2
import orjson
import structlog

from hako_core.constants.http import HTTP_CLIENT_ERROR_MIN, HTTP_NOT_FOUND
from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import Deadline
from hako_core.errors import UpstreamFailure
from hako_core.http.client import UpstreamClient
from hako_tools.framework.endpoint import REGISTRY, Endpoint
from hako_tools.framework.errors import (
    HTTP_TOO_MANY,
    InvalidToolInput,
    ProviderError,
    ProviderRateLimited,
    RunDeadlineExceeded,
    ToolNotFoundResult,
    ToolUnavailable,
    UnknownEndpoint,
)
from hako_tools.framework.models import ToolOutput
from hako_tools.framework.provider import Provider

log = structlog.get_logger(__name__)
_MS_PER_S = 1000
_HTTP_UNAUTHORIZED = 401
_HTTP_FORBIDDEN = 403
_ERROR_SNIPPET_CHARS = 160
_clients: dict[str, UpstreamClient] = {}


def client_for(provider: Provider) -> UpstreamClient:
    existing = _clients.get(provider.id)
    if existing is None:
        existing = _clients[provider.id] = UpstreamClient(provider.upstream_spec())
    return existing


async def close_clients() -> None:
    for c in _clients.values():
        await c.aclose()
    _clients.clear()


def _snippet(resp: httpx2.Response) -> str:
    return resp.text[:_ERROR_SNIPPET_CHARS].replace("\n", " ")


class RunContext:
    def __init__(self, endpoint: Endpoint, deadline: Deadline) -> None:
        self.endpoint = endpoint
        self.deadline = deadline
        self.sources: list[SourceRef] = []
        self.notes: list[str] = []

    def note(self, text: str) -> None:
        self.notes.append(text)

    async def get_json(self, provider: Provider, path: str, *, params: dict[str, Any] | None = None,
                       headers: dict[str, str] | None = None) -> Any:
        return _decode(provider, await self._send(provider, "GET", path, params=params, headers=headers))

    async def post_json(self, provider: Provider, path: str, *, json: Any = None,
                        params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        resp = await self._send(provider, "POST", path, params=params, json=json, headers=headers)
        return _decode(provider, resp)

    async def get_text(self, provider: Provider, path: str, *, params: dict[str, Any] | None = None,
                       headers: dict[str, str] | None = None) -> str:
        return (await self._send(provider, "GET", path, params=params, headers=headers)).text

    async def post_bytes(self, provider: Provider, path: str, *, json: Any = None,
                         params: dict[str, Any] | None = None,
                         headers: dict[str, str] | None = None) -> tuple[bytes, dict[str, str]]:
        """A binary answer (generated audio): the bytes and the response headers (content type, provider cost)."""
        resp = await self._send(provider, "POST", path, params=params, json=json, headers=headers)
        return resp.content, {k.lower(): v for k, v in resp.headers.items()}

    async def call(self, endpoint_id: str, payload: dict[str, Any]) -> ToolOutput:
        """Run another endpoint's handler inside this run (same deadline; its sources join ours)."""
        target = REGISTRY.get(endpoint_id)
        if target is None:
            raise UnknownEndpoint(f"no endpoint {endpoint_id!r}")
        try:
            inp = target.input_model.model_validate(payload)
        except ValueError as exc:
            raise InvalidToolInput(f"{endpoint_id}: invalid composed input", details=[str(exc)[:200]]) from exc
        return await target.handler(inp, self)

    async def _send(self, provider: Provider, method: str, path: str, *, params: dict[str, Any] | None = None,
                    json: Any = None, headers: dict[str, str] | None = None) -> httpx2.Response:
        if not provider.available:
            raise ToolUnavailable(f"{provider.display_name} is not configured on this server")
        request: dict[str, Any] = {"params": dict(params or {}), "headers": dict(headers or {})}
        provider.auth.inject(request)
        if json is not None:
            request["content"] = orjson.dumps(json)
            request["headers"].setdefault("content-type", "application/json")
        started = time.monotonic()
        try:
            resp = await client_for(provider).request(method, path, **request)
        except UpstreamFailure as exc:
            if exc.kind == "deadline_exceeded":
                raise RunDeadlineExceeded(f"{provider.display_name} did not answer within the deadline") from exc
            if exc.kind == SourceStatus.rate_limited:
                raise ProviderRateLimited(f"{provider.display_name} is rate limiting Hako; retry shortly") from exc
            raise ProviderError(f"{provider.display_name} is unreachable right now") from exc
        latency = round((time.monotonic() - started) * _MS_PER_S)
        self._check(provider, resp)
        self.sources.append(
            SourceRef(
                name=provider.id,
                status=SourceStatus.ok,
                url=f"{provider.base_url}{path}",  # never the full URL: a query-string key must not leak
                licence=provider.licence,
                attribution=provider.attribution,
                fetched_at=datetime.now(UTC).isoformat(timespec="seconds"),
                latency_ms=latency,
            )
        )
        return resp

    @staticmethod
    def _check(provider: Provider, resp: httpx2.Response) -> None:
        status = resp.status_code
        if status < HTTP_CLIENT_ERROR_MIN:
            return
        if status == HTTP_NOT_FOUND:
            raise ToolNotFoundResult(f"{provider.display_name} has no record for this request")
        if status == HTTP_TOO_MANY:
            client_for(provider)._cool_down(resp.headers.get("retry-after"))  # stop calling until it recovers
            raise ProviderRateLimited(f"{provider.display_name} is rate limiting Hako; retry shortly")
        if status in (_HTTP_UNAUTHORIZED, _HTTP_FORBIDDEN):
            log.error("provider_auth_rejected", provider=provider.id, status=status)
            raise ProviderError(f"{provider.display_name} rejected the request (HTTP {status})")
        raise ProviderError(f"{provider.display_name} answered HTTP {status}", details=[_snippet(resp)])


def _decode(provider: Provider, resp: httpx2.Response) -> Any:
    try:
        return orjson.loads(resp.content)
    except orjson.JSONDecodeError as exc:
        raise ProviderError(f"{provider.display_name} returned something that is not JSON") from exc
