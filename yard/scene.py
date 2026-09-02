"""Drawing a PLACE, not a creature.

Week one's backend has one job and does it well: summon a familiar. Its no-reference
prompt says so out loud — *"create a BRAND-NEW animal spirit familiar … if that is
not an animal, reimagine it as a charming animal familiar"* — so handing it a
cottage gets you a cat with a chimney on its head. Asked for a building site, it
returned a cat's face.

So the yard composes its own prompt and borrows only the part that is genuinely
shared: `_style_refs()`, the four curated pictures that carry the look. That keeps
`forge/agent/backends.py` byte-identical to every other week's copy, which is the
whole reason the five repos can be merged later.

Pinning works the way week one pinned a face, applied to a place: canon is the first
render, the sentence accumulates, and the crew is named every time — because a well
added on a later turn took the badger's corner and the badger stopped existing.
"""

from __future__ import annotations

from forge.agent.backends import _style_refs, api_key, sniff_mime

STYLE = (
    "Cute low-poly art style — faceted geometric shapes with soft flat shading, in the "
    "gentle Monument Valley / Alto's Odyssey aesthetic. Big soft expressive eyes, sweet "
    "friendly faces, warm pastel colours, soft gradient light, plain pastel background, "
    "centred, charming and adorable. No text, no logos."
)

# Not decoration. Pinning holds the building and not the cast, so say they are there.
CREW = (
    "three little animal builders still at work on it — a fox in a hard hat on the roof, "
    "a white rabbit in dungarees at the front door, a badger in a green apron in the garden"
)

MODEL = "gemini-2.5-flash-image"


_CLIENT = None


def _client():
    """Held at module level. A client built per call is garbage-collected mid-flight
    and the next request dies on "the client has been closed"."""
    global _CLIENT
    if _CLIENT is None:
        from google import genai
        key = api_key()
        _CLIENT = genai.Client(api_key=key) if key else genai.Client()
    return _CLIENT


def render_site(built: str, reference_png: bytes | None = None) -> bytes:
    """One picture of the plot as it stands.

    `built` is everything built so far, in one string — the sentence accumulates even
    though the reference does not, exactly like week one's outfit.
    """
    from google.genai import types

    parts: list = []
    if reference_png and sniff_mime(reference_png):
        parts.append(types.Part(inline_data=types.Blob(
            mime_type=sniff_mime(reference_png), data=reference_png)))
        parts.append(
            f"The EXACT same building site as the reference image — identical cottage, "
            f"identical three animal builders in identical poses, identical colours, "
            f"materials and low-poly style — now with {built}. Keep everything else "
            f"unchanged. {STYLE}"
        )
    else:
        for ref in _style_refs():
            mime = sniff_mime(ref)
            if mime:
                parts.append(types.Part(inline_data=types.Blob(mime_type=mime, data=ref)))
        parts.append(
            f"Study the art style of the reference images above — that same adorable cute "
            f"low-poly look, the same big soft eyes, the same pastel palette. Now draw a "
            f"BUILDING SITE in that identical style: a small half-built cottage on a grassy "
            f"plot with {built}, wooden scaffolding and tiny tools on the ground, and {CREW}. "
            f"They are all busy at once. A place, not a portrait. {STYLE}"
        )

    resp = _client().models.generate_content(
        model=MODEL, contents=parts,
        config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]))
    for part in resp.candidates[0].content.parts:
        if getattr(part, "inline_data", None) and part.inline_data.data:
            return part.inline_data.data
    raise RuntimeError("the image model returned no picture")
