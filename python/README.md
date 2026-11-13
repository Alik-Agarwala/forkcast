# Forkcast for Python

[![PyPI](https://img.shields.io/pypi/v/forkcast-sdk.svg)](https://pypi.org/project/forkcast-sdk/)
[![Python](https://img.shields.io/pypi/pyversions/forkcast-sdk.svg)](https://pypi.org/project/forkcast-sdk/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Alik-Agarwala/forkcast/blob/main/LICENSE)

The Python SDK for [Forkcast](https://github.com/Alik-Agarwala/forkcast), the self-hosted A/B testing and feature flag tool. Use it in **FastAPI**, **Flask**, Django, scripts and workers.

- Same buckets as the JavaScript SDK. A user gets the same treatment from your Python API and your React frontend.
- Local evaluation. Config is fetched once and kept fresh in the background, so every `get_treatment()` is pure hashing with no network call.
- Works offline. If the server is unreachable, everything falls back to `C` (control) and your app never crashes.
- No dependencies. Only the Python standard library. FastAPI and Flask helpers are optional.
- Typed (`py.typed`). Python 3.10+.

```bash
pip install forkcast-sdk
```

You import it as `forkcast`.

## Quick start

1. Start a Forkcast server and dashboard (needs Node.js 18+):

   ```bash
   npx forkcast start
   ```

   Open http://localhost:4400, create an experiment (say `new-checkout`) and copy a client key from **Environments**.

2. Ask for a treatment in Python:

   ```python
   from forkcast import Forkcast

   forkcast = Forkcast(
       api_url="http://localhost:4400",
       client_key="fc_prod_...",  # from the dashboard
   )

   fc = forkcast.for_user({"id": "user-42", "country": "IN", "plan": "pro"})

   if fc.get_treatment("new-checkout") == "T1":
       show_one_click_checkout()
   else:  # "C", the control
       show_cart_page()

   fc.track("purchase", value=49.99)  # conversion for the results page
   ```

3. Change traffic, targeting or the kill switch in the dashboard. Python picks it up within 30 seconds (or instantly with `realtime=True`). There's no redeploy.

## FastAPI

```python
from fastapi import Depends, FastAPI, Request
from forkcast import Forkcast, ScopedForkcast
from forkcast.integrations.fastapi import forkcast_dependency, forkcast_lifespan

forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")


def current_user(request: Request) -> dict:
    return {"id": request.headers.get("x-user-id"), "country": request.headers.get("cf-ipcountry")}


get_forkcast = forkcast_dependency(forkcast, current_user)
app = FastAPI(lifespan=forkcast_lifespan(forkcast))  # flushes events on shutdown


@app.get("/checkout")
def checkout(fc: ScopedForkcast = Depends(get_forkcast)):
    return {"one_click": fc.get_treatment("new-checkout") == "T1"}
```

## Flask

```python
from flask import Flask, request, session
from forkcast import Forkcast
from forkcast.integrations.flask import FlaskForkcast, current_forkcast

app = Flask(__name__)
forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")
FlaskForkcast(
    app,
    forkcast,
    get_user=lambda: {
        "id": session.get("user_id"),
        "country": request.headers.get("CF-IPCountry"),
    },
)


@app.get("/checkout")
def checkout():
    if current_forkcast.get_treatment("new-checkout") == "T1":
        return "one-click checkout"
    return "cart page"
```

In Jinja templates you can write `{% if forkcast.is_enabled("dark-mode") %}`.

## More

- 2-minute launch video (dashboard tour and the JavaScript setup; the concepts are identical in Python): [Forkcast v0.1.0 release](https://github.com/Alik-Agarwala/forkcast/releases/tag/v0.1.0)

- Full Python guide, covering every option and method, Django, gunicorn, testing and local mode: [docs/python.md](https://github.com/Alik-Agarwala/forkcast/blob/main/docs/python.md)
- Concepts (C/T1/T2, traffic, targeting, environments): [docs/concepts.md](https://github.com/Alik-Agarwala/forkcast/blob/main/docs/concepts.md)
- Main project, JavaScript SDK and dashboard: [github.com/Alik-Agarwala/forkcast](https://github.com/Alik-Agarwala/forkcast)

MIT licensed.
