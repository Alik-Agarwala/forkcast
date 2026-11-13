"""Forkcast: self-hosted A/B testing and feature flags (Python SDK)."""

from ._version import __version__
from .hashing import BUCKETS, bucket_of, murmur3

__all__ = ["BUCKETS", "__version__", "bucket_of", "murmur3"]
