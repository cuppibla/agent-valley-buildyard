"""The yard's service — two endpoints, one of them a stream.

`/graph` hands the browser the shape of the graph so the crew row can be built out
of the learner's OWN edges rather than a hardcoded list. `/build` runs it and
streams one message per thing that happens, because a crew card that only lights up
after the whole workflow returns teaches nothing.

The graph is re-imported on every request. Adding an edge in `yard/agent.py` changes
what the valley runs; a syntax error falls back to the last good graph and says so,
which is the honest version of "your edit didn't import".
"""

from __future__ import annotations

import asyncio
import base64
import importlib
import json
import logging
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import forge  # noqa: F401,E402  — settles Vertex-vs-key config for every surface
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from google.adk.artifacts import InMemoryArtifactService  # noqa: E402
from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.adk.workflow.utils._workflow_hitl_utils import (  # noqa: E402
    create_request_input_response, get_request_input_interrupt_ids)
from google.genai import types  # noqa: E402

log = logging.getLogger(__name__)
app = FastAPI(title="Agent 101 · W2 the Buildyard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

APP = "yard"
_sessions = InMemorySessionService()
_artifacts = InMemoryArtifactService()

_last_good = None          # the graph that imported, in case the next edit does not


# ── the learner's graph ─────────────────────────────────────────────────────
def load_graph() -> tuple[object, str | None]:
    """Re-import yard.agent. Returns (workflow, error) — never raises.

    Falling back rather than 502-ing is deliberate: a broken edit should leave the
    valley standing and say what happened, the same way a broken reference in week
    one names the bytes it got instead of dying at the image model.
    """
    global _last_good
    try:
        mod = importlib.import_module("yard.agent")
        mod = importlib.reload(mod)
        _last_good = mod.root_agent
        return mod.root_agent, None
    except Exception as exc:                       # noqa: BLE001 — any bad edit lands here
        log.warning("yard.agent did not import: %s", exc)
        if _last_good is None:
            raise
        return _last_good, f"{type(exc).__name__}: {exc}"


def topology(wf) -> dict:
    """The shape the UI draws: who runs after who, and which nodes run together."""
    edges = [{"from": e.from_node.name, "to": e.to_node.name, "route": e.route}
             for e in wf.graph.edges]
    fan: dict[str, list[str]] = {}
    for e in wf.graph.edges:
        fan.setdefault(e.from_node.name, []).append(e.to_node.name)
    # a fan-out is any node with more than one unrouted successor
    groups = [v for k, v in fan.items()
              if len([e for e in wf.graph.edges if e.from_node.name == k and e.route is None]) > 1]
    return {
        "name": wf.name,
        "nodes": [n.name for n in wf.graph.nodes if not n.name.startswith("__")],
        "edges": edges,
        "fanout": groups[0] if groups else [],
        "successors": fan,
    }


@app.get("/health")
async def health() -> dict:
    wf, err = load_graph()
    return {"ok": True, "graph": topology(wf), "graph_error": err}


@app.get("/sites")
async def sites() -> dict:
    from yard import lookups
    return {"sites": lookups.site_names()}


@app.get("/graph")
async def graph() -> dict:
    wf, err = load_graph()
    return {"graph": topology(wf), "graph_error": err}


# ── the stream ──────────────────────────────────────────────────────────────
def _sse(kind: str, **data) -> str:
    return f"data: {json.dumps({'kind': kind, **data})}\n\n"


async def _run(sid: str, message: types.Content, *, site: str | None = None,
               resuming: bool = False):
    """Drive the workflow and translate ADK events into the ones the UI understands.

    The same generator serves the first build and every resume after it, because to
    the workflow they are the same thing: a message arriving on a session. What is
    different is only what the message carries — a request, or an answer.
    """
    wf, err = load_graph()
    topo = topology(wf)
    yield _sse("graph", graph=topo, graph_error=err)

    succ = topo["successors"]
    # How many branches THIS round of the join is waiting for. It starts as the whole
    # fan-out and shrinks to whatever the inspector sent back: a rework only re-runs
    # the door, so "waiting 1 of 3" would be a lie the second time round.
    expected = len(topo["fanout"]) or 1
    landed: set[str] = set()
    t0 = time.monotonic()
    node_t0: dict[str, float] = {}

    def start(names):
        """Start a node's clock. Called every time a node is entered, including the
        second time round after a rework — a node that runs twice is timed twice."""
        out = []
        for n in names:
            if n in ("join",) or n.startswith("__"):
                continue
            node_t0[n] = time.monotonic()
            out.append(_sse("node.start", node=n, at=round(time.monotonic() - t0, 2)))
        return out

    if not resuming:
        for chunk in start(succ.get("__START__", [])):
            yield chunk

    sess = await _sessions.get_session(app_name=APP, user_id="traveler", session_id=sid)
    if sess is None:
        # A forced site is how the reader runs the experiment: same request, same
        # crew, one variable moved. Without it nobody can tell that the cottage
        # tracks the findings rather than merely being a cottage. It goes in as
        # `force_site` because `survey` writes `site` itself — a callback on survey
        # overrules its pick, which is week one's lesson with a hard hat on.
        await _sessions.create_session(app_name=APP, user_id="traveler", session_id=sid,
                                       state={"force_site": site} if site else None)

    runner = Runner(app_name=APP, agent=wf, session_service=_sessions,
                    artifact_service=_artifacts)

    try:
        async for ev in runner.run_async(user_id="traveler", session_id=sid,
                                         new_message=message):
            info = (ev.model_dump().get("node_info") or {})
            node = (info.get("path") or "").split("/")[-1].split("@")[0]
            if not node:
                continue

            parts = (ev.content.parts if ev.content else []) or []

            # The graph has stopped and is waiting for a person. This has to be
            # tested BEFORE the tool filter below: a pause is delivered as a
            # function call too, and the filter would drop the one event the whole
            # chapter is about.
            waiting = get_request_input_interrupt_ids(ev)
            if waiting:
                call = next(p.function_call for p in parts if p.function_call)
                yield _sse("interrupt", node=node, interrupt_id=waiting[0],
                           message=call.args.get("message"),
                           payload=call.args.get("payload"))
                continue

            # An agent with a tool emits three events per turn — the call, the
            # result, and the answer — and only the third is the node finishing.
            # Counting all three had `stock` reporting six times across two rounds
            # and inflating the "of work" total the crew line is measured from.
            if any(getattr(p, "function_call", None) or getattr(p, "function_response", None)
                   for p in parts):
                continue

            text, image = "", None
            for p in parts:
                if p.text and p.text.strip():
                    text = p.text.strip()
                elif getattr(p, "inline_data", None) and p.inline_data.data:
                    image = "data:image/jpeg;base64," + base64.b64encode(p.inline_data.data).decode()

            route = ev.actions.route if ev.actions else None
            ms = int((time.monotonic() - node_t0.get(node, t0)) * 1000)

            if node == "join":
                landed = set()
                yield _sse("join.done", branches=topo["fanout"])
            else:
                if node in topo["fanout"]:
                    landed.add(node)
                finding = None
                if node in topo["fanout"]:
                    from yard.agent import finding_from
                    finding = finding_from(node, ev.model_dump().get("output") or text)
                yield _sse("node.done", node=node, ms=ms, text=text[:200], finding=finding)
                if node in topo["fanout"]:
                    yield _sse("join.wait", have=len(landed), of=expected)

            if image:
                out = ev.model_dump().get("output") or {}
                yield _sse("render", image=image, text=text[:200],
                           plan=(out.get("plan") if isinstance(out, dict) else None))

            if route:
                dest = [e["to"] for e in topo["edges"]
                        if e["from"] == node and e["route"] == route]
                yield _sse("route", **{"from": node, "to": dest[0] if dest else None,
                                       "route": route, "why": text[:160]})
                back = [d for d in dest if d in topo["fanout"]]
                if back:
                    expected = len(back)
                for chunk in start(dest):
                    yield chunk
            else:
                nxt = [e["to"] for e in topo["edges"]
                       if e["from"] == node and e["route"] is None]
                for chunk in start(nxt):
                    yield chunk
    except Exception as exc:                       # noqa: BLE001
        log.exception("build failed")
        yield _sse("error", message=f"{type(exc).__name__}: {exc}"[:300])
        return

    yield _sse("done", seconds=round(time.monotonic() - t0, 1))


@app.post("/build")
async def build(req: Request):
    body = await req.json()
    request_text = (body.get("request") or "somewhere to read in the afternoon").strip()
    # Mint one rather than trusting the client: week one shipped a fallback that
    # returned no session id at all, and every later call died on an empty string.
    sid = body.get("session_id") or f"y-{uuid.uuid4().hex[:10]}"
    msg = types.Content(role="user", parts=[types.Part(text=request_text)])
    return StreamingResponse(
        _run(sid, msg, site=body.get("site")),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "X-Session-Id": sid},
    )


@app.post("/sign")
async def sign(req: Request):
    """The traveler's answer, on its way back into a graph that is already waiting.

    It is the same session and the same endpoint shape as `/build` — a message goes
    in, a stream of what happened comes out. The workflow does not know or care that
    minutes passed, or that this is a different HTTP request than the one it stopped
    in: it is holding an interrupt id, and this is the answer to it.
    """
    body = await req.json()
    sid = (body.get("session_id") or "").strip()
    interrupt_id = (body.get("interrupt_id") or "").strip()
    if not sid or not interrupt_id:
        return {"error": "session_id and interrupt_id are both required"}
    answer = {"ok": bool(body.get("ok")), "note": (body.get("note") or "").strip()}
    msg = types.Content(role="user",
                        parts=[create_request_input_response(interrupt_id, answer)])
    return StreamingResponse(
        _run(sid, msg, resuming=True),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "X-Session-Id": sid},
    )
