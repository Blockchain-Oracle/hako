"""Groq provider definition (OpenAI-compatible chat completions; console.groq.com/docs, 2026-10-07)."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

GROQ = Provider(
    id="groq",
    display_name="Groq",
    summary="Fast open-weight LLMs (OpenAI gpt-oss on Groq LPUs) for text work: summarize, extract JSON, "
    "classify, translate.",
    homepage="https://groq.com",
    docs_url="https://console.groq.com/docs",
    base_url="https://api.groq.com/openai/v1",
    categories=(Category.text_ai,),
    terms=Terms.allowed,
    auth=Bearer("GROQ_API_KEY"),
    # Free plan, per model: 30 requests/min, 1k/day, 8k tokens/min (console.groq.com/docs/rate-limits).
    rate="30/minute",
    max_concurrency=4,
)
