"""artificial-analysis/models: the model leaderboard for one category (LLMs by intelligence, speed or price; image,
speech and video models by arena ELO)."""

from enum import StrEnum
from typing import Any

from pydantic import Field

from hako_tools.connectors.artificialanalysis.provider import ARTIFICIAL_ANALYSIS
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import (
    STANDARD,
    Category,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

LIMIT_DEFAULT = 10
LIMIT_MAX = 25
MODEL_URL = "https://artificialanalysis.ai/models/{slug}"


class BenchCategory(StrEnum):
    llm = "llm"
    text_to_image = "text_to_image"
    text_to_speech = "text_to_speech"
    text_to_video = "text_to_video"
    image_to_video = "image_to_video"


MEDIA_PATHS = {
    BenchCategory.text_to_image: "/data/media/text-to-image",
    BenchCategory.text_to_speech: "/data/media/text-to-speech",
    BenchCategory.text_to_video: "/data/media/text-to-video",
    BenchCategory.image_to_video: "/data/media/image-to-video",
}
LLM_PATH = "/data/llms/models"


class LlmSort(StrEnum):
    intelligence = "intelligence"
    speed = "speed"
    price = "price"


class ModelsInput(ToolInput):
    category: BenchCategory = Field(BenchCategory.llm, description="llm, text_to_image, text_to_speech, "
                                    "text_to_video or image_to_video.")
    sort: LlmSort = Field(LlmSort.intelligence, description="LLMs only: intelligence (index, highest first), speed "
                          "(output tokens per second) or price (blended $ per million tokens, cheapest first).")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)


class BenchModel(ToolOutput):
    id: str
    name: str
    creator: str | None = None
    rank: int | None = None
    intelligence_index: float | None = None
    output_tokens_per_s: float | None = None
    first_token_s: float | None = None
    price_input_per_m_usd: float | None = None
    price_output_per_m_usd: float | None = None
    elo: float | None = None
    url: str | None = None


class ModelsOutput(ToolOutput):
    category: str
    models: list[BenchModel]
    metric: str | None = None


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _llm(row: dict[str, Any]) -> BenchModel:
    evals, pricing = row.get("evaluations") or {}, row.get("pricing") or {}
    return BenchModel(
        id=str(row.get("id") or row.get("slug")), name=str(row.get("name") or row.get("slug")),
        creator=(row.get("model_creator") or {}).get("name"),
        intelligence_index=_num(evals.get("artificial_analysis_intelligence_index")),
        output_tokens_per_s=_num(row.get("median_output_tokens_per_second")),
        first_token_s=_num(row.get("median_time_to_first_token_seconds")),
        price_input_per_m_usd=_num(pricing.get("price_1m_input_tokens")),
        price_output_per_m_usd=_num(pricing.get("price_1m_output_tokens")),
        url=MODEL_URL.format(slug=row["slug"]) if row.get("slug") else None,
    )


_LLM_KEYS = {
    LlmSort.intelligence: (lambda m: -(m.intelligence_index or 0.0), "intelligence_index"),
    LlmSort.speed: (lambda m: -(m.output_tokens_per_s or 0.0), "output_tokens_per_s"),
    LlmSort.price: (lambda m: m.price_input_per_m_usd if m.price_input_per_m_usd is not None else float("inf"),
                    "price_input_per_m_usd"),
}


@tool(
    provider=ARTIFICIAL_ANALYSIS,
    slug="models",
    name="Artificial Analysis Model Benchmarks",
    summary="AI model leaderboards: LLMs by intelligence, speed or price; image, speech and video models by arena ELO.",
    description="Independent benchmarks from Artificial Analysis. For LLMs: the Intelligence Index, median output "
    "speed (tokens per second), time to first token and input/output price per million tokens, ranked by "
    "intelligence, speed or price. For media (text to image, text to speech, text to video, image to video): the "
    "arena ELO and rank from blind human votes. Use it to pick a model for a job. Updated as Artificial Analysis "
    "re-runs its tests; answers are cached an hour.",
    categories=(Category.developer, Category.research),
    render=Render.model_bench,
    price=STANDARD,
    example={"category": "llm", "sort": "intelligence", "limit": 5},
    see_also=("groq/summarize", "elevenlabs/tts-500"),
    cache_ttl_s=TTL_PAGE_S,
)
async def models(inp: ModelsInput, ctx: RunContext) -> ModelsOutput:
    if inp.category is BenchCategory.llm:
        data = await ctx.get_json(ARTIFICIAL_ANALYSIS, LLM_PATH)
        rows = [_llm(r) for r in (data or {}).get("data") or [] if isinstance(r, dict)]
        key, metric = _LLM_KEYS[inp.sort]
        ranked = sorted(rows, key=key)[:inp.limit]
        for i, m in enumerate(ranked, start=1):
            m.rank = i
    else:
        data = await ctx.get_json(ARTIFICIAL_ANALYSIS, MEDIA_PATHS[inp.category])
        metric = "elo"
        ranked = sorted((BenchModel(
            id=str(r.get("id") or r.get("slug")), name=str(r.get("name") or r.get("slug")),
            creator=(r.get("model_creator") or {}).get("name"), elo=_num(r.get("elo")),
            rank=r.get("rank") if isinstance(r.get("rank"), int) else None)
            for r in (data or {}).get("data") or [] if isinstance(r, dict)), key=lambda m: -(m.elo or 0.0))
        ranked = ranked[:inp.limit]
    if not ranked:
        raise ToolNotFoundResult(f"Artificial Analysis has no {inp.category.value} models right now")
    return ModelsOutput(category=inp.category.value, models=ranked, metric=metric)
