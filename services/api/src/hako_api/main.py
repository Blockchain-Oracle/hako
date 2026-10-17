"""hako-api: the tool router. Free reads (catalog, discover, inspect, validate) and runs.

The api charges nobody: the public x402 gateway in front of it (services/gateway) is the only place that charges
agents, on its /v2 route, and it settles only after a 2xx from /v1/run here.
"""

from typing import Any

import orjson
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from hako_api.lifespan import lifespan
from hako_core.app.handlers import install_handlers
from hako_core.app.middleware import BodyLimitMiddleware, DeadlineMiddleware
from hako_core.app.responses import HakoJSONResponse
from hako_core.constants.app import APP_VERSION, HEALTH_OK
from hako_tools.categories import Category
from hako_tools.constants import (
    CATALOG_ROUTE_DEADLINE_S,
    DISCOVER_DEFAULT_LIMIT,
    DISCOVER_MAX_LIMIT,
    DISCOVER_QUERY_MAX_CHARS,
    RUN_DEADLINE_MAX_S,
    SERVICE_ID,
)
from hako_tools.framework import catalog
from hako_tools.framework.discover import discover
from hako_tools.framework.engine import resolve, run, validate_input
from hako_tools.framework.errors import ToolError, UnknownEndpoint

_HTTP_BAD_REQUEST = 400
_ENDPOINT_ID_MAX = 120

app = FastAPI(
    title="Hako Tool Router",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    redirect_slashes=False,
    default_response_class=HakoJSONResponse,
    lifespan=lifespan,
)
install_handlers(app)


def _error(status: int, code: str, message: str, *, retryable: bool = False,
           details: list[str] | None = None) -> HakoJSONResponse:
    body = {"error": {"code": code, "message": message, "retryable": retryable, "details": details or []}}
    return HakoJSONResponse(body, status_code=status)


@app.exception_handler(ToolError)
async def _on_tool_error(_: Request, exc: ToolError) -> HakoJSONResponse:
    return _error(exc.status, exc.code.value, exc.message, retryable=exc.retryable, details=exc.details)


def _identity() -> dict[str, Any]:
    body = catalog.compiled()
    return {"service": SERVICE_ID, "version": APP_VERSION, "status": HEALTH_OK, "catalog": body["hash"],
            "endpoints": len(body["endpoints"]), "providers": len(body["providers"])}


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def root() -> dict[str, Any]:
    return _identity()


@app.get("/v1/version", summary="Service identity and catalog version")
async def version() -> dict[str, Any]:
    return _identity()


@app.get("/v1/health", summary="Readiness")
async def health() -> dict[str, str]:
    return {"status": HEALTH_OK}


SPEC_PATH = f"/specs/{SERVICE_ID}.openapi.json"  # the gateway publishes it over https at the same path


@app.get(SPEC_PATH, include_in_schema=False)
async def openapi_spec() -> dict[str, Any]:
    return app.openapi()


@app.get("/v1/catalog", summary="Every provider and endpoint with input/output schemas and prices")
async def get_catalog() -> dict[str, Any]:
    return catalog.compiled()


class DiscoverBody(BaseModel):
    query: str = Field(min_length=1, max_length=DISCOVER_QUERY_MAX_CHARS)
    category: Category | None = None
    limit: int = Field(DISCOVER_DEFAULT_LIMIT, ge=1, le=DISCOVER_MAX_LIMIT)
    include_unavailable: bool = False


@app.post("/v1/discover", summary="Rank endpoints for a job, with price, health and hints")
async def post_discover(body: DiscoverBody) -> dict[str, Any]:
    return await discover(body.query, category=body.category, limit=body.limit,
                          include_unavailable=body.include_unavailable)


class InspectBody(BaseModel):
    id: str = Field(min_length=3, max_length=_ENDPOINT_ID_MAX, description="Endpoint id, e.g. firecrawl/search.")


@app.post("/v1/inspect", summary="One endpoint's full contract: description, input schema, output schema, example")
async def post_inspect(body: InspectBody) -> dict[str, Any]:
    doc = catalog.inspect(body.id)
    if doc is None:
        raise UnknownEndpoint(f"no endpoint {body.id!r}", details=["POST /v1/discover with {query} to find one"])
    return doc


@app.get("/v1/endpoints/{provider}/{slug}", include_in_schema=False)
async def get_endpoint(provider: str, slug: str) -> dict[str, Any]:
    return await post_inspect(InspectBody(id=f"{provider}/{slug}"))


@app.post("/v1/validate/{provider}/{slug}", summary="Check an input against an endpoint's schema (free, runs nothing)")
async def post_validate(provider: str, slug: str, request: Request) -> Any:
    raw = await request.body()
    try:
        payload = orjson.loads(raw) if raw.strip() else {}
    except orjson.JSONDecodeError:
        return _error(_HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.")
    validate_input(resolve(f"{provider}/{slug}"), payload)
    return {"valid": True}


@app.post("/v1/run/{provider}/{slug}", summary="Run one endpoint with its input as the JSON body")
async def post_run(provider: str, slug: str, request: Request) -> Any:
    raw = await request.body()
    try:
        payload = orjson.loads(raw) if raw.strip() else {}
    except orjson.JSONDecodeError:
        return _error(_HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.")
    return await run(f"{provider}/{slug}", payload)


# Outermost first: the body limit rejects oversized requests before anything else; every request gets a clock
# (runs set their own, tighter, per-endpoint deadline inside the engine).
app.add_middleware(DeadlineMiddleware, budget_s=max(RUN_DEADLINE_MAX_S, CATALOG_ROUTE_DEADLINE_S))
app.add_middleware(BodyLimitMiddleware)
