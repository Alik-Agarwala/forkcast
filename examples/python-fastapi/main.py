"""Forkcast in a FastAPI app.

From the repository root:

    npm run dev:server                          # Forkcast server + dashboard on :4400 (demo data)
    pip install -e "python[fastapi]" uvicorn    # this repo's SDK; in your project: "forkcast-sdk[fastapi]"
    uvicorn --app-dir examples/python-fastapi main:app --reload --port 8000

    open "http://localhost:8000/?user=alice&country=IN"

Then flip things in the dashboard (http://localhost:4400): change traffic, add a
country rule or hit the kill switch on `new-checkout`, and reload. Changes
arrive within about a second (realtime=True).

Developer overrides: start with FORKCAST_DEV=1 and add ?forkcast=new-checkout:T2 to the URL.
"""

from __future__ import annotations

import html
import os
from typing import Any, Dict

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse

from forkcast import Forkcast, ScopedForkcast
from forkcast.integrations.fastapi import forkcast_dependency, forkcast_lifespan

DEV = os.environ.get("FORKCAST_DEV") == "1"

forkcast = Forkcast(
    api_url=os.environ.get("FORKCAST_URL", "http://localhost:4400"),
    client_key=os.environ.get("FORKCAST_CLIENT_KEY", "fc_dev_demo_key" if DEV else "fc_prod_demo_key"),
    dev_mode=DEV,  # never accept overrides from users in production
    realtime=True,  # kill switch reaches this app in ~1 second
)


def current_user(request: Request) -> Dict[str, Any]:
    # In a real app: your session / JWT user id, and e.g. the CF-IPCountry header for the country.
    return {
        "id": request.query_params.get("user") or request.headers.get("x-user-id"),
        "country": request.query_params.get("country") or request.headers.get("cf-ipcountry", "US"),
        "plan": request.query_params.get("plan", "free"),
    }


get_forkcast = forkcast_dependency(forkcast, current_user)
app = FastAPI(title="Forkcast FastAPI example", lifespan=forkcast_lifespan(forkcast))

CHECKOUT_LABELS = {"C": "Add to cart", "T1": "Buy now · 1-click", "T2": "Buy now (sticky bar)"}


@app.get("/", response_class=HTMLResponse)
def product_page(fc: ScopedForkcast = Depends(get_forkcast)) -> str:
    checkout = fc.get_treatment("new-checkout")
    hero = fc.get_payload("hero-headline", default={})
    dark = fc.is_enabled("dark-mode")
    free_shipping = fc.is_enabled("free-shipping-banner")
    user_id = html.escape(str(fc.user.get("id", "")))
    style = "background:#111;color:#eee" if dark else "background:#fff;color:#111"
    return f"""<!doctype html>
<body style="font-family:system-ui;{style};padding:2rem">
  {"<p>🚚 Free shipping on every order</p>" if free_shipping else ""}
  <h1>{html.escape(hero.get("headline", "Ethiopia Yirgacheffe"))}</h1>
  <form method="post" action="/buy?user={user_id}">
    <button>{CHECKOUT_LABELS.get(checkout, checkout)}</button>
  </form>
  <p>new-checkout → <b>{checkout}</b> ({fc.peek("new-checkout").reason})</p>
  <pre>{html.escape(str(fc.get_all_treatments()))}</pre>
</body>"""


@app.post("/buy")
def buy(fc: ScopedForkcast = Depends(get_forkcast)) -> Dict[str, Any]:
    fc.track("purchase", value=18)  # shows up under Results in the dashboard
    return {"ok": True, "user": fc.user.get("id")}


@app.get("/api/flags")
def flags(fc: ScopedForkcast = Depends(get_forkcast)) -> Dict[str, str]:
    """Handy for mobile apps or a frontend that should not talk to Forkcast directly."""
    return fc.get_all_treatments()
