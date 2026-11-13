"""End-to-end: the Python SDK against the real Forkcast server (Node.js).

Starts ``node dist/cli.js start`` from the repository root with the demo
config, then checks that:

- Python and the JavaScript SDK give every user the same treatments,
- a kill switch flipped in the admin API reaches Python (polling and realtime),
- exposures and conversions sent from Python show up in the experiment results.

Skipped when Node.js or the built JS package (``npm run build:lib``) is missing.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterator, List

import pytest

from forkcast import Forkcast

from .conftest import wait_for

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "dist" / "cli.js"
SDK = ROOT / "dist" / "index.js"
SEED = ROOT / "examples" / "forkcast.demo.json"
PROD_KEY = "fc_prod_demo_key"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    not (NODE and CLI.exists() and SDK.exists() and SEED.exists()),
    reason="needs Node.js and the built JS package (run `npm ci && npm run build:lib` in the repo root)",
)

COUNTRIES = ["IN", "US", "GB", "FR", "BR"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def call(base: str, method: str, path: str, body: Any = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read() or b"null")


@pytest.fixture(scope="module")
def forkcast_server() -> Iterator[str]:
    port = free_port()
    proc = subprocess.Popen(
        [
            NODE or "node",
            str(CLI),
            "start",
            "--memory",
            "--no-dashboard",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--seed",
            str(SEED),
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                if call(base, "GET", "/api/health")["ok"]:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Forkcast server did not start")
        yield base
    finally:
        proc.terminate()
        proc.wait(5)


def users() -> List[Dict[str, Any]]:
    return [{"id": f"user-{i}", "country": COUNTRIES[i % len(COUNTRIES)]} for i in range(300)]


def js_treatments(base: str, people: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    script = f"""
      import {{ createForkcast }} from {json.dumps(SDK.as_uri())};
      const fc = createForkcast({{
        apiUrl: {json.dumps(base)}, clientKey: {json.dumps(PROD_KEY)}, devMode: false, trackExposures: false,
      }});
      await fc.ready();
      const users = {json.dumps(people)};
      console.log(JSON.stringify(users.map((u) => fc.forUser(u).getAllTreatments())));
      await fc.close();
    """
    out = subprocess.run(
        [NODE or "node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30, check=True
    )
    return json.loads(out.stdout)


def test_python_and_javascript_assign_the_same_treatments(forkcast_server: str) -> None:
    people = users()
    with Forkcast(api_url=forkcast_server, client_key=PROD_KEY, track_exposures=False) as fc:
        assert fc.environment == "production"
        python = [fc.get_all_treatments(u) for u in people]
    javascript = js_treatments(forkcast_server, people)
    assert python == javascript
    # Sanity: the demo data really exercises traffic, targeting and launches.
    checkout = {t["new-checkout"] for t in python}
    assert checkout == {"C", "T1", "T2"}
    assert {t["free-shipping-banner"] for t in python} == {"T1"}
    assert {t["holiday-theme"] for t in python} == {"C"}


def test_kill_switch_reaches_python(forkcast_server: str) -> None:
    polling = Forkcast(api_url=forkcast_server, client_key=PROD_KEY, refresh_interval=0.2)
    realtime = Forkcast(api_url=forkcast_server, client_key=PROD_KEY, realtime=True)
    try:
        assert polling.get_variant("dark-mode", "user-1").reason in ("assigned", "not_in_traffic")
        call(forkcast_server, "PATCH", "/api/experiments/dark-mode/environments/production", {"status": "off"})
        assert wait_for(lambda: realtime.get_variant("dark-mode", "user-1").reason == "off", timeout=3)
        assert wait_for(lambda: polling.get_variant("dark-mode", "user-1").reason == "off", timeout=3)
        call(forkcast_server, "PATCH", "/api/experiments/dark-mode/environments/production", {"status": "launched"})
        assert wait_for(lambda: realtime.get_treatment("dark-mode", "anyone") == "T1", timeout=3)
    finally:
        polling.close()
        realtime.close()


def test_events_from_python_show_up_in_results(forkcast_server: str) -> None:
    with Forkcast(api_url=forkcast_server, client_key=PROD_KEY) as fc:
        assigned = buyers = 0
        for i in range(400):
            scoped = fc.for_user({"id": f"buyer-{i}", "country": "IN"})
            if scoped.get_variant("new-checkout").in_experiment:
                assigned += 1
                if i % 4 == 0:
                    buyers += 1
                    scoped.track("purchase", value=20)
    assert assigned > 100  # 50% traffic in production
    results = call(forkcast_server, "GET", "/api/experiments/new-checkout/results?env=production")
    assert results["totalUsers"] == assigned
    purchase = next(m for m in results["metrics"] if m["name"] == "purchase")
    assert sum(v["conversions"] for v in purchase["variants"]) == buyers > 0
    assert sum(v["total"] for v in purchase["variants"]) == buyers * 20
