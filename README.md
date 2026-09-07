# The Buildyard — Agent 101, week two

**One agent cannot hold a whole job.** Week one asked who says what runs; this week asks
**who decides what runs next** — the graph you drew, the model, or your own code. You give a
familiar a home, and the crew is three animals working at the same time.

▶ **Start here: [Run it](#run-it).** The written codelab is a draft and lives elsewhere;
everything you need to run the thing is in this repo.

**You do not need week one.** The story continues, the lab stands alone.

## Run it

```bash
git clone https://github.com/cuppibla/agent-valley-buildyard
cd agent-valley-buildyard
uv sync
cp .env.example .env
uv run python scripts/preflight.py
```

`.env.example` defaults to **Vertex AI**, so it picks up whatever project `gcloud` is
pointed at — nothing to edit and no key to paste.

**No project to point at?** Two scripts do the whole thing, and they are what the codelab
runs:

```bash
./setup_project.sh    # makes a fresh billing-linked project
./setup_codelab.sh    # enables Vertex AI, uv sync, writes .env, makes one real call
```

`setup_project.sh` makes a new `agent-valley-NNNN` project every time it runs. It does
not reuse whatever is sitting in `~/project_id.txt`: every lab writes to that one file,
so the ID in it is as likely to belong to some other codelab as to week one, and week two
should not drop its resources into a stranger's project.

Already have a project you want week two to use — week one's, or one you made by hand?
Put it in the file and ask for reuse explicitly:

```bash
echo YOUR_PROJECT_ID > ~/project_id.txt
AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh
```

In reuse mode the script takes that project (or scans for an `agent-valley-NNNN` one if
the file is empty), checks billing is still linked, and creates nothing.

`setup_codelab.sh` is safe to re-run. `setup_project.sh` is not, unless you pass
`AGENT_VALLEY_REUSE_PROJECT=1` — a plain re-run makes a second project.

Then two surfaces, each right before you need it:

```bash
uv run adk web .
```

```bash
bash valley.sh
```

The first is the workbench — the graph raw, on `:8000`. The second is the stage — the
agent on `:8100` and the yard on `:3200`.

## What's in here

| | |
|---|---|
| `yard/agent.py` | the workflow you edit — three edits, all one line |
| `yard/` | the service and the callback that pins the plot |
| `site/` | the Buildyard itself (Next.js) |
| `forge/agent/` | the **shared runtime** — identical in every week of the series |
| `domain/style_refs/` | the four pictures every render is conditioned on |

`forge/agent/backends.py` and `emit.py` are byte-identical to the other weeks' copies on
purpose. Week five merges all five repos, and a file that drifted is a file somebody has
to reconcile by hand.

## The series

Each week is its own repo, so each one clones small and stands alone.

| | | |
|---|---|---|
| 01 · Control | The Summoning Grove | [agent-valley-lab](https://github.com/cuppibla/agent-valley-lab) |
| **02 · Decompose** | **The Buildyard** | this repo |
| 03 · Coordinate | Market Street | with the live series |
| 04 · Remember | The Archive | with the live series |
| 05 · Live | The Night Market | with the live series |
