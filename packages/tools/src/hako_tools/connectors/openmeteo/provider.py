"""Open-Meteo providers (open-meteo.com/en/docs, checked 2026-10-07).

Each API lives on its own host, so each gets its own Provider (and client); every endpoint registers under
OPEN_METEO (`open-meteo/<slug>`). The free tier allows 600 calls/minute, 5,000/hour and 10,000/day per IP.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

_LICENCE = "CC BY 4.0 (weather data); free API tier"
_ATTRIBUTION = "Weather data by Open-Meteo.com"
_RATE = "600/minute"

OPEN_METEO = Provider(
    id="open-meteo",
    display_name="Open-Meteo",
    summary="Open weather models: 16-day forecasts, hourly-resolution history since 1940 and marine wave forecasts, "
    "for any coordinates on Earth.",
    homepage="https://open-meteo.com",
    docs_url="https://open-meteo.com/en/docs",
    base_url="https://api.open-meteo.com",
    categories=(Category.weather,),
    terms=Terms.open,
    auth=NoAuth(),
    rate=_RATE,
    licence=_LICENCE,
    attribution=_ATTRIBUTION,
)

OPEN_METEO_ARCHIVE = Provider(
    id="open-meteo-archive",
    display_name="Open-Meteo Historical Weather",
    summary="ERA5 reanalysis and archived forecasts since 1940.",
    homepage="https://open-meteo.com/en/docs/historical-weather-api",
    base_url="https://archive-api.open-meteo.com",
    categories=(Category.weather,),
    terms=Terms.open,
    auth=NoAuth(),
    rate=_RATE,
    licence=_LICENCE,
    attribution=_ATTRIBUTION,
)

OPEN_METEO_MARINE = Provider(
    id="open-meteo-marine",
    display_name="Open-Meteo Marine",
    summary="Wave height, period and direction forecasts.",
    homepage="https://open-meteo.com/en/docs/marine-weather-api",
    base_url="https://marine-api.open-meteo.com",
    categories=(Category.weather,),
    terms=Terms.open,
    auth=NoAuth(),
    rate=_RATE,
    licence=_LICENCE,
    attribution=_ATTRIBUTION,
)

OPEN_METEO_GEOCODING = Provider(
    id="open-meteo-geocoding",
    display_name="Open-Meteo Geocoding",
    summary="Place name → coordinates and time zone (GeoNames).",
    homepage="https://open-meteo.com/en/docs/geocoding-api",
    base_url="https://geocoding-api.open-meteo.com",
    categories=(Category.places,),
    terms=Terms.open,
    auth=NoAuth(),
    rate=_RATE,
    licence="CC BY 4.0 (GeoNames)",
    attribution="Geocoding by Open-Meteo.com (GeoNames)",
)
