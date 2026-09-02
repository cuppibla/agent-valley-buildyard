"""The Buildyard — one graph, four shapes.

    START ─▶ survey ─▶ blueprint ─┬─▶ roof   ─┐
                                  ├─▶ door   ─┼─▶ join ─▶ render ─▶ inspect ─┬─▶ finish
                                  └─▶ garden ─┘                    ▲         │
                                                                   └─────────┘
                                                                    "rework"

Everything in this file except the last statement is an ordinary agent or an
ordinary function. The last statement is the chapter: three ways of saying what
runs next, in one list.

    a, b, c            a chain      — b runs after a
    (a, b, c)          a tuple      — all three run together
    {"x": a, "y": b}   a dict       — whichever route the node emitted

The three edits the codelab has you make are all in that list, and all one line.
"""

from __future__ import annotations

import asyncio
from typing import Any

from google.adk import Agent, Event, Workflow
from google.adk.agents.context import Context
from google.adk.events import EventActions
from google.adk.workflow import JoinNode
from google.genai import types

from forge.agent.backends import get_backend, shrink

MODEL = "gemini-3-flash-preview"

# How many times the inspector is allowed to send work back. A loop in a graph is
# still a loop: something has to end it, and putting the bound here — rather than
# hoping the model stops — is the whole point of chapter 4.
MAX_REWORKS = 1


# ── the two agents that plan ────────────────────────────────────────────────
survey = Agent(
    name="survey",
    model=MODEL,
    instruction=(
        "You survey a plot of ground for a small animal's home.\n\n"
        "Whatever the traveler asks for, reply with ONE short sentence describing the "
        "plot it should be built on — ground, light, what is around it. Never mention "
        "the building itself; that is not your job.\n\n"
        "The sentence and nothing else. No greeting, no explanation."
    ),
)

blueprint = Agent(
    name="blueprint",
    model=MODEL,
    instruction=(
        "You are handed a description of a plot. Write the build plan for a small "
        "cottage on it, in ONE short sentence — materials, shape, mood.\n\n"
        "The sentence and nothing else."
    ),
)


# ── the three that build, at the same time ──────────────────────────────────
# All three receive the SAME input — whatever `blueprint` returned. Each reads the
# same plan and answers for its own part, which is why they do not need to talk to
# each other and can run together.
def _crew(name: str, part: str, doing: str) -> Agent:
    return Agent(
        name=name,
        model=MODEL,
        instruction=(
            f"You are the {name} of a small building crew. You are handed the build "
            f"plan for a cottage.\n\n"
            f"Reply with ONE short phrase describing {part}, and nothing else — no "
            f"sentence, no punctuation at the end. Six words at most.\n\n"
            f'Example shape: "{doing}".'
        ),
    )


roof = _crew("roof", "the roof you are laying", "steep slate tiles, moss along the ridge")
door = _crew("door", "the front door you are hanging", "a round blue door with a brass handle")
garden = _crew("garden", "the garden you are planting", "a low bed of pink and yellow flowers")

join = JoinNode(name="join")


# ── the one node that draws ─────────────────────────────────────────────────
STYLE = (
    "Cute low-poly art style — faceted geometric shapes with soft flat shading, in the "
    "gentle Monument Valley / Alto's Odyssey aesthetic. Big soft expressive eyes, sweet "
    "friendly faces, warm pastel colours, soft gradient light, plain pastel background, "
    "centered, charming and adorable. No text, no logos."
)

# Naming the crew is not decoration. Pinning holds the building but not the cast:
# when a well was added on a later turn it took the badger's corner and the badger
# simply stopped existing. Say they are all still there, every time.
CREW_LINE = (
    "three little animal builders still at work on it — a fox on the roof, a rabbit at "
    "the door, a badger in the garden"
)


def _parts(node_input: Any) -> list[str]:
    """The join hands down a dict keyed by branch. Read it in a fixed order so the
    prompt is stable even though the branches finish in whatever order they like."""
    if isinstance(node_input, dict):
        return [str(node_input.get(k) or "").strip() for k in ("roof", "door", "garden")]
    return [str(node_input).strip()]


async def render(node_input: Any):
    """One image, from three descriptions.

    Deliberately the ONLY node that draws. Three parallel renders would return three
    different cottages and nothing could merge them — so the branches return words,
    and the join is where the words become one picture.
    """
    roof_txt, door_txt, garden_txt = _parts(node_input)
    built = f"{roof_txt}; {door_txt}; {garden_txt}"

    sheet = f"a small half-built cottage with {built}, and {CREW_LINE}"
    result = await asyncio.to_thread(
        get_backend().render,
        sheet=sheet, form="the site so far", reference_seed="yard",
    )
    yield Event(
        message=[
            types.Part.from_text(text=f"built: {built}"),
            types.Part.from_bytes(data=shrink(result.png), mime_type="image/jpeg"),
        ],
        output={"built": [roof_txt, door_txt, garden_txt]},
    )


# ── the one node that decides ───────────────────────────────────────────────
async def inspect(ctx: Context, node_input: Any):
    """Walk the finished site and either sign it off or send one thing back.

    The route is the interesting part: this node does not call anything. It emits a
    word, and the edges below decide what that word means.

    The count lives in session state, not in a variable up here — two travellers
    building at once share this process, and a counter on the function would have
    them sending each other's doors back.
    """
    built = (node_input or {}).get("built", []) if isinstance(node_input, dict) else []
    reworks = int(ctx.state.get("reworks", 0))

    if reworks < MAX_REWORKS:
        ctx.state["reworks"] = reworks + 1
        yield Event(
            message="the door faces the wind — hang it again",
            actions=EventActions(route="rework"),
        )
    else:
        yield Event(
            message=f"that will stand · {len(built)} parts signed off",
            actions=EventActions(route="pass"),
        )


async def finish(node_input: Any):
    yield Event(message="the yard is closed")


# ── the wire ────────────────────────────────────────────────────────────────
# Read it as one sentence. A comma is "then". A tuple is "at the same time". A dict
# is "whichever way the inspector pointed".
root_agent = Workflow(
    name="yard",
    description="Survey a plot, draw it, build it with three crews at once, inspect it.",
    edges=[
        ("START", survey,

         # 👉 EDIT ONE — chapter 2. Add `blueprint,` on the next line, then save.

         # 👉 EDIT TWO — chapter 3. Add `(roof, door, garden), join, render, inspect,`
         #    on the next line. The brackets are the whole syntax of "at the same time".

         # 👉 EDIT THREE — chapter 4. Add `{"rework": door, "pass": finish},` on the
         #    next line. A dict is "whichever way the inspector pointed".

         ),
    ],
)
