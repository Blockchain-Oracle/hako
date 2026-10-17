"""The closed category list and the result-card kinds. An unknown value fails at import, never at run time."""

from enum import StrEnum


class Category(StrEnum):
    web_search = "web-search"
    web_extraction = "web-extraction"
    ai_answers = "ai-answers"
    text_ai = "text-ai"
    news = "news"
    research = "research"
    knowledge = "knowledge"
    developer = "developer"
    government = "government"
    finance = "finance"
    crypto = "crypto"
    weather = "weather"
    time = "time"
    places = "places"
    language = "language"
    science = "science"
    jobs = "jobs"
    network = "network"


CATEGORY_LABELS: dict[Category, str] = {
    Category.web_search: "Web Search",
    Category.web_extraction: "Content Extraction",
    Category.ai_answers: "AI Answers",
    Category.text_ai: "Text AI",
    Category.news: "News",
    Category.research: "Research & Papers",
    Category.knowledge: "Knowledge & Reference",
    Category.developer: "Developer",
    Category.government: "Government & Law",
    Category.finance: "Finance & Markets",
    Category.crypto: "Crypto & DeFi",
    Category.weather: "Weather & Earth",
    Category.time: "Time & Calendar",
    Category.places: "Maps & Places",
    Category.language: "Words & Language",
    Category.science: "Science & Health",
    Category.jobs: "Jobs",
    Category.network: "Internet & Network",
}


class Render(StrEnum):
    """How a client should draw `data` (the chat and the playground pick a card by this)."""

    search_results = "search_results"  # data.results[]: {title, url, snippet, source?, published?}
    answer = "answer"  # data.answer + data.citations[]
    page = "page"  # data.markdown + data.title/url
    papers = "papers"  # data.papers[]
    news = "news"  # data.articles[]
    jobs = "jobs"  # data.jobs[]
    quote = "quote"  # market quotes
    fx = "fx"  # currency rates
    weather = "weather"  # current + forecast
    place = "place"  # places / geo lookups
    package = "package"  # software packages / repos
    definition = "definition"  # words, dictionary entries
    time = "time"  # clocks, holidays, calendars
    table = "table"  # data.rows[] of flat objects
    json = "json"  # anything else
