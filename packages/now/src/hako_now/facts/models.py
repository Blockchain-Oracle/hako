"""/fact request and result."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from hako_now.constants import MAX_SUBJECT_CHARS
from hako_now.provenance import Provenance


class FactRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"subject": "Japan", "property": "head of government"}]})

    subject: str = Field(
        min_length=1, max_length=MAX_SUBJECT_CHARS, description="Wikidata QID or a name, e.g. Q30 / United States"
    )
    property: str = Field(
        min_length=1, max_length=MAX_SUBJECT_CHARS, description="Wikidata PID or an alias, e.g. P35 / head of state"
    )


class FactValue(BaseModel):
    value: str
    qid: str | None = None
    unit: str | None = None
    start: str | None = None
    point_in_time: str | None = None
    rank: Literal["preferred", "normal"]


class FactResult(BaseModel):
    kind: Literal["fact"] = "fact"
    subject_qid: str
    subject_label: str
    property_pid: str
    property_label: str | None = None
    values: list[FactValue]  # current values: preferred rank if any, no end time, latest point in time
    ended_values: int = 0  # statements left out because they have ended
    via_office: str | None = None  # the office whose current holder answered (e.g. UN Secretary-General)
    wikipedia_url: str | None = None
    provenance: Provenance
