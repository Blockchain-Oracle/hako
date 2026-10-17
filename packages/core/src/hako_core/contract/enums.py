"""Enumerations used across the contract (specs/backend.md §2.1)."""

from enum import StrEnum


class Tristate(StrEnum):
    yes = "yes"
    no = "no"
    unknown = "unknown"


class Agreement(StrEnum):
    agree = "agree"
    minor_diff = "minor_diff"
    conflict = "conflict"
    single_source = "single_source"


class SourceStatus(StrEnum):
    ok = "ok"
    not_found = "not_found"
    unavailable = "unavailable"
    rate_limited = "rate_limited"
    skipped_budget = "skipped_budget"
    not_applicable = "not_applicable"


class CacheState(StrEnum):
    hit = "hit"
    miss = "miss"
    stale = "stale"


class ResponseStatus(StrEnum):
    complete = "complete"
    partial = "partial"


class ErrorCode(StrEnum):
    invalid_json = "invalid_json"
    invalid_input = "invalid_input"
    not_found = "not_found"
    method_not_allowed = "method_not_allowed"
    payload_too_large = "payload_too_large"
    unsupported = "unsupported"
    internal = "internal"
