"""arXiv provider (legacy query API, Atom feed; info.arxiv.org/help/api/user-manual.html)."""

import re

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

ARXIV = Provider(
    id="arxiv",
    display_name="arXiv",
    summary="Search 2.5M+ preprints in physics, mathematics, computer science, biology, finance and statistics.",
    homepage="https://arxiv.org",
    docs_url="https://info.arxiv.org/help/api/user-manual.html",
    base_url="https://export.arxiv.org",
    categories=(Category.research,),
    terms=Terms.open,
    auth=NoAuth(),
    # Terms of use: "no more than one request every three seconds" on "a single connection at a time".
    rate="1/3second",
    max_concurrency=1,
    # Metadata only: e-prints (PDFs, source) are the authors' and may not be redistributed, so we only link to them.
    licence="Metadata CC0 1.0",
    attribution="Thank you to arXiv for use of its open access interoperability.",
)

# One arXiv identifier, with or without the "arxiv:" prefix other indexes use and a version suffix: new style
# (2211.17192, 2211.17192v2) or old style (hep-th/9901001, math.GT/0309136). Group 1 is the id without its version.
ARXIV_ID = re.compile(r"^(?:arxiv:)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$", re.IGNORECASE)
ARXIV_DOI_PREFIX = "10.48550/arxiv."  # arXiv registers every paper's DOI as 10.48550/arXiv.<id>
