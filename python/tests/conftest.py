"""Shared fixtures: a tiny in-process stand-in for the Forkcast server's SDK API."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Iterator, List

import pytest

CLIENT_KEY = "fc_test_key"


def experiment(key: str, **extra: Any) -> Dict[str, Any]:
    exp: Dict[str, Any] = {
        "key": key,
        "name": key,
        "type": "experiment",
        "variants": [
            {"key": "C", "weight": 50},
            {"key": "T1", "weight": 50, "payload": {"label": "one-click"}},
        ],
        "environments": {"production": {"status": "running", "traffic": 100}},
    }
    exp.update(extra)
    return exp


class FakeServer:
    """Implements GET /api/sdk/config, POST /api/sdk/events and GET /api/sdk/stream."""

    def __init__(self) -> None:
        self.experiments: List[Dict[str, Any]] = [experiment("new-checkout")]
        self.environment = "production"
        self.version = 1
        self.events: List[Dict[str, Any]] = []
        self.event_requests: List[Dict[str, Any]] = []
        self.config_requests = 0
        self.headers: List[Dict[str, str]] = []
        self.fail_events = False
        self.fail_config = False
        self.config_delay = 0.0
        self.stream_enabled = True
        self._streams: List[Any] = []
        self._lock = threading.Lock()
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def _json(self, status: int, body: Any) -> None:
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self) -> None:  # noqa: N802
                server.headers.append({k.lower(): v for k, v in self.headers.items()})
                if self.path.startswith("/api/sdk/config"):
                    server.config_requests += 1
                    if server.config_delay:
                        time.sleep(server.config_delay)
                    if server.fail_config:
                        return self._json(500, {"error": "boom"})
                    if self.headers.get("x-forkcast-key") != CLIENT_KEY:
                        return self._json(401, {"error": "bad key"})
                    return self._json(200, server.config())
                if self.path.startswith("/api/sdk/stream"):
                    if not server.stream_enabled:
                        return self._json(404, {"error": "streaming disabled by proxy"})
                    if f"key={CLIENT_KEY}" not in self.path:
                        return self._json(401, {"error": "bad key"})
                    self.send_response(200)
                    self.send_header("content-type", "text/event-stream")
                    self.send_header("cache-control", "no-cache")
                    self.end_headers()
                    self.wfile.write(b"retry: 200\n: hello\n\n")
                    with server._lock:  # register before the first push so no update is missed
                        server._streams.append(self.wfile)
                        server.push(self.wfile)
                    try:
                        while True:
                            time.sleep(0.05)
                            if self.wfile.closed:
                                break
                    except Exception:  # noqa: BLE001
                        pass
                    return None
                return self._json(404, {"error": "not found"})

            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                server.headers.append({k.lower(): v for k, v in self.headers.items()})
                if self.path.startswith("/api/sdk/events"):
                    if server.fail_events:
                        return self._json(503, {"error": "down"})
                    server.event_requests.append(body)
                    server.events.extend(body.get("events", []))
                    return self._json(202, {"accepted": len(body.get("events", []))})
                return self._json(404, {"error": "not found"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def config(self) -> Dict[str, Any]:
        return {"environment": self.environment, "version": str(self.version), "experiments": self.experiments}

    def push(self, wfile: Any) -> None:
        data = json.dumps(self.config())
        wfile.write(f"event: config\ndata: {data}\n\n".encode())
        wfile.flush()

    def update(self, experiments: List[Dict[str, Any]], broadcast: bool = True) -> None:
        self.experiments = experiments
        self.version += 1
        if broadcast:
            with self._lock:
                for w in list(self._streams):
                    try:
                        self.push(w)
                    except Exception:  # noqa: BLE001
                        self._streams.remove(w)

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def server() -> Iterator[FakeServer]:
    srv = FakeServer()
    yield srv
    srv.stop()


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()
