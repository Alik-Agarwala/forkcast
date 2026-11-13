"""The Forkcast client: local mode, remote mode, events, overrides and realtime."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import pytest

from forkcast import Forkcast, ForkcastError, create_forkcast, parse_override_param

from .conftest import CLIENT_KEY, FakeServer, experiment, wait_for


def remote(server: FakeServer, **kwargs: object) -> Forkcast:
    opts: dict = {"api_url": server.url + "/", "client_key": CLIENT_KEY, "flush_interval": 0.05}
    opts.update(kwargs)
    return Forkcast(**opts)


# ------------------------------------------------------------------ local mode


def test_local_mode_from_list_dict_and_file(tmp_path: Path) -> None:
    exps = [experiment("new-checkout")]
    path = tmp_path / "forkcast.config.json"
    path.write_text(json.dumps({"version": 1, "experiments": exps}))
    for config in (exps, {"version": 1, "experiments": exps}, path, str(path)):
        fc = Forkcast(config=config)
        assert fc.is_ready and not fc.is_remote
        assert fc.environment == "production"
        assert fc.get_treatment("new-checkout", "alice") in ("C", "T1")
        assert fc.get_treatment("unknown", "alice") == "C"


def test_same_user_same_treatment_regardless_of_id_type() -> None:
    fc = Forkcast(config=[experiment("new-checkout")])
    assert fc.get_treatment("new-checkout", 42) == fc.get_treatment("new-checkout", {"id": "42"})
    assert fc.get_treatment("new-checkout", {"id": 42}) == fc.get_treatment("new-checkout", "42")


def test_scoped_helpers() -> None:
    fc = Forkcast(
        config=[
            experiment("new-checkout"),
            experiment("flag", variants=[{"key": "C", "weight": 0}, {"key": "T1", "weight": 100, "payload": {"n": 1}}]),
        ]
    )
    scoped = fc.for_user({"id": "bob", "country": "IN"})
    assert scoped.user == {"id": "bob", "country": "IN"}
    assert scoped.is_enabled("flag") is True
    assert scoped.get_payload("flag") == {"n": 1}
    assert scoped.get_payload("missing", default="x") == "x"
    assert set(scoped.get_all_treatments()) == {"new-checkout", "flag"}
    ev = scoped.get_variant("flag")
    assert ev.reason == "assigned" and ev.in_experiment
    assert ev.to_dict()["variant"] == "T1"


def test_anonymous_user_gets_control_for_running_experiments() -> None:
    fc = Forkcast(config=[experiment("new-checkout")])
    ev = fc.get_variant("new-checkout")
    assert ev.variant == "C" and ev.reason == "no_user"


def test_overrides_are_off_by_default() -> None:
    fc = Forkcast(config=[experiment("new-checkout")], overrides={"new-checkout": "T1"})
    assert not fc.overrides_allowed
    fc.override("new-checkout", "T1")
    assert fc.get_overrides() == {}
    assert fc.for_user("u", overrides={"new-checkout": "T1"}).get_variant("new-checkout").reason == "assigned"


def test_overrides_in_dev_mode() -> None:
    fc = Forkcast(
        config=[experiment("new-checkout", environments={"development": {"status": "off"}})],
        dev_mode=True,
        overrides={"new-checkout": "T1"},
    )
    assert fc.environment == "development"
    ev = fc.get_variant("new-checkout", "u")
    assert (ev.variant, ev.reason) == ("T1", "override")
    assert fc.for_user("u", overrides={"new-checkout": "C"}).get_treatment("new-checkout") == "C"
    fc.override("new-checkout", None)
    assert fc.get_treatment("new-checkout", "u") == "C"  # off in development
    fc.override("new-checkout", "T9")  # unknown variant is ignored by evaluation
    assert fc.get_variant("new-checkout", "u").reason == "off"
    fc.clear_overrides()
    assert fc.get_overrides() == {}


def test_subscribe_and_set_config() -> None:
    fc = Forkcast(config=[])
    calls = []
    unsubscribe = fc.subscribe(lambda: calls.append(1))
    fc.set_config([experiment("new-checkout")])
    assert calls == [1] and len(fc.get_experiments()) == 1
    unsubscribe()
    fc.set_config([])
    assert calls == [1]


def test_create_forkcast_alias() -> None:
    assert isinstance(create_forkcast(config=[]), Forkcast)


# ------------------------------------------------------------------ remote mode


def test_remote_fetches_config_and_sends_key(server: FakeServer) -> None:
    with remote(server) as fc:
        assert fc.is_ready and fc.is_remote
        assert fc.config_version == "1"
        assert fc.environment == "production"
        assert fc.get_treatment("new-checkout", "alice") in ("C", "T1")
    get = next(h for h in server.headers if h.get("x-forkcast-key"))
    assert get["x-forkcast-key"] == CLIENT_KEY
    assert get["user-agent"].startswith("forkcast-python/")


def test_exposures_are_deduplicated_and_flushed(server: FakeServer) -> None:
    with remote(server) as fc:
        user = {"id": "alice", "country": "IN", "plan": "pro", "email": "a@x.io", "nested": {"a": 1}}
        for _ in range(5):
            fc.get_treatment("new-checkout", user)
        fc.peek("new-checkout", user)  # no exposure
        assert wait_for(lambda: len(server.events) == 1)
    event = server.events[0]
    assert event["type"] == "exposure" and event["experiment"] == "new-checkout" and event["userId"] == "alice"
    assert event["variant"] in ("C", "T1")
    assert event["attributes"] == {"country": "IN", "plan": "pro"}  # no email, no nested objects
    assert isinstance(event["ts"], int)
    assert server.event_requests[0]["clientKey"] == CLIENT_KEY


def test_only_assigned_evaluations_record_exposures(server: FakeServer) -> None:
    server.experiments = [
        experiment("off", environments={"production": {"status": "off"}}),
        experiment("launched", environments={"production": {"status": "launched", "launchedVariant": "T1"}}),
        experiment("forced", forced=[{"variant": "T1", "userIds": ["alice"]}]),
    ]
    with remote(server) as fc:
        assert fc.get_treatment("off", "alice") == "C"
        assert fc.get_treatment("launched", "alice") == "T1"
        assert fc.get_treatment("forced", "alice") == "T1"
        fc.get_treatment("missing", "alice")
    assert server.events == []


def test_track_events(server: FakeServer) -> None:
    with remote(server) as fc:
        fc.for_user("bob").track("purchase", value=49.99, currency="INR")
        fc.track("signup", {"id": "carol"})
        fc.track("ignored-no-user", None)
        fc.track("bad-value", "dave", value=float("nan"))
        fc.track("bool-value", "erin", value=True)  # type: ignore[arg-type]
    by_name = {e["name"]: e for e in server.events}
    assert set(by_name) == {"purchase", "signup", "bad-value", "bool-value"}
    assert by_name["purchase"]["value"] == 49.99 and by_name["purchase"]["properties"] == {"currency": "INR"}
    assert "value" not in by_name["signup"] and "properties" not in by_name["signup"]
    assert "value" not in by_name["bad-value"] and "value" not in by_name["bool-value"]


def test_flushes_when_queue_reaches_100(server: FakeServer) -> None:
    with remote(server, flush_interval=60) as fc:
        for i in range(100):
            fc.track("click", f"user-{i}")
        assert wait_for(lambda: len(server.events) == 100, timeout=3)


def test_failed_flush_requeues_events(server: FakeServer) -> None:
    errors: list = []
    fc = remote(server, flush_interval=0, on_error=errors.append)
    server.fail_events = True
    fc.track("purchase", "alice")
    fc.flush()
    assert server.events == [] and len(errors) == 1 and isinstance(errors[0], ForkcastError)
    server.fail_events = False
    fc.close()
    assert [e["name"] for e in server.events] == ["purchase"]


def test_unreachable_server_falls_back_to_control(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="forkcast")
    start = time.monotonic()
    fc = Forkcast(api_url="http://127.0.0.1:9", client_key="k", timeout=0.5, init_timeout=2, bootstrap=None)
    assert time.monotonic() - start < 3
    assert fc.is_ready
    assert fc.get_treatment("new-checkout", "alice") == "C"
    assert any("cannot reach" in r.getMessage() for r in caplog.records)
    with pytest.raises(ForkcastError):
        fc.refresh()
    fc.close()


def test_bad_key_and_server_error(server: FakeServer) -> None:
    errors: list = []
    fc = Forkcast(api_url=server.url, client_key="wrong", on_error=errors.append, flush_interval=0)
    assert fc.get_treatment("new-checkout", "alice") == "C"
    assert errors and "401" in str(errors[0])
    fc.close()


def test_bootstrap_is_used_until_first_fetch(server: FakeServer) -> None:
    server.config_delay = 0.5
    boot = [experiment("new-checkout", environments={"production": {"status": "launched", "launchedVariant": "T1"}})]
    fc = remote(server, bootstrap=boot, init_timeout=0)
    assert not fc.is_ready
    assert fc.get_treatment("new-checkout", "alice") == "T1"
    assert fc.ready(5)
    assert fc.get_variant("new-checkout", "alice").reason == "assigned"
    fc.close()


def test_polling_picks_up_changes(server: FakeServer) -> None:
    with remote(server, refresh_interval=0.1) as fc:
        changed: list = []
        fc.subscribe(lambda: changed.append(fc.config_version))
        assert fc.get_variant("new-checkout", "alice").reason == "assigned"
        server.update([experiment("new-checkout", environments={"production": {"status": "off"}})], broadcast=False)
        assert wait_for(lambda: fc.get_variant("new-checkout", "alice").reason == "off")
        assert changed == ["2"]


def test_unchanged_version_is_not_reapplied(server: FakeServer) -> None:
    with remote(server) as fc:
        calls: list = []
        fc.subscribe(lambda: calls.append(1))
        fc.refresh()
        fc.refresh()
        assert calls == []


def test_realtime_stream_applies_changes_instantly(server: FakeServer) -> None:
    with remote(server, realtime=True) as fc:
        assert fc.get_variant("new-checkout", "alice").reason == "assigned"
        polls = server.config_requests
        assert polls == 0  # realtime mode loads config from the stream only
        server.update([experiment("new-checkout", environments={"production": {"status": "off"}})])
        assert wait_for(lambda: fc.get_variant("new-checkout", "alice").reason == "off", timeout=2)
        assert server.config_requests == polls  # came over the stream, not a poll
    assert fc._stream_thread is not None
    assert wait_for(lambda: not fc._stream_thread.is_alive(), timeout=2)  # close() unblocks the read


def test_close_is_idempotent_and_stops_events(server: FakeServer) -> None:
    fc = remote(server)
    fc.close()
    fc.close()
    fc.track("after-close", "alice")
    fc.flush()
    assert server.events == []
    assert fc.get_treatment("new-checkout", "alice") in ("C", "T1")  # reads keep working


def test_repr() -> None:
    assert "local" in repr(Forkcast(config=[]))


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs fork()")
@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_works_after_fork_like_gunicorn_preload(server: FakeServer) -> None:
    fc = remote(server)
    fc.track("parent-event", "parent")
    pid = os.fork()
    if pid == 0:  # child: threads were not copied, the client must restart them
        code = 1
        try:
            fc.get_treatment("new-checkout", "child")
            fc.track("child-event", "child")
            fc.close()
            code = 0
        finally:
            os._exit(code)
    _, status = os.waitpid(pid, 0)
    assert os.WEXITSTATUS(status) == 0
    fc.close()
    names = sorted(e.get("name", e["type"]) for e in server.events)
    assert names.count("parent-event") == 1  # not duplicated by the child
    assert "child-event" in names


def test_realtime_falls_back_to_a_plain_fetch_when_the_stream_fails(server: FakeServer) -> None:
    server.stream_enabled = False  # e.g. a proxy that does not support Server-Sent Events
    errors: list = []
    fc = Forkcast(api_url=server.url, client_key=CLIENT_KEY, realtime=True, on_error=errors.append)
    try:
        assert fc.is_ready
        assert fc.get_variant("new-checkout", "alice").reason == "assigned"
        assert server.config_requests >= 1
        assert any("realtime stream disconnected" in str(e) for e in errors)
    finally:
        fc.close()


def test_parse_override_param() -> None:
    assert parse_override_param("new-checkout:T1, dark-mode : C") == {"new-checkout": "T1", "dark-mode": "C"}
    assert parse_override_param("reset") == "reset"
    assert parse_override_param("") is None
    assert parse_override_param("broken,also:") == {}
