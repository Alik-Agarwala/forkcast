# Python SDK

The Python SDK lets FastAPI, Flask, Django, scripts and background workers use the same experiments and feature flags as your JavaScript code.

```bash
pip install forkcast-sdk                # core SDK, no dependencies
pip install "forkcast-sdk[fastapi]"     # + FastAPI helpers
pip install "forkcast-sdk[flask]"       # + Flask helpers
```

The package is called `forkcast-sdk` on PyPI and is imported as `forkcast`. It needs Python 3.9 or newer.

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Creating the client](#creating-the-client)
- [Evaluating treatments](#evaluating-treatments)
- [Tracking conversions](#tracking-conversions)
- [FastAPI](#fastapi)
- [Flask](#flask)
- [Django and other frameworks](#django-and-other-frameworks)
- [Scripts, workers and serverless](#scripts-workers-and-serverless)
- [Running in production](#running-in-production)
- [Development mode and overrides](#development-mode-and-overrides)
- [Local mode (no server)](#local-mode-no-server)
- [Testing your app](#testing-your-app)
- [JavaScript ↔ Python cheat sheet](#javascript--python-cheat-sheet)

## How it works

```
                 Forkcast server (npx forkcast start)
                 dashboard · config · results
                   │ config (every 30s,         ▲ exposures + conversions
                   │ or instantly with SSE)     │ (batched every 2s)
                   ▼                            │
 ┌──────────────────────────── your Python process ─────────────────────────────┐
 │ Forkcast client: cached config + event queue + one background thread         │
 │                                                                              │
 │ request ─► forkcast.for_user(user).get_treatment("new-checkout") ─► "T1"     │
 │            pure hashing, no network call, microseconds                       │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Evaluation is local.** The client fetches the config once at startup and keeps it fresh in a background thread. Calling `get_treatment()` never touches the network, so it is safe to call in hot paths and from `async` handlers.
- **Same buckets as JavaScript.** The Python SDK is a line-by-line port of the JS evaluator: MurmurHash3 over 10,000 buckets, the same hash namespaces and the same targeting semantics. `user-42` gets the same treatment from your FastAPI backend and your React frontend. The test suite checks thousands of cases against the JS implementation (see [testing.md](testing.md#python-sdk)).
- **Fails to `C`.** If the server is down, the key is wrong or the experiment is missing, every read returns `C` and logs a warning. Your app keeps working.
- **Events are batched.** Exposures (the first time a bucketed user reads a treatment) and `track()` calls are queued and sent every 2 seconds, or as soon as 100 are queued. `close()` flushes what's left, and it also runs automatically at interpreter exit.

## Quick start

1. Start Forkcast (needs Node.js 18+, anywhere: your laptop, a VM, a container):

   ```bash
   npx forkcast start
   ```

   Open <http://localhost:4400>, create an experiment called `new-checkout` and turn it on. The terminal and the **Environments** page show one client key per environment.

2. Use it from Python:

   ```python
   from forkcast import Forkcast

   forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_deve_...")

   fc = forkcast.for_user({"id": "user-42", "country": "IN", "plan": "pro"})

   if fc.get_treatment("new-checkout") == "T1":
       print("one-click checkout")
   else:
       print("classic cart page")  # "C": also the answer whenever anything goes wrong

   fc.track("purchase", value=49.99)
   forkcast.close()  # flush events (also happens automatically at exit)
   ```

3. Change traffic, targeting or the on/off switch in the dashboard and run it again. There's nothing to redeploy.

## Creating the client

Create **one client per process** at startup and share it. It is thread-safe.

```python
import os
from forkcast import Forkcast

forkcast = Forkcast(
    api_url=os.environ["FORKCAST_URL"],                # e.g. https://flags.example.com
    client_key=os.environ["FORKCAST_CLIENT_KEY"],      # production key in production
    dev_mode=os.environ.get("APP_ENV") == "development",
)
```

| Option | Default | Description |
| --- | --- | --- |
| `api_url` | | Base URL of your Forkcast server. |
| `client_key` | | Public client key of an environment. The key decides the environment (development / staging / production). |
| `config` | | Local mode: a `forkcast.config.json` path, a config dict or a list of experiments. See [Local mode](#local-mode-no-server). |
| `environment` | `production` (`development` if `dev_mode`) | Environment to evaluate in local mode. In remote mode the server decides from the key. |
| `dev_mode` | `False` | Enables developer overrides. Keep it `False` in production. |
| `allow_overrides` | `dev_mode` | Allow `?forkcast=key:T1` and `override()`. Turn on in production only for internal QA deployments. |
| `overrides` | | Static overrides for every user, e.g. `{"new-checkout": "T1"}`. Ignored unless overrides are allowed. |
| `track_exposures` | `True` | Record an exposure the first time a bucketed user reads a treatment. |
| `realtime` | `False` | Receive dashboard changes instantly over Server-Sent Events instead of polling. Falls back to a normal fetch if the stream can't connect. |
| `refresh_interval` | `30` | Seconds between config polls. `0` disables polling. |
| `flush_interval` | `2` | Seconds between event flushes. |
| `timeout` | `5` | HTTP timeout in seconds. |
| `init_timeout` | `5` | How long the constructor waits for the first config. `0` returns immediately: until the config arrives, unknown experiments evaluate to `C` (or use `bootstrap`). |
| `bootstrap` | | Config to use until the first fetch finishes. |
| `on_error` | | `callable(exc)` for background errors. Without it they are logged as warnings on the `forkcast` logger. |
| `debug` | `False` | Log every evaluation on the `forkcast` logger at `DEBUG` level. |

The client also works as a context manager (`with Forkcast(...) as forkcast:`), which calls `close()` on exit.

Client properties and methods:

| Member | Description |
| --- | --- |
| `for_user(user, overrides=None)` | A `ScopedForkcast` bound to one user (see below). Create one per request. It's cheap. |
| `get_treatment(key, user)`, `get_variant(key, user)`, `is_enabled(key, user)`, `get_payload(key, user, default=None)`, `peek(key, user)`, `get_all_treatments(user)` | Shortcuts for `for_user(user).…`. |
| `track(name, user, value=None, **properties)` | Record a conversion for `user`. |
| `ready(timeout=None)` / `is_ready` | Wait for / check the first config fetch. |
| `refresh()` | Fetch the config now. Raises `ForkcastError` on failure (the background thread never raises). |
| `flush()` | Send queued events now. Never raises; failed batches are retried. |
| `close()` | Flush and stop the background thread. Safe to call twice. |
| `subscribe(fn)` | Call `fn()` whenever config or overrides change. Returns an unsubscribe function. |
| `set_config(config)` | Replace the experiments (local mode, tests). |
| `override(key, variant)`, `clear_overrides()`, `get_overrides()` | Overrides for every user (only when allowed). |
| `environment`, `config_version`, `is_remote`, `get_experiments()` | Introspection. |

## Evaluating treatments

A **user** is a dict with an `id` and any attributes you want to target on. You can also pass just the id.

```python
fc = forkcast.for_user({"id": user.id, "country": "IN", "plan": "pro", "appVersion": "2.4.1"})
fc = forkcast.for_user("user-42")     # same as {"id": "user-42"}
fc = forkcast.for_user(42)            # ids are compared as strings: 42 == "42"
```

| `ScopedForkcast` member | Returns |
| --- | --- |
| `get_treatment(key)` | `"C"`, `"T1"`, `"T2"` or your custom key. Always `"C"` when unknown, off or unreachable. |
| `is_enabled(key)` | `True` when the treatment is not `C` (feature flags). |
| `get_payload(key, default=None)` | The JSON payload attached to the user's treatment. |
| `get_variant(key)` | An `Evaluation` with `variant`, `payload`, `reason` and `in_experiment`. |
| `peek(key)` | Same as `get_variant` but records no exposure (admin pages, debugging). |
| `get_all_treatments()` | `{key: treatment}` for every experiment, without recording exposures. Handy for sending flags to a mobile app. |
| `track(name, value=None, **properties)` | Record a conversion for this user. |
| `user` | The normalized user dict. |

`reason` is one of `not_found`, `archived`, `override`, `off`, `launched`, `forced`, `not_targeted`, `not_in_traffic`, `no_user` or `assigned`. Only `assigned` counts towards results. They mean the same as in the JS SDK ([sdk.md](sdk.md#evaluation-reasons)), and the precedence order is in the [README](../README.md#core-concepts).

Users without an `id` get `C` for running experiments (`no_user`), but still see `off` and `launched` states. The Python SDK never invents an anonymous id. If you bucket logged-out visitors, pass a stable id from a cookie.

## Tracking conversions

```python
fc.track("purchase", value=49.99)                         # value feeds revenue / value-per-user
fc.track("add_to_cart", sku="coffee-250g", source="pdp")  # extra keyword args become properties
forkcast.track("signup", {"id": user.id})                 # without a scoped evaluator
```

Conversions are credited to every experiment the user was exposed to before the event. Name the experiment's metrics the same as your `track()` events (Setup tab in the dashboard).

## FastAPI

```python
from fastapi import Depends, FastAPI, Request
from forkcast import Forkcast, ScopedForkcast
from forkcast.integrations.fastapi import forkcast_dependency, forkcast_lifespan

forkcast = Forkcast(api_url=FORKCAST_URL, client_key=FORKCAST_CLIENT_KEY)


def current_user(request: Request) -> dict:
    # Use your auth here: a session, a JWT, request.state.user, ...
    return {"id": request.headers.get("x-user-id"), "country": request.headers.get("cf-ipcountry")}


get_forkcast = forkcast_dependency(forkcast, current_user)
app = FastAPI(lifespan=forkcast_lifespan(forkcast))


@app.get("/checkout")
async def checkout(fc: ScopedForkcast = Depends(get_forkcast)):
    if fc.get_treatment("new-checkout") == "T1":
        return {"flow": "one-click"}
    return {"flow": "cart"}


@app.post("/orders")
async def create_order(fc: ScopedForkcast = Depends(get_forkcast)):
    fc.track("purchase", value=49.99)
    return {"ok": True}
```

- `forkcast_dependency(client, get_user)` returns a dependency that builds one `ScopedForkcast` per request. `get_user(request)` can be a normal function or `async def`, and can return a dict, an id or `None`.
- FastAPI caches dependencies per request, so several dependencies that use `get_forkcast` share one evaluator.
- `forkcast_lifespan(client)` flushes pending events on shutdown. If you already have a lifespan, call `forkcast.close()` at the end of it instead.
- Reading treatments is pure CPU work, so it is fine inside `async def` handlers.
- With `dev_mode=True`, `?forkcast=new-checkout:T1` forces a treatment for that request. In production the parameter is ignored.

Runnable example: [examples/python-fastapi](../examples/python-fastapi/main.py).

## Flask

```python
from flask import Flask, render_template, request, session
from forkcast import Forkcast
from forkcast.integrations.flask import FlaskForkcast, current_forkcast

app = Flask(__name__)
forkcast = Forkcast(api_url=FORKCAST_URL, client_key=FORKCAST_CLIENT_KEY)

FlaskForkcast(app, forkcast, get_user=lambda: {
    "id": session.get("user_id"),
    "country": request.headers.get("CF-IPCountry"),
})


@app.get("/checkout")
def checkout():
    if current_forkcast.get_treatment("new-checkout") == "T1":
        return render_template("one_click.html")
    return render_template("cart.html")


@app.post("/orders")
def create_order():
    current_forkcast.track("purchase", value=49.99)
    return {"ok": True}
```

- `current_forkcast` is a proxy to the current request's `ScopedForkcast`. It is created on first use and cached on `flask.g`.
- Templates get a `forkcast` variable:

  ```jinja
  {% if forkcast.is_enabled("dark-mode") %}<link rel="stylesheet" href="/dark.css">{% endif %}
  {% if forkcast.get_treatment("new-checkout") == "T1" %}…{% endif %}
  ```

- App factory: `ext = FlaskForkcast()` at module level, then `ext.init_app(app, forkcast, get_user)` inside `create_app()`.

Runnable example: [examples/python-flask](../examples/python-flask/app.py).

## Django and other frameworks

Any framework works with the plain client. Create it once, then call `for_user()` per request. Django, as middleware:

```python
# myproject/flags.py
from django.conf import settings
from forkcast import Forkcast

forkcast = Forkcast(api_url=settings.FORKCAST_URL, client_key=settings.FORKCAST_CLIENT_KEY)


def forkcast_middleware(get_response):
    def middleware(request):
        user = request.user
        request.forkcast = forkcast.for_user({
            "id": str(user.pk) if user.is_authenticated else None,
            "country": request.headers.get("CF-IPCountry"),
        })
        return get_response(request)

    return middleware
```

Add `"myproject.flags.forkcast_middleware"` to `MIDDLEWARE` after the authentication middleware, then use `request.forkcast.get_treatment("new-checkout")` in views. To use it in templates, add a context processor that returns `{"forkcast": request.forkcast}`.

The same pattern works for aiohttp, Litestar, Starlette, Sanic, Tornado and others.

## Scripts, workers and serverless

```python
from forkcast import Forkcast

with Forkcast(api_url=URL, client_key=KEY) as forkcast:      # close() flushes on exit
    for user in users_to_email:
        if forkcast.is_enabled("new-email-template", user.id):
            send_new_template(user)
```

- **Celery / RQ / cron**: create the client once per worker process, at module level.
- **AWS Lambda / Cloud Functions**: create the client outside the handler so warm invocations reuse the config. Call `forkcast.flush()` at the end of each invocation, because the platform may freeze the process before the background thread sends events. Use `realtime=False`.

## Running in production

- **One client per process.** With gunicorn or uvicorn workers, each worker has its own client: one config request every 30 seconds and one event batch every 2 seconds per worker. That's tiny.
- **Fork-safe.** Using `gunicorn --preload`, or creating the client before workers fork? The background thread restarts automatically in each worker.
- **Kill switch latency.** Polling picks up changes within `refresh_interval` (30s by default). Use `realtime=True` for about one second; it keeps one long-lived HTTP connection per process.
- **The server is down?** Reads keep using the last config they fetched. A process that starts while the server is unreachable evaluates everything to `C` until it can fetch. Events are retried (up to 500 per batch), so short outages don't lose data.
- **Logging.** Warnings go to the `forkcast` logger. Silence it with `logging.getLogger("forkcast").setLevel(logging.ERROR)` or send errors to your tracker with `on_error=sentry_sdk.capture_exception`.
- **Keys.** Client keys are public identifiers, not secrets. Protect the dashboard with `--admin-token` ([server.md](server.md)).
- **Privacy.** Exposures only carry `country`, `platform`, `device`, `browser`, `plan` and `appVersion` from the user dict. Emails and other attributes are used for targeting locally and never sent.

## Development mode and overrides

Python apps do not auto-detect dev mode. Pass it explicitly:

```python
forkcast = Forkcast(
    api_url=FORKCAST_URL,
    client_key=os.environ["FORKCAST_CLIENT_KEY"],                 # development key locally
    dev_mode=os.environ.get("APP_ENV", "development") == "development",
)
```

With `dev_mode=True` (or `allow_overrides=True`):

- `?forkcast=new-checkout:T1,dark-mode:C` on any URL forces treatments for that request (FastAPI and Flask integrations).
- `forkcast.for_user(user, overrides={"new-checkout": "T1"})` forces them in code.
- `forkcast.override("new-checkout", "T1")` or the `overrides=` option forces them for everyone in this process.

Overrides only apply when the variant exists on the experiment. They never record exposures. In production, `dev_mode=False` ignores all of them, so a user can't pick their own treatment.

## Local mode (no server)

Evaluate from a config file, with no server and no network:

```python
forkcast = Forkcast(config="forkcast.config.json", environment="production")
```

`forkcast.config.json` is the same file the JS SDK and `npx forkcast init` use. Export it from the dashboard (**Environments → Export**). Events are not sent in local mode.

## Testing your app

Pin treatments in tests instead of depending on random bucketing:

```python
from forkcast import Forkcast

def make_forkcast(**treatments):
    experiments = [
        {"key": key, "variants": [{"key": "C", "weight": 1}, {"key": v, "weight": 1}],
         "environments": {"production": {"status": "launched", "launchedVariant": v}}}
        for key, v in treatments.items()
    ]
    return Forkcast(config=experiments)

def test_one_click_checkout(client):
    app.dependency_overrides[get_forkcast] = lambda: make_forkcast(**{"new-checkout": "T1"}).for_user("test")
    assert client.get("/checkout").json() == {"flow": "one-click"}
```

Or create the client with `dev_mode=True` and pass `?forkcast=new-checkout:T1` in test requests.

## JavaScript ↔ Python cheat sheet

| JavaScript | Python |
| --- | --- |
| `createForkcast({ apiUrl, clientKey })` | `Forkcast(api_url=..., client_key=...)` (or `create_forkcast(...)`) |
| `await forkcast.ready()` | the constructor waits up to `init_timeout`; `forkcast.ready(timeout)` |
| `forkcast.forUser(user)` | `forkcast.for_user(user)` |
| `fc.getTreatment('key')` | `fc.get_treatment("key")` |
| `fc.isEnabled('key')` | `fc.is_enabled("key")` |
| `fc.getPayload('key')` | `fc.get_payload("key", default=None)` |
| `fc.getVariant('key').inExperiment` | `fc.get_variant("key").in_experiment` |
| `fc.getAllTreatments()` | `fc.get_all_treatments()` |
| `fc.track('purchase', { value: 9, sku })` | `fc.track("purchase", value=9, sku=sku)` |
| `devMode`, `allowOverrides`, `refreshInterval` (ms) | `dev_mode`, `allow_overrides`, `refresh_interval` (seconds) |
| `realtime` (default on in browsers) | `realtime=True` (default off, polling) |
| `await forkcast.close()` | `forkcast.close()` |
