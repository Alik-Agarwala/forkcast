"""Forkcast: self-hosted A/B testing and feature flags.

Python SDK for the Forkcast server. Evaluation is local and deterministic, and
buckets users exactly like the JavaScript SDK, so a user gets the same
treatment from your Python API and your React frontend.

    from forkcast import Forkcast

    forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")
    fc = forkcast.for_user({"id": "user-42", "country": "IN"})
    if fc.get_treatment("new-checkout") == "T1":
        ...

Framework helpers live in ``forkcast.integrations.fastapi`` and
``forkcast.integrations.flask``.
"""

from ._version import __version__
from .client import (
    OVERRIDE_QUERY_PARAM,
    Forkcast,
    ForkcastError,
    ScopedForkcast,
    create_forkcast,
    parse_override_param,
)
from .evaluate import evaluate, pick_variant
from .hashing import BUCKETS, bucket_of, murmur3
from .targeting import OPERATORS, compare_semver, get_attribute, match_audience, match_condition
from .types import CONTROL, Evaluation

__all__ = [
    "BUCKETS",
    "CONTROL",
    "OPERATORS",
    "OVERRIDE_QUERY_PARAM",
    "Evaluation",
    "Forkcast",
    "ForkcastError",
    "ScopedForkcast",
    "__version__",
    "bucket_of",
    "compare_semver",
    "create_forkcast",
    "evaluate",
    "get_attribute",
    "match_audience",
    "match_condition",
    "murmur3",
    "parse_override_param",
    "pick_variant",
]
