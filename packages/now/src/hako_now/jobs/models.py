"""/jobs request and result."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from hako_now.constants import (
    JOBS_DEFAULT_LIMIT,
    JOBS_MAX_COMPANIES,
    JOBS_MAX_LIMIT,
    JOBS_MAX_POSTED_WITHIN_DAYS,
    JOBS_MAX_QUERY_CHARS,
    MAX_PLACE_CHARS,
)
from hako_now.provenance import Provenance


class JobsRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"query": "engineer", "remote": True, "limit": 5}]})

    query: str | None = Field(default=None, max_length=JOBS_MAX_QUERY_CHARS, description="Words in the title/team")
    companies: list[str] = Field(default_factory=list, max_length=JOBS_MAX_COMPANIES)
    location: str | None = Field(default=None, max_length=MAX_PLACE_CHARS)
    remote: bool | None = None
    salary_min: int | None = Field(default=None, ge=0, description="Only postings that state a salary at or above")
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    posted_within_days: int = Field(default=JOBS_MAX_POSTED_WITHIN_DAYS, ge=1, le=JOBS_MAX_POSTED_WITHIN_DAYS)
    limit: int = Field(default=JOBS_DEFAULT_LIMIT, ge=1, le=JOBS_MAX_LIMIT)


class Job(BaseModel):
    kind: Literal["job"] = "job"
    title: str
    company: str
    location: str | None = None
    department: str | None = None
    remote: bool | None = None
    salary: str | None = None  # as the posting states it
    salary_min: int | None = None
    currency: str | None = None
    posted_at: str | None = None
    url: str
    ats: Literal["greenhouse", "lever", "ashby"]
    provenance: Provenance
