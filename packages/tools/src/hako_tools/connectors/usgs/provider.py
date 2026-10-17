"""USGS Earthquake Hazards provider (GeoJSON feeds + FDSN event service; earthquake.usgs.gov/fdsnws/event/1/)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

USGS = Provider(
    id="usgs",
    display_name="USGS Earthquakes",
    summary="Real-time earthquake catalogue from the US Geological Survey: magnitude, place, depth, time, tsunami "
    "flag.",
    homepage="https://earthquake.usgs.gov",
    docs_url="https://earthquake.usgs.gov/fdsnws/event/1/",
    base_url="https://earthquake.usgs.gov",
    categories=(Category.weather, Category.science),
    terms=Terms.open,
    auth=NoAuth(),  # keyless, no published request rate; the feeds are CDN-cached summaries
    licence="Public domain (US Government work)",
    attribution="U.S. Geological Survey, Earthquake Hazards Program",
)
