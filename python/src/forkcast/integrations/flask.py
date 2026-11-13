"""Flask integration.

    from flask import Flask, request, session
    from forkcast import Forkcast
    from forkcast.integrations.flask import FlaskForkcast, current_forkcast

    app = Flask(__name__)
    forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")
    FlaskForkcast(app, forkcast, get_user=lambda: {
        "id": session.get("user_id"),
        "country": request.headers.get("CF-IPCountry"),
    })

    @app.get("/checkout")
    def checkout():
        if current_forkcast.get_treatment("new-checkout") == "T1":
            return render_template("one_click.html")
        return render_template("cart.html")

Templates get a ``forkcast`` variable: ``{% if forkcast.is_enabled("dark-mode") %}``.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, cast

try:
    from flask import Flask, current_app, g, request
    from werkzeug.local import LocalProxy
except ImportError as exc:  # pragma: no cover
    raise ImportError("forkcast.integrations.flask needs Flask: pip install flask") from exc

from ..client import OVERRIDE_QUERY_PARAM, Forkcast, ScopedForkcast, UserLike
from . import request_overrides

__all__ = ["FlaskForkcast", "current_forkcast"]

_G_KEY = "_forkcast_scoped"


class FlaskForkcast:
    """Flask extension. Supports both ``FlaskForkcast(app, client)`` and the ``init_app`` pattern.

    Args:
        app: Your Flask app (optional, see :meth:`init_app`).
        client: Your shared :class:`Forkcast` client.
        get_user: ``() -> user`` called once per request (use ``flask.request`` / ``session``
            inside). Return a dict with ``id`` and attributes, or just the id.
    """

    def __init__(
        self,
        app: Optional[Flask] = None,
        client: Optional[Forkcast] = None,
        get_user: Optional[Callable[[], UserLike]] = None,
    ) -> None:
        self.client = client
        self.get_user = get_user
        if app is not None:
            self.init_app(app, client, get_user)

    def init_app(
        self,
        app: Flask,
        client: Optional[Forkcast] = None,
        get_user: Optional[Callable[[], UserLike]] = None,
    ) -> None:
        if client is not None:
            self.client = client
        if get_user is not None:
            self.get_user = get_user
        if self.client is None:
            raise ValueError("FlaskForkcast needs a Forkcast client")
        app.extensions["forkcast"] = self
        app.context_processor(lambda: {"forkcast": current_forkcast})

    def scoped(self) -> ScopedForkcast:
        """The :class:`ScopedForkcast` for the current request (created once, then cached)."""
        cached = g.get(_G_KEY)
        if cached is not None:
            return cast(ScopedForkcast, cached)
        client = cast(Forkcast, self.client)
        user: Any = self.get_user() if self.get_user is not None else None
        overrides = request_overrides(client, request.args.get(OVERRIDE_QUERY_PARAM)) if request else None
        scoped = client.for_user(user, overrides=overrides)
        setattr(g, _G_KEY, scoped)
        return scoped


def _current() -> ScopedForkcast:
    ext = current_app.extensions.get("forkcast")
    if ext is None:
        raise RuntimeError("Forkcast is not set up for this app. Call FlaskForkcast(app, client) first.")
    return cast(FlaskForkcast, ext).scoped()


#: Proxy to the current request's :class:`ScopedForkcast`.
current_forkcast: ScopedForkcast = cast(ScopedForkcast, LocalProxy(_current))
