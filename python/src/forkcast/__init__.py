"""Forkcast: self-hosted A/B testing and feature flags (Python SDK)."""

from ._version import __version__
from .hashing import BUCKETS, bucket_of, murmur3
from .targeting import OPERATORS, compare_semver, get_attribute, match_audience, match_condition
from .types import CONTROL, Evaluation

__all__ = [
    "BUCKETS",
    "CONTROL",
    "OPERATORS",
    "Evaluation",
    "__version__",
    "bucket_of",
    "compare_semver",
    "get_attribute",
    "match_audience",
    "match_condition",
    "murmur3",
]
