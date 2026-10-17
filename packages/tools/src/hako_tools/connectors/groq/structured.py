"""Groq structured reading: extract fields as JSON, classify into labels."""

from enum import StrEnum
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.groq.chat import UNTRUSTED_TEXT_RULE, Model, complete_json, strict_object
from hako_tools.connectors.groq.provider import GROQ
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import (
    STANDARD,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolOutput,
    tool,
)

EXTRACT_MAX_CHARS = 20_000  # ≈ 5k tokens: inside the free plan's 8k tokens/minute with the prompt and answer
EXTRACT_MAX_TOKENS = 2_000
FIELDS_MAX = 30
FIELD_NAME_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]{0,63}$"
FIELD_DESCRIPTION_MAX_CHARS = 200
INSTRUCTION_MAX_CHARS = 1_000
CLASSIFY_MAX_CHARS = 10_000  # a label needs the gist, not a whole book
CLASSIFY_MAX_TOKENS = 400
LABELS_MIN = 2
LABELS_MAX = 25
LABEL_MAX_CHARS = 80
CRITERIA_MAX_CHARS = 500


class FieldType(StrEnum):
    string = "string"
    number = "number"
    integer = "integer"
    boolean = "boolean"
    string_list = "string_list"


class FieldSpec(ToolInput):
    name: str = Field(pattern=FIELD_NAME_PATTERN, description="JSON key, e.g. 'invoice_total'.")
    type: FieldType = Field(FieldType.string, description="Value type; string_list for a list of strings.")
    description: str | None = Field(None, max_length=FIELD_DESCRIPTION_MAX_CHARS,
                                    description="What to put here, e.g. 'total including tax, in USD'.")


def _property(spec: FieldSpec) -> dict[str, Any]:
    prop: dict[str, Any] = (
        {"type": ["array", "null"], "items": {"type": "string"}} if spec.type is FieldType.string_list
        else {"type": [spec.type.value, "null"]}
    )
    if spec.description:
        prop["description"] = spec.description
    return prop


class ExtractInput(ToolInput):
    text: str = Field(min_length=1, max_length=EXTRACT_MAX_CHARS, description="The text to read.")
    fields: list[FieldSpec] | None = Field(None, max_length=FIELDS_MAX,
                                           description="The keys you want back, with types. Missing values "
                                           "come back as null.")
    instruction: str | None = Field(None, max_length=INSTRUCTION_MAX_CHARS,
                                    description="Plain-language request instead of (or as well as) fields, e.g. "
                                    "'every person mentioned, with their role'.")

    @model_validator(mode="after")
    def _needs_a_shape(self) -> Self:
        if not self.fields and not self.instruction:
            raise ValueError("give fields, an instruction, or both")
        names = [f.name for f in self.fields or []]
        if len(names) != len(set(names)):
            raise ValueError("field names must be unique")
        return self


class ExtractOutput(ToolOutput):
    data: dict[str, Any]
    missing: list[str] = Field(default_factory=list, description="Requested fields the text did not contain.")


@tool(
    provider=GROQ,
    slug="extract",
    name="Groq Extract JSON",
    summary="Pull structured fields out of text as a JSON object: list the keys and types, or describe what you want.",
    description="Reads text (an email, invoice, bio, product page, transcript) and returns a JSON object. With "
    "fields, the answer has exactly those keys with those types (schema-enforced) and null for anything the "
    "text does not say; with only an instruction, the model chooses the shape. It never invents values that "
    "are not in the text. It does not fetch URLs: read the page first with jina/read.",
    categories=(Category.text_ai, Category.web_extraction),
    render=Render.json,
    price=STANDARD,
    example={
        "text": "Hi team, invoice INV-2291 from Northwind Traders is due on 14 November 2026. The total is "
        "$1,284.50 including tax. Contact: Maria Lopez, maria@northwind.example.",
        "fields": [
            {"name": "invoice_number", "type": "string"},
            {"name": "vendor", "type": "string"},
            {"name": "due_date", "type": "string", "description": "ISO date"},
            {"name": "total_usd", "type": "number"},
            {"name": "contact_email", "type": "string"},
        ],
    },
    see_also=("groq/classify", "groq/summarize", "jina/read"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def extract(inp: ExtractInput, ctx: RunContext) -> ExtractOutput:
    request = f"\nAlso follow this request: {inp.instruction}" if inp.instruction and inp.fields else ""
    if not inp.fields:
        request = f"\nReturn one JSON object that answers this request: {inp.instruction}"
    system = (
        f"{UNTRUSTED_TEXT_RULE}\nExtract information from the text as JSON. Use only what the text states; "
        "never guess or invent. Use null when a value is absent. Copy names, numbers and identifiers exactly; "
        f"write dates as YYYY-MM-DD when the text gives a full date.{request}"
    )
    schema = strict_object({f.name: _property(f) for f in inp.fields}) if inp.fields else None
    data = await complete_json(ctx, model=Model.fast, system=system, user=f"<text>\n{inp.text}\n</text>",
                               max_tokens=EXTRACT_MAX_TOKENS, schema=schema)
    missing = [f.name for f in inp.fields or [] if data.get(f.name) in (None, "", [])]
    return ExtractOutput(data=data, missing=missing)


class ClassifyInput(ToolInput):
    text: str = Field(min_length=1, max_length=CLASSIFY_MAX_CHARS, description="The text to label.")
    labels: list[str] = Field(min_length=LABELS_MIN, max_length=LABELS_MAX,
                              description="The allowed labels; exactly one is chosen.")
    criteria: str | None = Field(None, max_length=CRITERIA_MAX_CHARS,
                                 description="How to decide, e.g. 'urgent = needs a reply today'.")

    @model_validator(mode="after")
    def _clean_labels(self) -> Self:
        labels = [label.strip() for label in self.labels]
        if any(not label or len(label) > LABEL_MAX_CHARS for label in labels):
            raise ValueError(f"each label must be 1–{LABEL_MAX_CHARS} characters")
        if len({label.casefold() for label in labels}) != len(labels):
            raise ValueError("labels must be unique")
        self.labels = labels
        return self


class ClassifyOutput(ToolOutput):
    label: str
    confidence: float = Field(ge=0, le=1, description="The model's own estimate, 0–1; not a calibrated probability.")
    reason: str


@tool(
    provider=GROQ,
    slug="classify",
    name="Groq Classify",
    summary="Put text into exactly one of your labels, with a confidence and a one-sentence reason.",
    description="Zero-shot classification: give the text and 2–25 labels (sentiment, topic, intent, priority, "
    "language register...) and get back one label from your list (schema-enforced), a 0–1 confidence and the "
    "reason. Add criteria to define borderline cases. One label per call; for several attributes at once use "
    "groq/extract with boolean or string fields.",
    categories=(Category.text_ai,),
    render=Render.json,
    price=STANDARD,
    example={"text": "My card was charged twice for the same order and I need the duplicate refunded today.",
             "labels": ["billing", "shipping", "technical issue", "account access", "other"]},
    see_also=("groq/extract", "groq/summarize"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def classify(inp: ClassifyInput, ctx: RunContext) -> ClassifyOutput:
    criteria = f"\nDecision criteria: {inp.criteria}" if inp.criteria else ""
    system = (
        f"{UNTRUSTED_TEXT_RULE}\nClassify the text into exactly one of the allowed labels. Pick the best fit even "
        "when none is perfect, and lower the confidence accordingly. confidence is a number from 0 to 1. reason is "
        f"one short sentence citing what in the text decided it.{criteria}"
    )
    schema = strict_object({
        "label": {"type": "string", "enum": inp.labels},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    })
    user = "Allowed labels: " + "; ".join(inp.labels) + f"\n<text>\n{inp.text}\n</text>"
    out = await complete_json(ctx, model=Model.fast, system=system, user=user, max_tokens=CLASSIFY_MAX_TOKENS,
                              schema=schema)
    label = str(out.get("label") or "")
    by_fold = {candidate.casefold(): candidate for candidate in inp.labels}
    if label.casefold() not in by_fold:
        raise ProviderError("Groq answered with a label outside the list")
    try:
        confidence = min(1.0, max(0.0, float(out.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0
    return ClassifyOutput(label=by_fold[label.casefold()], confidence=confidence, reason=str(out.get("reason") or ""))
