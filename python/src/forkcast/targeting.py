"""Audience targeting: decide whether a user matches an experiment's conditions.

Mirrors ``src/core/targeting.ts``. String comparisons are case-insensitive and
values are compared the way JavaScript would, so a rule behaves the same in
every SDK.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, List, Mapping, Optional, Pattern

from ._js import UNDEFINED, is_nullish, js_number, js_parse_int, js_string

OPERATORS = (
    "eq",
    "neq",
    "in",
    "notIn",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
    "gt",
    "gte",
    "lt",
    "lte",
    "regex",
    "exists",
    "notExists",
    "semverGte",
    "semverLt",
)


def get_attribute(user: Mapping[str, Any], path: str) -> Any:
    """Read ``a.b.c`` style paths from the user context. Missing -> ``UNDEFINED``."""
    if path in user:
        return user[path]
    cur: Any = user
    for part in path.split("."):
        if isinstance(cur, Mapping):
            cur = cur.get(part, UNDEFINED)
        elif isinstance(cur, (list, tuple)) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return UNDEFINED
    return cur


def _norm(value: Any) -> Any:
    return value.lower() if isinstance(value, str) else value


def _s(value: Any) -> str:
    return js_string(_norm(value))


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, str):
        return [s.strip() for s in value.split(",")]
    return [value]


_SEMVER_SPLIT = re.compile(r"[.+-]")


def compare_semver(a: str, b: str) -> int:
    """Compare dotted versions. Returns -1, 0 or 1. Non-numeric parts compare as 0."""
    pa = [js_parse_int(p) for p in _SEMVER_SPLIT.split(re.sub(r"^v", "", str(a)))[:3]]
    pb = [js_parse_int(p) for p in _SEMVER_SPLIT.split(re.sub(r"^v", "", str(b)))[:3]]
    for i in range(3):
        d = (pa[i] if i < len(pa) else 0) - (pb[i] if i < len(pb) else 0)
        if d != 0:
            return 1 if d > 0 else -1
    return 0


@lru_cache(maxsize=256)
def _compile(pattern: str) -> Optional[Pattern[str]]:
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error:
        return None


def match_condition(user: Mapping[str, Any], condition: Mapping[str, Any]) -> bool:
    """Evaluate a single condition. String comparisons are case-insensitive."""
    actual = get_attribute(user, str(condition.get("attribute", "")))
    expected = condition.get("value", UNDEFINED)
    op = condition.get("operator")

    if op == "exists":
        return not is_nullish(actual) and actual != ""
    if op == "notExists":
        return is_nullish(actual) or actual == ""

    if is_nullish(actual):
        # Negative operators match when the attribute is missing.
        return op in ("neq", "notIn", "notContains")

    if op == "eq":
        return _s(actual) == _s(expected)
    if op == "neq":
        return _s(actual) != _s(expected)
    if op == "in":
        return any(_s(e) == _s(actual) for e in _as_list(expected))
    if op == "notIn":
        return not any(_s(e) == _s(actual) for e in _as_list(expected))
    if op == "contains":
        if isinstance(actual, (list, tuple)):
            return any(_s(a) == _s(expected) for a in actual)
        return js_string(expected).lower() in js_string(actual).lower()
    if op == "notContains":
        if isinstance(actual, (list, tuple)):
            return not any(_s(a) == _s(expected) for a in actual)
        return js_string(expected).lower() not in js_string(actual).lower()
    if op == "startsWith":
        return js_string(actual).lower().startswith(js_string(expected).lower())
    if op == "endsWith":
        return js_string(actual).lower().endswith(js_string(expected).lower())
    if op == "gt":
        return js_number(actual) > js_number(expected)
    if op == "gte":
        return js_number(actual) >= js_number(expected)
    if op == "lt":
        return js_number(actual) < js_number(expected)
    if op == "lte":
        return js_number(actual) <= js_number(expected)
    if op == "regex":
        rx = _compile(js_string(expected))
        return bool(rx and rx.search(js_string(actual)))
    if op == "semverGte":
        return compare_semver(js_string(actual), js_string(expected)) >= 0
    if op == "semverLt":
        return compare_semver(js_string(actual), js_string(expected)) < 0
    return False


def match_audience(user: Mapping[str, Any], audience: Optional[Mapping[str, Any]]) -> bool:
    """An empty or missing audience matches everybody."""
    if not audience or not audience.get("conditions"):
        return True
    conditions = audience["conditions"]
    if audience.get("match") == "any":
        return any(match_condition(user, c) for c in conditions)
    return all(match_condition(user, c) for c in conditions)
