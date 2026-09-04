"""The Buildyard — one graph, four shapes.

    START ─▶ survey ─▶ blueprint ─┬─▶ ground  ─┐
                          ▲       ├─▶ stock   ─┼─▶ join ─▶ render ─▶ inspect
                          │       └─▶ weather ─┘                       │
                          │                             "rework" ◀─────┤
                          │                                    "pass"  ▼
                          └───────────── "change" ───────────────── approve ─▶ finish

Everything in this file except the last statement is an ordinary agent or an
ordinary function. The last statement is the chapter: three ways of saying what
runs next, in one list.

    a, b, c            a chain      — b runs after a
    (a, b, c)          a tuple      — all three run together
    {"x": a, "y": b}   a dict       — whichever route the node emitted

There is no fourth shape. `approve` stops the graph and waits for a person, and
then routes on the word they said — through the same dict `inspect` routes
through. Human-in-the-loop is not a new mechanism; it is a different mouth.

The three branches are deliberately three DIFFERENT KINDS of thing — a plain
function, an agent with a tool, an agent with none — because a node is a slot, not
an agent. It is also why they cannot be collapsed: one model call is not
simultaneously a soil calculation, an inventory query and a judgement about snow.
"""

from __future__ import annotations

import asyncio
from typing import Any

from google.adk import Agent, Event, Workflow
from google.adk.agents.context import Context
from google.adk.events import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.workflow import FunctionNode, JoinNode
from google.genai import types
from pydantic import BaseModel, Field

from forge.agent.backends import shrink
from yard import lookups
from yard.scene import render_site

MODEL = "gemini-3-flash-preview"

# Gemini 3 thinks before it answers. Left on everywhere, `weather` spent 80 seconds
# of a 105-second build deliberating about a roof pitch — so it is off for the two
# nodes whose jobs are clerical (pick a site id, restate a brief) and left ON for the
# two branches that genuinely weigh something. That is also what makes the fan-out
# watchable: with thinking off everywhere the whole thing was over in 2.4 seconds,
# which is the right answer to the wrong question.
FAST = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_budget=0))

# How many times the reviewer is allowed to send work back. A loop in a graph is
# still a loop: something has to end it, and putting the bound here — rather than
# hoping the model stops — is the whole point of chapter 4.
MAX_REWORKS = 1


# ── where, and what ─────────────────────────────────────────────────────────
# `survey` has a real job now: it picks the SITE, and everything downstream reads
# it. output_key drops its answer into state, which is how three branches that
# each receive blueprint's brief can still know which ground they are standing on.
def _honour_forced_site(callback_context):
    """Week one's identity lock, wearing a hard hat.

    `survey` reads the request and picks a site; if the reader pressed "build it
    somewhere else", this overrules that pick after the fact. The model's choice is
    a request. The callback is the rule — and the whole point of the button is to
    hold everything else still, which only a rule can promise.
    """
    forced = (callback_context.state.get("force_site") or "").strip().lower()
    if forced and forced in lookups.SITES:
        callback_context.state["site"] = forced
    return None


survey = Agent(
    name="survey",
    after_agent_callback=_honour_forced_site,
    model=MODEL,
    generate_content_config=FAST,
    output_key="site",
    instruction=(
        "You choose where to build. These are the only sites in the valley:\n\n"
        + "\n".join(f"  {k}  — {v}" for k, v in lookups.site_names().items())
        + "\n\nRead what the traveler asked for and reply with EXACTLY ONE site id "
        "from the left column — nothing else, no punctuation, no explanation."
    ),
)

blueprint = Agent(
    name="blueprint",
    model=MODEL,
    generate_content_config=FAST,
    instruction=(
        "You are handed a request for a small animal's home. Write the brief in ONE "
        "short sentence — who it is for and what it is for. Not materials, not "
        "structure; the crew decides those.\n\n"
        # The `?` makes it optional: on the first pass there is no note in state and
        # this line renders away to nothing. On a second pass it is the whole reason
        # the yard is running again — which is how a sentence a person typed reaches
        # the footing, the frame and the roof.
        "If the following is not empty, the traveler saw the first design and asked "
        "for a change. Work it into the brief: {note?}\n\n"
        "The sentence and nothing else."
    ),
)


# ── the three that find things out, at the same time ────────────────────────
# Three different kinds of node. Each returns the same shape — what it FOUND and
# what it therefore DECIDED — so the join has something to compose rather than
# three fragments of a sentence to concatenate.

def _finding(branch: str, found: str, decided: str) -> dict:
    return {"branch": branch, "found": found, "decided": decided}


async def ground(ctx: Context, node_input: Any):
    """A plain function. No model at all — soil numbers are arithmetic.

    It returns in milliseconds while the other two take seconds, which is the first
    honest thing anyone learns about a fan-out: branches are not the same length.
    """
    r = lookups.ground_record(ctx.state.get("site", ""))
    found = f"{r['soil']}, {r['drainage']} drainage · {r['bearing_t_m2']} t/m²"
    if r["bearing_t_m2"] < 2.0 or r["water_table_m"] < 1.0:
        decided = "a raised timber floor on short stilts, clear of the wet ground"
    else:
        decided = "a solid stone footing, sitting straight on the ground"
    yield Event(message=f"ground · {found}", output=_finding("ground", found, decided))


def read_store(tool_context) -> dict:
    """What is actually in the yard's store, here, today.

    Returns:
        The timber on hand, how much of it, and whether there is stone.
    """
    # The site comes from the shared dictionary, not from the model. Asked to pass
    # it as an argument the agent read the brief instead and looked up "hedgehog",
    # which quietly returned the default site's timber — a wrong answer that looks
    # like a right one. This is week one's lesson: what you cannot afford the model
    # to get wrong does not go in a prompt.
    return lookups.store_record(tool_context.state.get("site", ""))


stock = Agent(
    name="stock",
    model=MODEL,
    tools=[read_store],
    instruction=(
        "You keep the yard's material store. Call `read_store` — it knows which site "
        "you are on — then choose the frame from what is ACTUALLY there. You cannot "
        "order in.\n\nReply with exactly two lines and nothing else:\n"
        "FOUND: <the timber and how much, six words at most>\n"
        "DECIDED: <the FRAME — posts, beams, trusses — six words at most. Name the "
        "structure, not the building: 'pine king post frame', never 'squirrel house'>"
    ),
)


# No tool, on purpose. It is handed the record and weighs it — which is a third
# kind of node again: not arithmetic, not a lookup, a judgement. Before it had the
# table it invented "cold wind and heavy snow" and took 55 seconds doing it.
_CLIMATE = "\n".join(
    f"  {k}  snow {v['climate']['snow_m']} m · rain {v['climate']['rain_mm']} mm · "
    f"{v['climate']['wind']} wind · {v['climate']['sun']}"
    for k, v in lookups.SITES.items())

weather = Agent(
    name="weather",
    model=MODEL,
    instruction=(
        "You decide the roof and which way the door faces.\n\n"
        "The climate record for every site in the valley:\n" + _CLIMATE +
        "\n\nThe site you are on is: {site}\n\n"
        "Read that site's line. Heavy snow needs a steep pitch; heavy rain needs deep "
        "eaves; a cold wind decides which way the door faces.\n\n"
        "Reply with exactly two lines and nothing else:\n"
        "FOUND: <the conditions, six words at most>\n"
        "DECIDED: <pitch and which way the door faces, eight words at most>"
    ),
)


def finding_from(branch: str, output: Any) -> dict | None:
    """One finding out of whatever a branch returned — a dict from the function node,
    two labelled lines from the agents. The service uses this to fill the plan a row
    at a time, as each branch lands."""
    if isinstance(output, dict) and output.get("branch"):
        return output
    if isinstance(output, str) and output.strip():
        return _split(branch, output)
    return None


def _split(branch: str, text: str) -> dict:
    """Pull FOUND/DECIDED out of an agent's two lines, tolerantly."""
    found = decided = ""
    for line in (text or "").splitlines():
        low = line.strip().lower()
        if low.startswith("found:"):
            found = line.split(":", 1)[1].strip()
        elif low.startswith("decided:"):
            decided = line.split(":", 1)[1].strip()
    return _finding(branch, found or (text or "").strip()[:60], decided or "as found")


join = JoinNode(name="join")


# ── the one node that draws ─────────────────────────────────────────────────
ORDER = ("ground", "stock", "weather")


def _plan(node_input: Any) -> list[dict]:
    """The join hands down a dict keyed by branch. Read it in a fixed order so the
    plan is stable even though the branches finish in whatever order they like.

    Two shapes arrive here, on purpose: `ground` is a function and returns the
    finding already structured, while `stock` and `weather` are agents and return
    text. Three kinds of node, three kinds of output, one plan.
    """
    out: list[dict] = []
    if isinstance(node_input, dict):
        for key in ORDER:
            v = node_input.get(key)
            if isinstance(v, dict) and v.get("branch"):
                out.append(v)
            elif isinstance(v, str) and v.strip():
                out.append(_split(key, v))
    return out


async def render(ctx: Context, node_input: Any):
    """One image, built from the DECISIONS and nothing else.

    Which is what makes the picture legible: every visible thing about the cottage
    traces to a line in the plan, so "why is the roof so steep" has an answer three
    inches above it.
    """
    plan = _plan(node_input)
    decisions = "; ".join(p["decided"] for p in plan if p.get("decided"))
    png = await asyncio.to_thread(render_site, decisions, lookups.SITES.get((ctx.state.get("site") or "").strip().lower(), {}).get("name", "a grassy plot"))
    yield Event(
        message=[
            types.Part.from_text(text="plan: " + decisions),
            types.Part.from_bytes(data=shrink(png), mime_type="image/jpeg"),
        ],
        output={"plan": plan},
    )


# ── the one node that decides ───────────────────────────────────────────────
async def inspect(ctx: Context, node_input: Any):
    """Review the design and either sign it off or send ONE branch back.

    The fault it looks for is a conflict BETWEEN branches — which exists precisely
    because they ran in parallel and could not see each other. That is the cost of
    fanning out, and this node is where it gets paid.

    The count lives in session state, not in a variable up here: two travellers
    building at once share this process, and a counter on the function would have
    them sending each other's work back.
    """
    plan = (node_input or {}).get("plan", []) if isinstance(node_input, dict) else []
    by = {p["branch"]: p for p in plan}
    reworks = int(ctx.state.get("reworks", 0))

    snow = "steep" in (by.get("weather", {}).get("decided", "") or "").lower() \
        or "45" in (by.get("weather", {}).get("decided", "") or "")
    soft = any(w in (by.get("stock", {}).get("decided", "") or "").lower()
               for w in ("cedar", "pine", "birch"))

    if reworks < MAX_REWORKS and snow and soft:
        ctx.state["reworks"] = reworks + 1
        ctx.state["fault"] = "stock"
        yield Event(
            message=("that frame will not carry this roof under snow — "
                     "the weather crew pitched it steep, pick again"),
            actions=EventActions(route="rework"),
        )
    else:
        yield Event(
            message=f"that will stand · {len(plan)} decisions signed off",
            # The plan travels on. The next node has to show a person what they are
            # being asked to sign, and a node only ever sees what the one before
            # handed it — this is the same edge rule as chapter 2, still holding.
            output=node_input if isinstance(node_input, dict) else None,
            actions=EventActions(route="pass"),
        )


# ── the one node that waits ─────────────────────────────────────────────────
SIGN = "yard:sign"


class Signature(BaseModel):
    """What the traveler sends back. A schema, not a sentence — the graph routes on
    `ok`, so it cannot be a paragraph the code then has to interpret."""

    ok: bool = Field(description="True to build it. False to send it back.")
    note: str = Field("", description="If sending it back, what to change.")


async def _approve(ctx: Context, node_input: Any):
    """Stop, and wait for a person.

    Read this next to `inspect`. Both nodes end by emitting one word, and the same
    kind of dict decides what the word means. The only difference is where the word
    comes from — and `RequestInput` is the whole of that difference: it hands the
    question out, and the graph stops until an answer comes back.

    The node runs twice. On the way in there is no answer, so it asks and returns.
    Whenever the answer arrives — a second later or a day later, in a different
    process — the node runs again with `ctx.resume_inputs` filled in, and this time
    it falls through to the routing. That is why it is declared with
    `rerun_on_resume=True` below: without it the body never runs a second time.
    """
    answer = ctx.resume_inputs.get(SIGN)

    if answer is None:
        yield RequestInput(
            interrupt_id=SIGN,
            message="The crew signed off on this. Do you?",
            # What the person is being asked about, so a client has something to
            # show. `adk web` renders it; the yard draws it as the plan and picture.
            payload=node_input if isinstance(node_input, dict) else None,
            response_schema=Signature,
        )
        return

    if answer.get("ok"):
        yield Event(message="signed — the yard can close",
                    actions=EventActions(route="sign"))
    else:
        # No counter here, unlike the reviewer above. A person cannot loop forever
        # by accident: every trip round costs them another answer, and the way out
        # is the button they are already looking at.
        note = (answer.get("note") or "").strip()
        ctx.state["note"] = note
        # A different brief deserves a fresh inspection. Without this the reviewer
        # spends its one rework on the first design and then silently waves through
        # everything the traveler asks for afterwards — a guard that is still in the
        # graph and no longer doing anything.
        ctx.state["reworks"] = 0
        yield Event(message=f"sent back — {note or 'no reason given'}",
                    actions=EventActions(route="change"))


approve = FunctionNode(func=_approve, name="approve", rerun_on_resume=True)


async def finish(node_input: Any):
    yield Event(message="the yard is closed")


# ── the wire ────────────────────────────────────────────────────────────────
root_agent = Workflow(
    name="yard",
    description="Pick a site, brief it, find out three things at once, design, review.",
    edges=[
        ("START", survey,

         # 👉 EDIT ONE — chapter 2. Add `blueprint,` on the next line, then save.

         # 👉 EDIT TWO — chapter 3. Add `(ground, stock, weather), join, render, inspect,`
         #    on the next line. The brackets are the whole syntax of "at the same time".

         # 👉 EDIT THREE — chapter 4. Add `{"rework": stock, "pass": finish},` on the
         #    next line. A dict is "whichever way the reviewer pointed".

         ),

        # 👉 BEYOND THE LAB — the yard can stop and wait for a person. Two changes:
        #    in the list above, point `"pass"` at `approve` instead of `finish`, then
        #    add this whole line below:
        #        (approve, {"sign": finish, "change": blueprint}),
        #    Note that it takes a SECOND path. `edges` is a list of them, and a graph
        #    that comes back on itself needs more than one. The yard app runs with
        #    this wired; see `approve` above for how a node waits without blocking.
    ],
)
