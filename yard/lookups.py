"""The three records the yard consults, and the sites they describe.

Fixtures, not a database — the same honesty as week one's `FakeImageBackend`. What
matters for the lab is that they are **three different records**, so the three
branches genuinely cannot be collapsed into one model call: no single prompt is
simultaneously a soil calculation, an inventory query and a climate judgement.

Everything is keyed by SITE. That is the part the first draft of this chapter got
wrong: with fixed tables every build found the same things and every cottage came
out identical, which quietly unmakes the claim that the design has reasons.
`survey` picks the site; these three read it.
"""

from __future__ import annotations

SITES: dict[str, dict] = {
    "wet-meadow": {
        "name": "the low wet meadow",
        "ground": {"soil": "clay", "drainage": "poor", "bearing_t_m2": 1.4,
                   "water_table_m": 0.6},
        "store": {"timber": "cedar", "lengths": 40, "stone": "none nearby"},
        "climate": {"snow_m": 0.1, "rain_mm": 1100, "wind": "west", "sun": "open"},
    },
    "pine-ridge": {
        "name": "the rocky pine ridge",
        "ground": {"soil": "rock shelf", "drainage": "fast", "bearing_t_m2": 4.0,
                   "water_table_m": 9.0},
        "store": {"timber": "pine", "lengths": 120, "stone": "on site"},
        "climate": {"snow_m": 1.2, "rain_mm": 700, "wind": "north", "sun": "exposed"},
    },
    "birch-hollow": {
        "name": "the sheltered birch hollow",
        "ground": {"soil": "loam", "drainage": "fair", "bearing_t_m2": 2.5,
                   "water_table_m": 2.4},
        "store": {"timber": "birch", "lengths": 25, "stone": "a small pile"},
        "climate": {"snow_m": 0.4, "rain_mm": 850, "wind": "still", "sun": "dappled"},
    },
    "south-terrace": {
        "name": "the dry south terrace",
        "ground": {"soil": "sandy gravel", "drainage": "fast", "bearing_t_m2": 3.0,
                   "water_table_m": 6.0},
        "store": {"timber": "oak", "lengths": 18, "stone": "on site"},
        "climate": {"snow_m": 0.0, "rain_mm": 400, "wind": "still", "sun": "full, hot"},
    },
}

DEFAULT = "birch-hollow"


def site_names() -> dict[str, str]:
    return {k: v["name"] for k, v in SITES.items()}


def _site(site_id: str) -> dict:
    return SITES.get((site_id or "").strip().lower(), SITES[DEFAULT])


# ── the three records ───────────────────────────────────────────────────────
# Deliberately three different SHAPES as well as three different tables: one is
# numbers you compute with, one is an inventory you have to choose from, one is
# conditions you have to weigh. That is why three branches, and not three prompts.

def ground_record(site_id: str) -> dict:
    return _site(site_id)["ground"]


def store_record(site_id: str) -> dict:
    return _site(site_id)["store"]


def climate_record(site_id: str) -> dict:
    return _site(site_id)["climate"]
