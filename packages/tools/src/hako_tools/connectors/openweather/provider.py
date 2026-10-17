"""OpenWeather provider definition (free plan: current weather, 5-day / 3-hour forecast, air pollution and
geocoding; 60 calls/minute and 1M/month, openweathermap.org/price, 2026-10-07)."""

from hako_tools.categories import Category
from hako_tools.framework import Provider, Query, Terms

OPENWEATHER = Provider(
    id="openweather",
    display_name="OpenWeather",
    summary="Current weather, a 5-day forecast and air quality anywhere on Earth, plus city → coordinates "
    "geocoding.",
    homepage="https://openweathermap.org",
    docs_url="https://openweathermap.org/api",
    base_url="https://api.openweathermap.org",
    categories=(Category.weather, Category.places),
    terms=Terms.open,
    auth=Query("appid", "OPENWEATHER_API_KEY"),  # the API takes the key only in the query string
    rate="60/minute",
    max_concurrency=4,
    licence="CC BY-SA 4.0",
    attribution="OpenWeather",
)
