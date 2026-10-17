"""World Bank Indicators API v2 provider (datahelpdesk.worldbank.org/knowledgebase/topics/125589)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

WORLDBANK = Provider(
    id="worldbank",
    display_name="World Bank Open Data",
    summary="World Development Indicators: GDP, population, inflation, unemployment and 1,400+ more series by "
    "country and year.",
    homepage="https://data.worldbank.org",
    docs_url="https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation",
    base_url="https://api.worldbank.org",
    categories=(Category.finance, Category.government),
    terms=Terms.open,
    auth=NoAuth(),  # keyless, no published request rate
    licence="CC BY 4.0",
    attribution="The World Bank: World Development Indicators (data.worldbank.org)",
)
