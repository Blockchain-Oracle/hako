"""GitHub REST API provider (docs.github.com/en/rest; API version 2022-11-28)."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

GITHUB = Provider(
    id="github",
    display_name="GitHub",
    summary="Public repository metadata, repository search and latest releases from the GitHub REST API.",
    homepage="https://github.com",
    docs_url="https://docs.github.com/en/rest",
    base_url="https://api.github.com",
    categories=(Category.developer,),
    terms=Terms.allowed,
    # Optional: keyless calls get 60/hour (search 10/minute); a token raises that to 5,000/hour (search 30/minute).
    # The limit depends on whether the token is set, so it is not pinned client-side; GitHub's own 403/429 answers
    # are reported as rate limiting.
    auth=Bearer("GITHUB_TOKEN", optional=True),
    max_concurrency=4,
    attribution="GitHub",
)

# Every call pins the media type and API version GitHub recommends (docs.github.com/en/rest/about-the-rest-api).
GITHUB_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
