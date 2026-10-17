"""PubChem provider (PUG REST; pubchem.ncbi.nlm.nih.gov/docs/pug-rest)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

PUBCHEM = Provider(
    id="pubchem",
    display_name="PubChem",
    summary="The NIH's open chemistry database: 100M+ compounds with names, formulas, weights and structures.",
    homepage="https://pubchem.ncbi.nlm.nih.gov",
    docs_url="https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
    base_url="https://pubchem.ncbi.nlm.nih.gov",
    categories=(Category.science,),
    terms=Terms.open,
    auth=NoAuth(),
    # PUG REST usage policy: at most 5 requests per second and 400 per minute (5/s is the binding one here).
    rate="5/second",
    licence="Public domain (US Government work); some depositor records carry their own terms",
    attribution="PubChem, National Library of Medicine (NIH)",
)
