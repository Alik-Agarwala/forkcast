"""Python must bucket, target and evaluate exactly like the JavaScript SDK.

The fixture is generated from the JS core by ``npm run python:parity``.
If one of these tests fails, a user could see a different treatment depending
on which SDK evaluated them. Fix the Python side; never edit the fixture by hand.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from forkcast import bucket_of, compare_semver, evaluate, match_condition, murmur3, pick_variant
from forkcast.hashing import BUCKETS

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8"))


def test_murmur3_matches_js() -> None:
    for value, seed, expected in FIXTURE["hashes"]:
        assert murmur3(value, seed) == expected, (value, seed)


@pytest.mark.parametrize("case", FIXTURE["buckets"], ids=lambda c: c["namespace"])
def test_bucket_of_matches_js(case: dict) -> None:
    got = [bucket_of(case["namespace"], uid) for uid in FIXTURE["userIds"]]
    assert got == case["buckets"]


def test_targeting_matches_js() -> None:
    mismatches = [
        (c["user"], c["condition"], c["expected"])
        for c in FIXTURE["targeting"]
        if match_condition(c["user"], c["condition"]) is not c["expected"]
    ]
    assert mismatches == []


def test_semver_matches_js() -> None:
    for a, b, expected in FIXTURE["semver"]:
        assert compare_semver(a, b) == expected, (a, b)


@pytest.mark.parametrize("exp", FIXTURE["experiments"], ids=lambda e: e["key"])
def test_evaluate_matches_js(exp: dict) -> None:
    expected = next(e["results"] for e in FIXTURE["evaluations"] if e["key"] == exp["key"])
    got = []
    for user in FIXTURE["users"]:
        ev = evaluate(exp, exp["key"], user, "production")
        got.append(f"{ev.variant}|{ev.reason}|{1 if ev.in_experiment else 0}")
    assert got == expected


def test_overrides_match_js() -> None:
    user = FIXTURE["users"][5]
    for exp, (key, variant, reason) in zip(FIXTURE["experiments"], FIXTURE["overrides"]):
        ev = evaluate(exp, key, user, "production", {key: "T1"})
        assert (ev.variant, ev.reason) == (variant, reason), key


def test_not_found_matches_js() -> None:
    ev = evaluate(None, "nope", FIXTURE["users"][0], "production")
    assert [ev.variant, ev.reason] == FIXTURE["notFound"]


@pytest.mark.parametrize("case", FIXTURE["pickBoundaries"], ids=lambda c: c["key"])
def test_pick_variant_boundaries_match_js(case: dict) -> None:
    exp = next(e for e in FIXTURE["experiments"] if e["key"] == case["key"])
    runs = []
    prev = None
    for bucket in range(BUCKETS):
        v = pick_variant(exp, bucket)
        if v != prev:
            runs.append([bucket, v])
        prev = v
    assert runs == case["runs"]
