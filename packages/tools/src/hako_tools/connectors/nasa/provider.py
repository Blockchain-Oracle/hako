"""NASA providers: api.nasa.gov (NeoWs) and science.nasa.gov, where APOD now lives.

APOD now lives on science.nasa.gov: apod.nasa.gov redirects there, and api.nasa.gov/planetary/apod answers
every date with a "NASA Science" placeholder page (checked 2026-10-07). nasa/apod therefore reads the APOD
articles from science.nasa.gov's WordPress REST API, through a second provider so that host gets its own client
and no api.nasa.gov key is ever sent to it.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Query, Terms

NASA = Provider(
    id="nasa",
    display_name="NASA",
    summary="NASA open data: the Astronomy Picture of the Day and near-Earth asteroid close approaches.",
    homepage="https://api.nasa.gov",
    docs_url="https://api.nasa.gov",
    base_url="https://api.nasa.gov",
    categories=(Category.science,),
    terms=Terms.open,
    auth=Query("api_key", "NASA_API_KEY", fallback="DEMO_KEY"),
    # DEMO_KEY allows 30 requests/hour (and 50/day) per IP; a free registered key allows 1,000/hour. Raise this to
    # "1000/hour" once NASA_API_KEY is configured.
    rate="30/hour",
    licence="Public domain (US Government work)",
    attribution="NASA / JPL-Caltech CNEOS (NeoWs)",
    logo_domain="nasa.gov",
)

NASA_SCIENCE = Provider(
    id="nasa-science",
    display_name="NASA Science",
    summary="science.nasa.gov, home of the Astronomy Picture of the Day.",
    homepage="https://science.nasa.gov/apod/",
    docs_url="https://science.nasa.gov/wp-json/",
    base_url="https://science.nasa.gov",
    categories=(Category.science,),
    terms=Terms.open,
    auth=NoAuth(),  # public WordPress REST API, no published rate limit
    # APOD images are often by outside astronomers: their credit line travels with each answer.
    licence="NASA text public domain; images as credited (often © their authors)",
    attribution="Astronomy Picture of the Day, NASA (science.nasa.gov/apod)",
    logo_domain="nasa.gov",
)
