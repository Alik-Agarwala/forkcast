"""Pure evaluation: which treatment does this user get? No I/O, no state.

Mirrors ``src/core/evaluate.ts`` exactly. Both SDKs must agree for every
experiment and user; ``tests/test_parity.py`` enforces it.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Optional, cast

from ._js import is_nullish, js_number, js_string
from .hashing import BUCKETS, bucket_of
from .targeting import match_audience
from .types import CONTROL, Evaluation, EvaluationReason, Treatment


def _result(
    exp: Optional[Mapping[str, Any]],
    key: str,
    variant: Treatment,
    reason: EvaluationReason,
    in_experiment: bool = False,
) -> Evaluation:
    payload = None
    if exp:
        for v in exp.get("variants") or []:
            if v.get("key") == variant:
                payload = v.get("payload")
                break
    return Evaluation(experiment=key, variant=variant, reason=reason, payload=payload, in_experiment=in_experiment)


def _has_variant(exp: Mapping[str, Any], variant: Any) -> bool:
    return any(v.get("key") == variant for v in exp.get("variants") or [])


def pick_variant(exp: Mapping[str, Any], bucket: int) -> Treatment:
    """Pick a treatment for a bucket according to the variant weights."""
    variants = [v for v in exp.get("variants") or [] if js_number(v.get("weight")) > 0]
    total = 0.0
    for v in variants:
        total += js_number(v.get("weight"))
    if total <= 0:
        return CONTROL
    point = (bucket / BUCKETS) * total
    acc = 0.0
    for v in variants:
        acc += js_number(v.get("weight"))
        if point < acc:
            return cast(Treatment, v["key"])
    return cast(Treatment, variants[-1]["key"])


def evaluate(
    exp: Optional[Mapping[str, Any]],
    key: str,
    user: Mapping[str, Any],
    environment: str,
    overrides: Optional[Mapping[str, Treatment]] = None,
) -> Evaluation:
    """Decide which treatment ``user`` sees for ``exp``.

    Order of precedence (first match wins):

    1. experiment missing / archived  -> C
    2. developer override             -> that treatment
    3. environment off                -> C   (kill switch)
    4. environment launched           -> launchedVariant for everyone
    5. forced user list               -> that treatment (QA / dogfooding)
    6. audience does not match        -> C
    7. outside traffic %              -> C
    8. otherwise                      -> weighted random, sticky per user

    Only (8) counts as "in experiment" and is recorded as an exposure.
    Traffic and variant use independent hashes, so raising traffic from 10%
    to 50% only adds users; nobody already in the experiment switches.
    """
    if exp is None:
        return _result(None, key, CONTROL, "not_found")
    if exp.get("archived"):
        return _result(exp, key, CONTROL, "archived")

    override = overrides.get(key) if overrides else None
    if override and _has_variant(exp, override):
        return _result(exp, key, override, "override")

    env = (exp.get("environments") or {}).get(environment)
    if not isinstance(env, Mapping) or env.get("status") == "off":
        return _result(exp, key, CONTROL, "off")

    if env.get("status") == "launched":
        launched = env.get("launchedVariant")
        return _result(exp, key, CONTROL if launched is None else launched, "launched")

    raw_id = user.get("id")
    user_id = "" if is_nullish(raw_id) else js_string(raw_id)
    if user_id:
        for forced in exp.get("forced") or []:
            if user_id in (forced.get("userIds") or []) and _has_variant(exp, forced.get("variant")):
                return _result(exp, key, forced["variant"], "forced")

    if not match_audience(user, exp.get("audience")):
        return _result(exp, key, CONTROL, "not_targeted")
    if not user_id:
        return _result(exp, key, CONTROL, "no_user")

    salt = js_string(exp.get("salt") or exp.get("key"))
    traffic = js_number(env.get("traffic"))
    if math.isnan(traffic):
        traffic = 0.0
    traffic = max(0.0, min(100.0, traffic))
    if bucket_of(f"{salt}:traffic", user_id) >= traffic * (BUCKETS / 100):
        return _result(exp, key, CONTROL, "not_in_traffic")

    variant = pick_variant(exp, bucket_of(f"{salt}:variant", user_id))
    return _result(exp, key, variant, "assigned", True)
