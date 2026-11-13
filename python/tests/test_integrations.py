"""FastAPI and Flask integrations."""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from forkcast import Forkcast, ScopedForkcast

from .conftest import CLIENT_KEY, FakeServer, experiment, wait_for

fastapi = pytest.importorskip("fastapi")
flask = pytest.importorskip("flask")

from fastapi import Depends, FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from forkcast.integrations.fastapi import forkcast_dependency, forkcast_lifespan  # noqa: E402
from forkcast.integrations.flask import FlaskForkcast, current_forkcast  # noqa: E402

CONFIG = [
    experiment("new-checkout"),
    experiment(
        "india-only",
        audience={"match": "all", "conditions": [{"attribute": "country", "operator": "in", "value": ["IN"]}]},
        variants=[{"key": "C", "weight": 0}, {"key": "T1", "weight": 100, "payload": {"banner": "Namaste"}}],
    ),
]


# --------------------------------------------------------------------- FastAPI


def make_fastapi(client: Forkcast, async_user: bool = False) -> FastAPI:
    def current_user(request: Request) -> Dict[str, Any]:
        return {"id": request.headers.get("x-user-id"), "country": request.headers.get("cf-ipcountry")}

    async def current_user_async(request: Request) -> Dict[str, Any]:
        return current_user(request)

    get_forkcast = forkcast_dependency(client, current_user_async if async_user else current_user)
    app = FastAPI(lifespan=forkcast_lifespan(client))

    @app.get("/")
    def home(fc: ScopedForkcast = Depends(get_forkcast)) -> Dict[str, Any]:
        return {
            "checkout": fc.get_treatment("new-checkout"),
            "india": fc.get_treatment("india-only"),
            "banner": fc.get_payload("india-only", default=None),
            "user": fc.user,
        }

    @app.post("/buy")
    async def buy(fc: ScopedForkcast = Depends(get_forkcast)) -> Dict[str, bool]:
        fc.track("purchase", value=25)
        return {"ok": True}

    return app


@pytest.mark.parametrize("async_user", [False, True])
def test_fastapi_dependency_scopes_per_request(async_user: bool) -> None:
    fc = Forkcast(config=CONFIG)
    with TestClient(make_fastapi(fc, async_user)) as http:
        india = http.get("/", headers={"x-user-id": "u1", "cf-ipcountry": "IN"}).json()
        us = http.get("/", headers={"x-user-id": "u1", "cf-ipcountry": "US"}).json()
        anon = http.get("/").json()
    assert india["india"] == "T1" and india["banner"] == {"banner": "Namaste"}
    assert us["india"] == "C" and us["banner"] is None
    assert india["checkout"] == us["checkout"] == fc.get_treatment("new-checkout", "u1")  # sticky
    assert anon["checkout"] == "C" and anon["user"] == {"country": None}


def test_fastapi_query_overrides_only_in_dev_mode() -> None:
    prod = Forkcast(config=CONFIG)
    dev = Forkcast(config=CONFIG, dev_mode=True, environment="production")
    with TestClient(make_fastapi(prod)) as http:
        assert (
            http.get("/?forkcast=india-only:T1", headers={"x-user-id": "u1", "cf-ipcountry": "US"}).json()["india"]
            == "C"
        )
    with TestClient(make_fastapi(dev)) as http:
        assert (
            http.get("/?forkcast=india-only:T1", headers={"x-user-id": "u1", "cf-ipcountry": "US"}).json()["india"]
            == "T1"
        )


def test_fastapi_lifespan_flushes_events_on_shutdown(server: FakeServer) -> None:
    server.experiments = CONFIG
    fc = Forkcast(api_url=server.url, client_key=CLIENT_KEY, flush_interval=60)
    with TestClient(make_fastapi(fc)) as http:
        http.get("/", headers={"x-user-id": "u7", "cf-ipcountry": "IN"})
        http.post("/buy", headers={"x-user-id": "u7"})
        assert server.events == []  # still queued (flush interval is 60s)
    names = sorted(e.get("name") or e["experiment"] for e in server.events)
    assert names == ["india-only", "new-checkout", "purchase"]


# ----------------------------------------------------------------------- Flask


def make_flask(client: Forkcast, factory: bool = False) -> Any:
    from flask import Flask, render_template_string, request

    def current_user() -> Optional[Dict[str, Any]]:
        uid = request.headers.get("X-User-Id")
        return {"id": uid, "country": request.headers.get("CF-IPCountry")} if uid else None

    app = Flask(__name__)
    if factory:
        ext = FlaskForkcast()
        ext.init_app(app, client, current_user)
    else:
        FlaskForkcast(app, client, get_user=current_user)

    @app.get("/")
    def home() -> Dict[str, Any]:
        same = current_forkcast.get_treatment("new-checkout") == current_forkcast.get_treatment("new-checkout")
        return {
            "checkout": current_forkcast.get_treatment("new-checkout"),
            "india": current_forkcast.get_treatment("india-only"),
            "same": same,
        }

    @app.get("/page")
    def page() -> str:
        return render_template_string('{% if forkcast.is_enabled("india-only") %}namaste{% else %}hello{% endif %}')

    @app.post("/buy")
    def buy() -> Dict[str, bool]:
        current_forkcast.track("purchase", value=10)
        return {"ok": True}

    return app


@pytest.mark.parametrize("factory", [False, True])
def test_flask_current_forkcast_and_templates(factory: bool) -> None:
    fc = Forkcast(config=CONFIG)
    http = make_flask(fc, factory).test_client()
    india = http.get("/", headers={"X-User-Id": "u1", "CF-IPCountry": "IN"}).get_json()
    us = http.get("/", headers={"X-User-Id": "u1", "CF-IPCountry": "US"}).get_json()
    assert india["india"] == "T1" and us["india"] == "C" and india["same"]
    assert india["checkout"] == us["checkout"] == fc.get_treatment("new-checkout", "u1")
    assert http.get("/page", headers={"X-User-Id": "u1", "CF-IPCountry": "IN"}).text == "namaste"
    assert http.get("/page").text == "hello"


def test_flask_overrides_only_in_dev_mode() -> None:
    prod = make_flask(Forkcast(config=CONFIG)).test_client()
    dev = make_flask(Forkcast(config=CONFIG, dev_mode=True, environment="production")).test_client()
    headers = {"X-User-Id": "u1", "CF-IPCountry": "US"}
    assert prod.get("/?forkcast=india-only:T1", headers=headers).get_json()["india"] == "C"
    assert dev.get("/?forkcast=india-only:T1", headers=headers).get_json()["india"] == "T1"


def test_flask_tracks_events(server: FakeServer) -> None:
    server.experiments = CONFIG
    with Forkcast(api_url=server.url, client_key=CLIENT_KEY, flush_interval=0.05) as fc:
        make_flask(fc).test_client().post("/buy", headers={"X-User-Id": "u9"})
        assert wait_for(lambda: len(server.events) == 1)
    assert server.events[0]["name"] == "purchase" and server.events[0]["userId"] == "u9"


def test_flask_without_extension_raises_helpful_error() -> None:
    from flask import Flask

    app = Flask(__name__)
    with app.test_request_context("/"), pytest.raises(RuntimeError, match="FlaskForkcast"):
        current_forkcast.get_treatment("x")


def test_flask_extension_requires_client() -> None:
    from flask import Flask

    with pytest.raises(ValueError):
        FlaskForkcast(Flask(__name__))
