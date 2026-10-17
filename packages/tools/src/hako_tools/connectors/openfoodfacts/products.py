"""Open Food Facts endpoints: one product by barcode (API v3), and product search (Search-a-licious)."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.openfoodfacts.provider import OPENFOODFACTS, OPENFOODFACTS_SEARCH
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

BARCODE_PATTERN = r"^\d{8,14}$"  # EAN-8, UPC-A (12), EAN-13, GTIN-14
INGREDIENTS_CHARS = 1_000
TAGS_SHOWN = 8
SEARCH_DEFAULT = 5
SEARCH_MAX = 20
UNKNOWN = "unknown"
PRODUCT_FIELDS = ("code,product_name,brands,quantity,nutriscore_grade,nova_group,ecoscore_grade,ingredients_text,"
                  "allergens_tags,traces_tags,labels_tags,categories_tags,nutriments,image_front_url")
SEARCH_FIELDS = "code,product_name,brands,quantity,nutriscore_grade,nova_group,image_front_small_url"
# Per-100 g nutriments kept, as (Open Food Facts key, our key).
NUTRIMENTS: tuple[tuple[str, str], ...] = (
    ("energy-kcal_100g", "energy_kcal"),
    ("fat_100g", "fat_g"),
    ("saturated-fat_100g", "saturated_fat_g"),
    ("carbohydrates_100g", "carbohydrates_g"),
    ("sugars_100g", "sugars_g"),
    ("fiber_100g", "fiber_g"),
    ("proteins_100g", "proteins_g"),
    ("salt_100g", "salt_g"),
)


def _tags(values: list[str] | None) -> list[str]:
    """'en:gluten-free' → 'gluten free' (the language prefix only says which taxonomy entry it is)."""
    return [v.split(":", 1)[-1].replace("-", " ") for v in values or []][:TAGS_SHOWN]


def _grade(value: Any) -> str | None:
    return None if value in (None, "", UNKNOWN, "not-applicable") else str(value)


def _product_url(code: str) -> str:
    return f"https://world.openfoodfacts.org/product/{code}"


class ProductInput(ToolInput):
    barcode: str = Field(pattern=BARCODE_PATTERN, description="The EAN/UPC barcode digits, e.g. '3017624010701'.")


class ProductOutput(ToolOutput):
    barcode: str
    name: str | None = None
    brands: str | None = None
    quantity: str | None = None
    nutriscore: str | None = None  # a (best) … e
    nova_group: int | None = None  # 1 unprocessed … 4 ultra-processed
    eco_score: str | None = None
    ingredients: str | None = None
    allergens: list[str] = Field(default_factory=list)
    traces: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    per_100g: dict[str, float] = Field(default_factory=dict)
    image_url: str | None = None
    url: str


@tool(
    provider=OPENFOODFACTS,
    slug="product",
    name="Open Food Facts Product",
    summary="A packaged food by barcode: name, brand, Nutri-Score, NOVA group, ingredients, allergens, nutrition.",
    description="Looks up one product in the crowd-sourced Open Food Facts database by its EAN/UPC barcode and "
    "returns name, brand, quantity, Nutri-Score (a–e), NOVA processing group (1–4), Eco-Score, ingredients text, "
    "allergens and traces, labels, categories and key nutrients per 100 g. Data is entered by volunteers and can "
    "be incomplete; it is not medical or allergy advice, so check the package. Unknown barcodes answer "
    "found=false. To find a barcode from a name use openfoodfacts/search.",
    categories=(Category.science,),
    render=Render.json,
    price=LOCAL,
    example={"barcode": "3017624010701"},
    see_also=("openfoodfacts/search",),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def product(inp: ProductInput, ctx: RunContext) -> ProductOutput:
    data = await ctx.get_json(OPENFOODFACTS, f"/api/v3/product/{inp.barcode}", params={"fields": PRODUCT_FIELDS})
    item = data.get("product")
    if not item:
        raise ToolNotFoundResult(f"Open Food Facts has no product with barcode {inp.barcode}")
    nutriments = item.get("nutriments") or {}
    ingredients = item.get("ingredients_text")
    code = str(item.get("code") or inp.barcode)
    return ProductOutput(
        barcode=code,
        name=item.get("product_name") or None,
        brands=item.get("brands") or None,
        quantity=item.get("quantity") or None,
        nutriscore=_grade(item.get("nutriscore_grade")),
        nova_group=item.get("nova_group"),
        eco_score=_grade(item.get("ecoscore_grade")),
        ingredients=ingredients[:INGREDIENTS_CHARS] if ingredients else None,
        allergens=_tags(item.get("allergens_tags")),
        traces=_tags(item.get("traces_tags")),
        labels=_tags(item.get("labels_tags")),
        categories=_tags(item.get("categories_tags")),
        per_100g={ours: float(nutriments[key]) for key, ours in NUTRIMENTS
                  if isinstance(nutriments.get(key), int | float)},
        image_url=item.get("image_front_url"),
        url=_product_url(code),
    )


class SearchInput(ToolInput):
    query: str = Field(min_length=2, max_length=200, description="Product or brand words, e.g. 'greek yogurt'.")
    limit: int = Field(SEARCH_DEFAULT, ge=1, le=SEARCH_MAX)


class ProductRow(ToolOutput):
    barcode: str
    name: str | None = None
    brands: str | None = None
    quantity: str | None = None
    nutriscore: str | None = None
    nova_group: int | None = None
    image_url: str | None = None
    url: str


class SearchOutput(ToolOutput):
    query: str
    total: int | None = None
    rows: list[ProductRow]


def _row(hit: dict[str, Any]) -> ProductRow:
    brands = hit.get("brands")
    code = str(hit.get("code", ""))
    return ProductRow(
        barcode=code,
        name=hit.get("product_name") or None,
        brands=", ".join(brands) if isinstance(brands, list) else brands or None,
        quantity=hit.get("quantity") or None,
        nutriscore=_grade(hit.get("nutriscore_grade")),
        nova_group=hit.get("nova_group"),
        image_url=hit.get("image_front_small_url"),
        url=_product_url(code),
    )


@tool(
    provider=OPENFOODFACTS,
    slug="search",
    name="Open Food Facts Search",
    summary="Search packaged food products by name or brand: barcode, brand, quantity, Nutri-Score, NOVA group.",
    description="Full-text search over Open Food Facts products (Search-a-licious), returning barcodes to pass to "
    "openfoodfacts/product for ingredients, allergens and nutrition. Results are ranked by text match across "
    "names, brands and categories, worldwide. Open Food Facts allows 10 searches per minute, so prefer one precise "
    "query over many. It does not compare prices or availability.",
    categories=(Category.science,),
    render=Render.table,
    price=LOCAL,
    example={"query": "greek yogurt", "limit": 5},
    see_also=("openfoodfacts/product",),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    data = await ctx.get_json(OPENFOODFACTS_SEARCH, "/search",
                              params={"q": inp.query, "page_size": inp.limit, "fields": SEARCH_FIELDS})
    return SearchOutput(query=inp.query, total=data.get("count"), rows=[_row(h) for h in data.get("hits") or []])
