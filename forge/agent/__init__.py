"""The shared runtime, identical in every week of Agent 101.

Only two modules live here and neither is week-specific: `backends.py` (Nano Banana,
the curated style refs, image validation) and `emit.py` (the trace sink the Runtime
Inspector reads). They are byte-identical to the copies in the other weeks' repos on
purpose — week five merges all five, and a file that drifted is a file that has to be
reconciled by hand.

This week's own agent, service and callbacks are in `yard/`.
"""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
