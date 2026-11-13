"""Framework integrations.

- :mod:`forkcast.integrations.fastapi`: FastAPI / Starlette dependency and lifespan.
- :mod:`forkcast.integrations.flask`: Flask extension and ``current_forkcast`` proxy.

Any other framework (Django, aiohttp, Litestar, ...) works with the plain
client: call ``forkcast.for_user(...)`` once per request.
"""

from __future__ import annotations

from typing import Dict, Optional

from ..client import Forkcast, parse_override_param
from ..types import Treatment


def request_overrides(client: Forkcast, value: Optional[str]) -> Optional[Dict[str, Treatment]]:
    """Overrides from a ``?forkcast=key:T1`` query value, or None when overrides are disabled."""
    if not client.overrides_allowed:
        return None
    parsed = parse_override_param(value)
    return parsed if isinstance(parsed, dict) and parsed else None
