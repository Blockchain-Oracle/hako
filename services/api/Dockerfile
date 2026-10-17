# hako-api — FastAPI serving the tool router behind hako-gateway (catalog, discover, inspect, validate, run).
# Build context: repo root. Pattern: uv docs "Intermediate layers in workspaces" + non-editable multi-stage.

ARG PYTHON_VERSION=3.13
FROM python:${PYTHON_VERSION}-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /bin/
ENV UV_PYTHON_DOWNLOADS=0 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app

# 1) dependencies only (member pyproject files are not present yet → --frozen)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace --no-dev --package hako-api

# 2) workspace source, then the members themselves (non-editable so .venv is self-contained)
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable --no-dev --package hako-api

FROM python:${PYTHON_VERSION}-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 hako \
    && mkdir -p /data && chown hako:hako /data  # a new named volume inherits this ownership
COPY --from=builder --chown=hako:hako /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONTZPATH="" \
    HAKO_ENV=production \
    HAKO_DATA_DIR=/data
USER hako
WORKDIR /app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8000/v1/health || exit 1
# One worker (health samples and the discover index are per-process; Redis shares health with tasks);
# no --limit-concurrency (it answers with a plain-text 503).
CMD ["uvicorn", "hako_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--loop", "uvloop", "--http", "httptools", "--no-server-header", "--timeout-keep-alive", "75"]
