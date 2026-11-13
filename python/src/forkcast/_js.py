"""JavaScript value semantics needed for exact parity with the JS SDK.

Targeting rules are evaluated by both SDKs, so a condition such as
``plan eq "pro"`` or ``age gte 18`` must give the same answer in Python and
JavaScript. JS converts values with ``String(x)`` and ``Number(x)``; these
helpers reproduce those conversions for JSON-like Python values.
"""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Any


class _Undefined:
    """Stand-in for JavaScript ``undefined`` (a missing attribute or value)."""

    _instance: _Undefined | None = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNDEFINED"

    def __bool__(self) -> bool:
        return False


UNDEFINED: Any = _Undefined()


def is_nullish(value: Any) -> bool:
    """``value == null`` in JavaScript (``null`` or ``undefined``)."""
    return value is None or value is UNDEFINED


def _number_to_string(value: float) -> str:
    """``Number.prototype.toString()`` for a finite, non-zero float."""
    sign = "-" if value < 0 else ""
    # repr() gives the shortest round-tripping digits, exactly like JS.
    _, digits_tuple, exponent = Decimal(repr(abs(value))).as_tuple()
    digits = "".join(str(d) for d in digits_tuple).rstrip("0") or "0"
    k = len(digits)
    # Trailing zeros were stripped, so recompute the decimal point position.
    n = int(exponent) + len("".join(str(d) for d in digits_tuple))
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    mantissa = digits[0] + ("." + digits[1:] if k > 1 else "")
    return f"{sign}{mantissa}e{'+' if e > 0 else '-'}{abs(e)}"


def js_string(value: Any) -> str:
    """``String(value)`` in JavaScript."""
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        # JSON numbers are doubles in JS, so huge integers lose precision there.
        return str(value) if abs(value) <= 2**53 else js_string(float(value))
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value == 0:
            return "0"
        return _number_to_string(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return ",".join("" if is_nullish(v) else js_string(v) for v in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


_DECIMAL = re.compile(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$")
_PREFIXED = {"0x": 16, "0o": 8, "0b": 2}


def js_number(value: Any) -> float:
    """``Number(value)`` in JavaScript."""
    if value is UNDEFINED:
        return math.nan
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except OverflowError:
            return math.inf if value > 0 else -math.inf
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return 0.0
        if s in ("Infinity", "+Infinity"):
            return math.inf
        if s == "-Infinity":
            return -math.inf
        base = _PREFIXED.get(s[:2].lower())
        if base:
            try:
                return float(int(s[2:], base))
            except ValueError:
                return math.nan
        if _DECIMAL.match(s):
            try:
                return float(s)
            except (ValueError, OverflowError):
                return math.nan
        return math.nan
    if isinstance(value, (list, tuple)):
        return js_number(js_string(value))
    return math.nan


_LEADING_INT = re.compile(r"^\s*([+-]?\d+)")


def js_parse_int(value: str) -> int:
    """``parseInt(value, 10) || 0`` in JavaScript."""
    m = _LEADING_INT.match(value)
    return int(m.group(1)) if m else 0
