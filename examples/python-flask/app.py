"""Forkcast in a Flask app.

From the repository root:

    npm run dev:server                  # Forkcast server + dashboard on :4400 (demo data)
    pip install -e "python[flask]"      # the SDK from this repo (in your project: pip install "forkcast-sdk[flask]")
    flask --app examples/python-flask/app.py run --port 5000

    open "http://localhost:5000/?user=alice&country=IN"

Change traffic, targeting or the kill switch in the dashboard (http://localhost:4400)
and reload. Developer overrides: start with FORKCAST_DEV=1 and add
?forkcast=new-checkout:T2 to the URL.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from flask import Flask, render_template_string, request

from forkcast import Forkcast
from forkcast.integrations.flask import FlaskForkcast, current_forkcast

DEV = os.environ.get("FORKCAST_DEV") == "1"

app = Flask(__name__)
forkcast = Forkcast(
    api_url=os.environ.get("FORKCAST_URL", "http://localhost:4400"),
    client_key=os.environ.get("FORKCAST_CLIENT_KEY", "fc_dev_demo_key" if DEV else "fc_prod_demo_key"),
    dev_mode=DEV,  # never accept overrides from users in production
    realtime=True,
)


def current_user() -> Dict[str, Any]:
    # In a real app: session["user_id"], and e.g. the CF-IPCountry header for the country.
    return {
        "id": request.args.get("user") or request.headers.get("X-User-Id"),
        "country": request.args.get("country") or request.headers.get("CF-IPCountry", "US"),
        "plan": request.args.get("plan", "free"),
    }


FlaskForkcast(app, forkcast, get_user=current_user)

PAGE = """<!doctype html>
<body style="font-family:system-ui;padding:2rem;
  {% if forkcast.is_enabled('dark-mode') %}background:#111;color:#eee{% endif %}">
  {% if forkcast.is_enabled('free-shipping-banner') %}<p>🚚 Free shipping on every order</p>{% endif %}
  <h1>{{ forkcast.get_payload('hero-headline', {}).get('headline', 'Ethiopia Yirgacheffe') }}</h1>
  <form method="post" action="/buy?user={{ forkcast.user.get('id', '') }}">
    {% set checkout = forkcast.get_treatment('new-checkout') %}
    <button>{{ labels.get(checkout, checkout) }}</button>
  </form>
  <p>new-checkout → <b>{{ checkout }}</b></p>
  <pre>{{ forkcast.get_all_treatments() }}</pre>
</body>"""


CHECKOUT_LABELS = {"C": "Add to cart", "T1": "Buy now · 1-click", "T2": "Buy now (sticky bar)"}


@app.get("/")
def product_page() -> str:
    return render_template_string(PAGE, labels=CHECKOUT_LABELS)


@app.post("/buy")
def buy() -> Dict[str, Any]:
    current_forkcast.track("purchase", value=18)  # shows up under Results in the dashboard
    return {"ok": True, "user": current_forkcast.user.get("id")}


@app.get("/api/flags")
def flags() -> Dict[str, str]:
    return current_forkcast.get_all_treatments()
