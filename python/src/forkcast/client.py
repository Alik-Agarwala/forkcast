"""The Forkcast client for Python services.

Works like the Node.js SDK: config is fetched from your Forkcast server once
and kept fresh in the background, every evaluation is local (pure hashing, no
network call), and exposures / tracked events are batched and sent in the
background.

    from forkcast import Forkcast

    forkcast = Forkcast(api_url="http://localhost:4400", client_key="fc_prod_...")
    fc = forkcast.for_user({"id": "user-42", "country": "IN"})
    if fc.get_treatment("new-checkout") == "T1":
        ...
"""

from __future__ import annotations

import atexit
import json
import logging
import math
import os
import socket
import threading
import time
import weakref
from typing import Any, Callable, Dict, List, Mapping, Optional, Set, Union
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
from urllib.parse import quote

from ._js import is_nullish, js_string
from ._version import __version__
from .evaluate import evaluate
from .types import CONTROL, Evaluation, Treatment

logger = logging.getLogger("forkcast")

#: Query parameter used for developer overrides: ``?forkcast=new-checkout:T1``.
OVERRIDE_QUERY_PARAM = "forkcast"

_USER_AGENT = f"forkcast-python/{__version__}"
_EXPOSURE_ATTRIBUTES = ("country", "platform", "device", "browser", "plan", "appVersion")
_FLUSH_AT = 100
_REQUEUE_LIMIT = 500
_DEDUPE_LIMIT = 50_000
_STREAM_READ_TIMEOUT = 75.0

UserLike = Union[Mapping[str, Any], str, int, None]
ConfigLike = Union[Mapping[str, Any], List[Mapping[str, Any]], str, "os.PathLike[str]"]
Listener = Callable[[], None]


class ForkcastError(Exception):
    """Raised by :meth:`Forkcast.refresh` when the server cannot be reached."""


def parse_override_param(value: Optional[str]) -> Union[Dict[str, Treatment], str, None]:
    """Parse ``"new-checkout:T1,dark-mode:C"`` into ``{"new-checkout": "T1", "dark-mode": "C"}``.

    Returns ``"reset"`` for ``reset`` / ``clear`` and ``None`` for an empty value.
    """
    if not value:
        return None
    if value in ("reset", "clear"):
        return "reset"
    out: Dict[str, Treatment] = {}
    for pair in value.split(","):
        parts = [p.strip() for p in pair.split(":")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            out[parts[0]] = parts[1]
    return out


def _load_experiments(config: Optional[ConfigLike]) -> List[Mapping[str, Any]]:
    if config is None:
        return []
    if isinstance(config, (str, os.PathLike)):
        with open(config, encoding="utf-8") as fh:
            config = json.load(fh)
    if isinstance(config, Mapping):
        experiments = config.get("experiments") or []
    else:
        experiments = config
    return [e for e in experiments if isinstance(e, Mapping) and e.get("key")]


def _normalize_user(user: UserLike) -> Dict[str, Any]:
    if user is None:
        return {}
    if isinstance(user, (str, int)):
        return {"id": js_string(user)}
    out = dict(user)
    if is_nullish(out.get("id")):
        out.pop("id", None)
    else:
        out["id"] = js_string(out["id"])
    return out


def _pick_attributes(user: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Only a few well-known, non-identifying attributes are sent with exposures."""
    out = {
        k: user[k]
        for k in _EXPOSURE_ATTRIBUTES
        if k in user and user[k] is not None and not isinstance(user[k], (dict, list, tuple))
    }
    return out or None


def _now_ms() -> int:
    return int(time.time() * 1000)


class ScopedForkcast:
    """An evaluator bound to one user. Create one per request with :meth:`Forkcast.for_user`.

    Cheap to create: no network calls, just hashing against the cached config.
    """

    __slots__ = ("_client", "user", "_overrides")

    def __init__(self, client: Forkcast, user: Dict[str, Any], overrides: Optional[Dict[str, Treatment]] = None):
        self._client = client
        self.user = user
        self._overrides = overrides

    def get_variant(self, key: str) -> Evaluation:
        """Full evaluation: treatment, payload, reason and whether the user is in the experiment."""
        return self._client._evaluate_for(self.user, key, self._overrides, record=True)

    def get_treatment(self, key: str) -> Treatment:
        """``"C"``, ``"T1"``, ``"T2"``... Always ``"C"`` when the experiment is unknown, off or unreachable."""
        return self.get_variant(key).variant

    def is_enabled(self, key: str) -> bool:
        """Feature-flag helper: True when the user gets anything other than ``C``."""
        return self.get_treatment(key) != CONTROL

    def get_payload(self, key: str, default: Any = None) -> Any:
        """The JSON payload attached to the user's treatment, or ``default``."""
        payload = self.get_variant(key).payload
        return default if payload is None else payload

    def peek(self, key: str) -> Evaluation:
        """Evaluate without recording an exposure (debugging, admin pages)."""
        return self._client._evaluate_for(self.user, key, self._overrides, record=False)

    def get_all_treatments(self) -> Dict[str, Treatment]:
        """Every known experiment's treatment for this user. Records no exposures."""
        return {key: self.peek(key).variant for key in self._client._experiment_keys()}

    def track(self, name: str, value: Optional[float] = None, **properties: Any) -> None:
        """Record a conversion / business event, e.g. ``track("purchase", value=49.99)``."""
        self._client._track_for(self.user, name, value, properties)

    def __repr__(self) -> str:
        return f"ScopedForkcast(user={self.user!r})"


class Forkcast:
    """Forkcast SDK client. Create one per process and share it.

    Remote mode (talk to a Forkcast server)::

        Forkcast(api_url="https://flags.example.com", client_key="fc_prod_...")

    Local mode (no server, config as code)::

        Forkcast(config="forkcast.config.json", environment="production")

    Args:
        api_url: Base URL of your Forkcast server.
        client_key: Public client key of an environment (dashboard → Environments).
        config: Experiments for local mode: a ``forkcast.config.json`` path, a config dict or a list.
        environment: Environment to evaluate in local mode. Default ``production``
            (``development`` when ``dev_mode=True``). In remote mode the server decides.
        dev_mode: Enables developer overrides. Keep ``False`` in production.
        allow_overrides: Allow treatment overrides (``?forkcast=key:T1``). Default: ``dev_mode``.
        overrides: Static overrides applied to every user, e.g. ``{"new-checkout": "T1"}``.
            Ignored unless overrides are allowed.
        track_exposures: Record an exposure the first time a user is bucketed. Default ``True``.
        realtime: Receive config changes instantly over Server-Sent Events instead of polling.
        refresh_interval: Seconds between config polls. ``0`` disables polling. Default 30.
        flush_interval: Seconds between event flushes. Default 2.
        timeout: HTTP timeout in seconds. Default 5.
        init_timeout: How long the constructor waits for the first config fetch. ``0`` returns
            immediately (unknown experiments evaluate to ``C`` until the config arrives).
        bootstrap: Config to use before the first fetch finishes.
        on_error: Called with every background error instead of logging a warning.
        debug: Log every evaluation on the ``forkcast`` logger at DEBUG level.
    """

    def __init__(
        self,
        *,
        api_url: Optional[str] = None,
        client_key: Optional[str] = None,
        config: Optional[ConfigLike] = None,
        environment: Optional[str] = None,
        dev_mode: bool = False,
        allow_overrides: Optional[bool] = None,
        overrides: Optional[Mapping[str, Treatment]] = None,
        track_exposures: bool = True,
        realtime: bool = False,
        refresh_interval: float = 30.0,
        flush_interval: float = 2.0,
        timeout: float = 5.0,
        init_timeout: float = 5.0,
        bootstrap: Optional[ConfigLike] = None,
        on_error: Optional[Callable[[BaseException], None]] = None,
        debug: bool = False,
    ) -> None:
        self.dev_mode = bool(dev_mode)
        self.overrides_allowed = self.dev_mode if allow_overrides is None else bool(allow_overrides)
        self._api_url = (api_url or "").rstrip("/")
        self._client_key = client_key or ""
        self._environment = environment or ("development" if self.dev_mode else "production")
        self._track_exposures = track_exposures
        self._realtime = realtime
        self._refresh_interval = float(refresh_interval or 0)
        self._flush_interval = float(flush_interval or 0)
        self._timeout = float(timeout)
        self._on_error = on_error
        self._debug = debug

        initial = bootstrap if bootstrap is not None else config
        self._experiments: Dict[str, Mapping[str, Any]] = {e["key"]: e for e in _load_experiments(initial)}
        self._overrides: Dict[str, Treatment] = dict(overrides or {}) if self.overrides_allowed else {}
        self._config_version: Optional[str] = None
        self._listeners: List[Listener] = []

        self._queue: List[Dict[str, Any]] = []
        self._exposed: Set[str] = set()
        self._closed = False
        self._ready = threading.Event()
        self._atexit_fn: Optional[Callable[[], None]] = None
        self._init_threading()

        if self.is_remote:
            self._start_background()
            self._register_process_hooks()
            if init_timeout and init_timeout > 0:
                self._ready.wait(init_timeout)
        else:
            self._ready.set()

    # ------------------------------------------------------------------ public

    @property
    def is_remote(self) -> bool:
        """True when talking to a Forkcast server (``api_url`` and ``client_key`` given)."""
        return bool(self._api_url and self._client_key)

    @property
    def environment(self) -> str:
        """The environment being evaluated (from the server in remote mode)."""
        return self._environment

    @property
    def is_ready(self) -> bool:
        """True once the first config fetch finished (successfully or not)."""
        return self._ready.is_set()

    @property
    def config_version(self) -> Optional[str]:
        return self._config_version

    def ready(self, timeout: Optional[float] = None) -> bool:
        """Block until the first config fetch finished. Returns ``is_ready``."""
        return self._ready.wait(timeout)

    def for_user(self, user: UserLike = None, overrides: Optional[Mapping[str, Treatment]] = None) -> ScopedForkcast:
        """Bind an evaluator to a user: a dict with ``id`` and any attributes, or just an id.

        ``overrides`` (e.g. parsed from ``?forkcast=new-checkout:T1``) apply only when
        overrides are allowed, so they are safe to pass through in production.
        """
        extra = dict(overrides) if overrides and self.overrides_allowed else None
        return ScopedForkcast(self, _normalize_user(user), extra)

    def get_treatment(self, key: str, user: UserLike = None) -> Treatment:
        return self.for_user(user).get_treatment(key)

    def get_variant(self, key: str, user: UserLike = None) -> Evaluation:
        return self.for_user(user).get_variant(key)

    def is_enabled(self, key: str, user: UserLike = None) -> bool:
        return self.for_user(user).is_enabled(key)

    def get_payload(self, key: str, user: UserLike = None, default: Any = None) -> Any:
        return self.for_user(user).get_payload(key, default)

    def peek(self, key: str, user: UserLike = None) -> Evaluation:
        return self.for_user(user).peek(key)

    def get_all_treatments(self, user: UserLike = None) -> Dict[str, Treatment]:
        return self.for_user(user).get_all_treatments()

    def track(self, name: str, user: UserLike, value: Optional[float] = None, **properties: Any) -> None:
        """Record a conversion / business event for ``user``."""
        self._track_for(_normalize_user(user), name, value, properties)

    def get_experiments(self) -> List[Mapping[str, Any]]:
        return list(self._experiments.values())

    def set_config(self, config: ConfigLike) -> None:
        """Replace experiments (local mode, tests)."""
        self._experiments = {e["key"]: e for e in _load_experiments(config)}
        self._emit()

    def override(self, key: str, variant: Optional[Treatment]) -> None:
        """Force a treatment for every user. ``None`` removes it. Ignored unless overrides are allowed."""
        if not self.overrides_allowed:
            logger.debug("override ignored: overrides are disabled (production?)")
            return
        updated = dict(self._overrides)
        if variant is None:
            updated.pop(key, None)
        else:
            updated[key] = variant
        self._overrides = updated
        self._emit()

    def get_overrides(self) -> Dict[str, Treatment]:
        return dict(self._overrides)

    def clear_overrides(self) -> None:
        self._overrides = {}
        self._emit()

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        """Call ``listener()`` whenever config or overrides change. Returns an unsubscribe function."""
        self._listeners.append(listener)

        def unsubscribe() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    def refresh(self) -> None:
        """Fetch the latest config now. Raises :class:`ForkcastError` on failure."""
        if not self.is_remote:
            return
        body = self._request("GET", "/api/sdk/config", headers={"x-forkcast-key": self._client_key})
        self._apply_remote(body)

    def flush(self) -> None:
        """Send queued events now. Never raises; failed batches are retried later."""
        with self._flush_lock:
            with self._lock:
                events, self._queue = self._queue, []
            if not events or not self.is_remote:
                return
            try:
                self._request(
                    "POST",
                    "/api/sdk/events",
                    body={"clientKey": self._client_key, "events": events},
                    headers={"content-type": "text/plain"},
                )
            except Exception as err:  # noqa: BLE001 - never break the host app
                with self._lock:
                    self._queue[:0] = events[-_REQUEUE_LIMIT:]
                self._handle_error(err)

    def close(self) -> None:
        """Stop background work and flush pending events. Safe to call twice."""
        if self._closed:
            return
        self._closed = True
        self._stop.set()
        self._wake.set()
        self._interrupt_stream()
        self.flush()
        worker = self._worker
        if worker is not None and worker is not threading.current_thread():
            worker.join(self._timeout + 1)
        if self._atexit_fn is not None:
            atexit.unregister(self._atexit_fn)
            self._atexit_fn = None

    def __enter__(self) -> Forkcast:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        mode = f"remote {self._api_url}" if self.is_remote else "local"
        return f"Forkcast({mode}, environment={self._environment!r}, experiments={len(self._experiments)})"

    # --------------------------------------------------------------- internals

    def _experiment_keys(self) -> List[str]:
        return list(self._experiments.keys())

    def _evaluate_for(
        self,
        user: Dict[str, Any],
        key: str,
        extra_overrides: Optional[Dict[str, Treatment]],
        record: bool,
    ) -> Evaluation:
        if self._forked:
            self._after_fork_restart()
        overrides: Optional[Dict[str, Treatment]] = None
        if self.overrides_allowed and (self._overrides or extra_overrides):
            overrides = {**self._overrides, **(extra_overrides or {})}
        ev = evaluate(self._experiments.get(key), key, user, self._environment, overrides)

        user_id = user.get("id")
        if record and ev.in_experiment and self._track_exposures and user_id:
            dedupe = f"{user_id}|{key}|{ev.variant}"
            with self._lock:
                fresh = dedupe not in self._exposed
                if fresh:
                    if len(self._exposed) >= _DEDUPE_LIMIT:
                        self._exposed.clear()
                    self._exposed.add(dedupe)
            if fresh:
                event: Dict[str, Any] = {
                    "type": "exposure",
                    "experiment": key,
                    "variant": ev.variant,
                    "userId": user_id,
                    "ts": _now_ms(),
                }
                attributes = _pick_attributes(user)
                if attributes:
                    event["attributes"] = attributes
                self._enqueue(event)
        if self._debug:
            logger.debug("%s -> %s (%s)", key, ev.variant, ev.reason)
        return ev

    def _track_for(
        self, user: Mapping[str, Any], name: str, value: Optional[float], properties: Mapping[str, Any]
    ) -> None:
        user_id = user.get("id")
        if not user_id:
            return
        event: Dict[str, Any] = {"type": "track", "name": name, "userId": user_id, "ts": _now_ms()}
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            event["value"] = value
        if properties:
            event["properties"] = dict(properties)
        self._enqueue(event)

    def _enqueue(self, event: Dict[str, Any]) -> None:
        if not self.is_remote or self._closed:
            return
        with self._lock:
            self._queue.append(event)
            size = len(self._queue)
        if size >= _FLUSH_AT:
            self._flush_requested = True
            self._wake.set()

    def _apply_remote(self, body: Any) -> None:
        if not isinstance(body, Mapping) or not isinstance(body.get("experiments"), list):
            raise ForkcastError("Forkcast: unexpected config response")
        version = body.get("version")
        if version and version == self._config_version:
            return
        self._config_version = version
        self._environment = body.get("environment") or self._environment
        self._experiments = {e["key"]: e for e in _load_experiments(body["experiments"])}
        self._emit()

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        data = json.dumps(body, separators=(",", ":"), default=str).encode("utf-8") if body is not None else None
        req = urlrequest.Request(self._api_url + path, data=data, method=method)
        req.add_header("user-agent", _USER_AGENT)
        req.add_header("accept", "application/json")
        for name, value in (headers or {}).items():
            req.add_header(name, value)
        try:
            with urlrequest.urlopen(req, timeout=timeout or self._timeout) as resp:
                raw = resp.read()
        except HTTPError as err:
            raise ForkcastError(f"Forkcast: {method} {path} failed with {err.code}") from err
        except (URLError, OSError) as err:
            raise ForkcastError(f"Forkcast: cannot reach {self._api_url} ({err})") from err
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError as err:
            raise ForkcastError(f"Forkcast: invalid JSON from {path}") from err

    def _emit(self) -> None:
        for listener in list(self._listeners):
            try:
                listener()
            except Exception as err:  # noqa: BLE001
                self._handle_error(err)

    def _handle_error(self, err: BaseException) -> None:
        if self._on_error is not None:
            try:
                self._on_error(err)
            except Exception:  # noqa: BLE001
                logger.exception("forkcast: on_error callback failed")
        else:
            logger.warning("%s", err)

    # ---------------------------------------------------- background threads

    def _init_threading(self) -> None:
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._flush_requested = False
        self._forked = False
        self._worker: Optional[threading.Thread] = None
        self._stream_thread: Optional[threading.Thread] = None
        self._stream_resp: Any = None

    def _start_background(self) -> None:
        self._worker = threading.Thread(target=self._run, name="forkcast-worker", daemon=True)
        self._worker.start()
        if self._realtime:
            self._stream_thread = threading.Thread(target=self._stream_loop, name="forkcast-stream", daemon=True)
            self._stream_thread.start()

    def _register_process_hooks(self) -> None:
        ref = weakref.ref(self)

        def close_at_exit() -> None:
            client = ref()
            if client is not None:
                client.close()

        self._atexit_fn = close_at_exit
        atexit.register(close_at_exit)

        if hasattr(os, "register_at_fork"):

            def mark_forked() -> None:
                client = ref()
                if client is not None and not client._closed:
                    # Threads do not survive fork(). Fresh locks, empty queue (the parent
                    # still owns and sends its own events), threads restart lazily.
                    client._init_threading()
                    client._queue = []
                    client._forked = True

            os.register_at_fork(after_in_child=mark_forked)

    def _after_fork_restart(self) -> None:
        with self._lock:
            if not self._forked:
                return
            self._forked = False
        self._start_background()

    def _run(self) -> None:
        polling = not self._realtime and self._refresh_interval > 0
        next_refresh = math.inf
        next_flush = time.monotonic() + self._flush_interval if self._flush_interval > 0 else math.inf
        # In realtime mode the stream thread owns config loading, so two threads
        # never race to apply different versions.
        if not self._ready.is_set() and not self._realtime:
            try:
                self.refresh()
            except Exception as err:  # noqa: BLE001
                self._handle_error(err)
            finally:
                self._ready.set()  # Never block the app: unknown experiments evaluate to C.
        if polling:
            next_refresh = time.monotonic() + self._refresh_interval

        while not self._stop.is_set():
            now = time.monotonic()
            if now >= next_refresh:
                try:
                    self.refresh()
                except Exception as err:  # noqa: BLE001
                    self._handle_error(err)
                next_refresh = time.monotonic() + self._refresh_interval
            if self._flush_requested or now >= next_flush:
                self._flush_requested = False
                self.flush()
                if self._flush_interval > 0:
                    next_flush = time.monotonic() + self._flush_interval
            wait = min(next_refresh, next_flush, time.monotonic() + 60.0) - time.monotonic()
            self._wake.wait(max(0.0, wait))
            self._wake.clear()

    def _interrupt_stream(self) -> None:
        """Unblock the stream thread's pending read.

        Closing the response from another thread would wait for the reader's
        lock (up to the read timeout), so shut the socket down instead.
        """
        resp = self._stream_resp
        sock = getattr(getattr(getattr(resp, "fp", None), "raw", None), "_sock", None)
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def _fallback_refresh(self) -> None:
        """Stream unavailable: fetch the config with a plain request so the app still gets it."""
        try:
            self.refresh()
        except Exception as err:  # noqa: BLE001
            self._handle_error(err)
        finally:
            self._ready.set()

    def _stream_loop(self) -> None:
        url = f"{self._api_url}/api/sdk/stream?key={quote(self._client_key, safe='')}"
        retry = 3.0
        while not self._stop.is_set():
            try:
                req = urlrequest.Request(url, headers={"accept": "text/event-stream", "user-agent": _USER_AGENT})
                resp = urlrequest.urlopen(req, timeout=_STREAM_READ_TIMEOUT)
                self._stream_resp = resp
                event, data = "message", []  # type: str, List[str]
                for raw in resp:
                    if self._stop.is_set():
                        break
                    line = raw.decode("utf-8").rstrip("\r\n")
                    if not line:
                        if data and event == "config":
                            try:
                                self._apply_remote(json.loads("\n".join(data)))
                                self._ready.set()
                            except Exception as err:  # noqa: BLE001
                                self._handle_error(err)
                        event, data = "message", []
                        continue
                    if line.startswith(":"):
                        continue
                    field, _, value = line.partition(":")
                    value = value[1:] if value.startswith(" ") else value
                    if field == "event":
                        event = value
                    elif field == "data":
                        data.append(value)
                    elif field == "retry" and value.isdigit():
                        retry = int(value) / 1000
            except (socket.timeout, TimeoutError):
                pass  # Idle stream: reconnect (the server re-sends the config on connect).
            except Exception as err:  # noqa: BLE001
                if not self._stop.is_set():
                    self._handle_error(ForkcastError(f"Forkcast: realtime stream disconnected ({err})"))
                    self._fallback_refresh()
            finally:
                resp, self._stream_resp = self._stream_resp, None
                if resp is not None:
                    try:
                        resp.close()
                    except Exception:  # noqa: BLE001
                        pass
            self._stop.wait(retry)


def create_forkcast(**options: Any) -> Forkcast:
    """Alias of :class:`Forkcast` that mirrors ``createForkcast`` in the JS SDK."""
    return Forkcast(**options)
