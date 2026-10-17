"""Jupiter Prediction Market API (developers.jup.ag/docs/prediction, beta; checked 2026-10-17).

Keyless reads answer 200 (`/events`, `/events/search`). Prices and volumes are micro-USD (870000 = $0.87). It
blocks US and South Korean IPs. Ids of markets mirrored from Polymarket read `POLY-<gamma market id>`.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

JUPITER = Provider(
    id="jupiter",
    display_name="Jupiter Prediction",
    summary="Prediction-market events tradable on Solana (sports, crypto, politics, culture) with YES/NO prices.",
    homepage="https://jup.ag",
    docs_url="https://developers.jup.ag/docs/prediction",
    base_url="https://api.jup.ag/prediction/v1",
    categories=(Category.finance, Category.crypto),
    terms=Terms.value_added,
    auth=NoAuth(),
    max_concurrency=4,
)
