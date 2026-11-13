"""Unit tests for hashing, JS value semantics, targeting and evaluation."""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from forkcast import CONTROL, bucket_of, evaluate, get_attribute, match_audience, murmur3
from forkcast._js import UNDEFINED, js_number, js_string

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8"))


def test_hash_is_frozen() -> None:
    # Same pinned values as test/hash.test.ts in the JS SDK. Never update these.
    assert murmur3("hello") == 613153351
    assert bucket_of("new-checkout:traffic", "alice") == 2128


def test_parity_fixture_is_meaningful() -> None:
    outcomes = Counter(c["expected"] for c in FIXTURE["targeting"])
    assert outcomes[True] > 300 and outcomes[False] > 300
    reasons = Counter(r.split("|")[1] for e in FIXTURE["evaluations"] for r in e["results"])
    for reason in ("assigned", "not_in_traffic", "off", "launched", "archived", "forced", "not_targeted", "no_user"):
        assert reasons[reason] > 0, reason


def test_js_string() -> None:
    assert js_string(True) == "true"
    assert js_string(None) == "null"
    assert js_string(UNDEFINED) == "undefined"
    assert js_string(5.0) == "5"
    assert js_string(-0.0) == "0"
    assert js_string(0.1 + 0.2) == "0.30000000000000004"
    assert js_string(1e21) == "1e+21"
    assert js_string(1e-7) == "1e-7"
    assert js_string(0.000001) == "0.000001"
    assert js_string(123456789012345680000.0) == "123456789012345680000"
    assert js_string(2**60) == "1152921504606847000"
    assert js_string(["a", None, 1]) == "a,,1"
    assert js_string({"x": 1}) == "[object Object]"
    assert js_string(math.inf) == "Infinity"


def test_js_number() -> None:
    assert js_number("") == 0
    assert js_number(" 12 ") == 12
    assert js_number("0x10") == 16
    assert math.isnan(js_number("12px"))
    assert math.isnan(js_number("1_000"))
    assert math.isnan(js_number("inf"))
    assert js_number("Infinity") == math.inf
    assert js_number(True) == 1
    assert js_number([]) == 0
    assert js_number([7]) == 7
    assert math.isnan(js_number({}))
    assert math.isnan(js_number(UNDEFINED))
    assert js_number(None) == 0


def test_get_attribute_paths() -> None:
    user = {"profile": {"tier": "gold"}, "tags": ["a", "b"], "flat.key": 1}
    assert get_attribute(user, "profile.tier") == "gold"
    assert get_attribute(user, "tags.1") == "b"
    assert get_attribute(user, "flat.key") == 1
    assert get_attribute(user, "profile.missing") is UNDEFINED
    assert get_attribute(user, "tags.9") is UNDEFINED


def test_empty_audience_matches_everyone() -> None:
    assert match_audience({}, None)
    assert match_audience({}, {"match": "all", "conditions": []})


def test_distribution_is_close_to_weights() -> None:
    exp = {
        "key": "split",
        "variants": [
            {"key": "C", "weight": 40},
            {"key": "T1", "weight": 20},
            {"key": "T2", "weight": 20},
            {"key": "T3", "weight": 10},
            {"key": "T4", "weight": 10},
        ],
        "environments": {"production": {"status": "running", "traffic": 100}},
    }
    counts = Counter(evaluate(exp, "split", {"id": f"u{i}"}, "production").variant for i in range(50_000))
    for key, share in {"C": 0.4, "T1": 0.2, "T2": 0.2, "T3": 0.1, "T4": 0.1}.items():
        assert abs(counts[key] / 50_000 - share) < 0.01, (key, counts[key])


def test_raising_traffic_only_adds_users() -> None:
    def exp(traffic: int) -> dict:
        return {
            "key": "ramp",
            "variants": [{"key": "C", "weight": 50}, {"key": "T1", "weight": 50}],
            "environments": {"production": {"status": "running", "traffic": traffic}},
        }

    users = [{"id": f"u{i}"} for i in range(5000)]
    at10 = {u["id"]: evaluate(exp(10), "ramp", u, "production") for u in users}
    at50 = {u["id"]: evaluate(exp(50), "ramp", u, "production") for u in users}
    for uid, ev in at10.items():
        if ev.in_experiment:
            assert at50[uid].in_experiment and at50[uid].variant == ev.variant


def test_fail_to_control() -> None:
    ev = evaluate(None, "missing", {"id": "u1"}, "production")
    assert ev.variant == CONTROL and ev.reason == "not_found" and not ev.in_experiment
    weird = {"key": "w", "variants": [], "environments": {"production": {"status": "running", "traffic": "lots"}}}
    assert evaluate(weird, "w", {"id": "u1"}, "production").variant == CONTROL
