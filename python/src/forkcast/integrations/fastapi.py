"""FastAPI (and Starlette) integration.

from fastapi import Depends, FastAPI, Request
from forkcast import Forkcast, ScopedForkcast
from forkcast.integrations.fastapi import forkcast_dependency, forkcast_lifespan

forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")

def current_user(request: Request) -> dict:
    return {"id": request.headers.get("x-user-id"), "country": request.headers.get("cf-ipcountry")}

get_forkcast = forkcast_dependency(forkcast, current_user)
app = FastAPI(lifespan=forkcast_lifespan(forkcast))

@app.get("/checkout")
def checkout(fc: ScopedForkcast = Depends(get_forkcast)):
    return {"one_click": fc.get_treatment("new-checkout") == "T1"}
"""

from __future__ import annotations

import asyncio
import inspect
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Optional, Union

try:
    from starlette.requests import Request
except ImportError as exc:  # pragma: no cover
    raise ImportError("forkcast.integrations.fastapi needs FastAPI or Starlette: pip install fastapi") from exc

from ..client import OVERRIDE_QUERY_PARAM, Forkcast, ScopedForkcast, UserLike
from . import request_overrides

UserGetter = Callable[[Request], Union[UserLike, Awaitable[UserLike]]]

__all__ = ["forkcast_dependency", "forkcast_lifespan", "UserGetter"]


def forkcast_dependency(
    client: Forkcast,
    get_user: Optional[UserGetter] = None,
) -> Callable[[Request], Awaitable[ScopedForkcast]]:
    """Create a FastAPI dependency that returns a :class:`ScopedForkcast` for the current request.

    Args:
        client: Your shared :class:`Forkcast` client.
        get_user: ``(request) -> user`` (sync or async). Return a dict with ``id`` and any
            attributes to target on, or just the id. Without it every request is anonymous
            and only flags that are off / launched apply.

    When the client allows overrides (``dev_mode=True``), ``?forkcast=new-checkout:T1``
    forces a treatment for that request. In production the parameter is ignored.
    """

    async def dependency(request: Request) -> ScopedForkcast:
        user: Any = get_user(request) if get_user is not None else None
        if inspect.isawaitable(user):
            user = await user
        overrides = request_overrides(client, request.query_params.get(OVERRIDE_QUERY_PARAM))
        return client.for_user(user, overrides=overrides)

    return dependency


def forkcast_lifespan(client: Forkcast) -> Callable[[Any], Any]:
    """A FastAPI ``lifespan`` that flushes pending events and stops the client on shutdown.

    Already have a lifespan? Call ``client.close()`` at the end of yours instead.
    """

    @asynccontextmanager
    async def lifespan(app: Any) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await asyncio.get_running_loop().run_in_executor(None, client.close)

    return lifespan
