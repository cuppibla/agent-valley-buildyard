"use client";

/** The graph, cast instead of drawn.
 *
 * Every node is a crew card with a state; the join is a card that says how many
 * branches it is still waiting for. Nothing here is animated character art and
 * nothing needs to be: three cards live at once IS the fan-out, and
 * `waiting · 2 of 3` is the most informative thing that can be put on a screen
 * about a join.
 *
 * The cards come from the learner's own edges — whatever /graph returned — so an
 * edge added in yard/agent.py shows up here.
 */

export type NodeState = "idle" | "live" | "done" | "redo";
export type Crew = { name: string; state: NodeState; ms?: number; text?: string };

const FACE: Record<string, string> = {
  survey: "📐", blueprint: "📜", roof: "🛖", door: "🚪", garden: "🌿",
  render: "🎨", inspect: "🔍", finish: "✅", join: "⏳",
};

export default function CrewRow(
  { crew, join, wall, work }:
  { crew: Crew[]; join: { have: number; of: number; done: boolean } | null;
    wall?: number; work?: number },
) {
  const live = crew.filter((c) => c.state === "live").length;
  return (
    <div className="glass" style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
        color: "var(--faint)", textTransform: "uppercase" }}>The yard</div>

      <div style={{ display: "grid", gap: 9, marginTop: 9,
        gridTemplateColumns: "repeat(auto-fit,minmax(146px,1fr))" }}>
        {crew.map((c) => <Card key={c.name} c={c} />)}
        {join && (
          <div style={{ ...box(join.done ? "done" : "live"), borderStyle: "dashed",
            borderColor: join.done ? "rgba(230,192,105,.75)" : "var(--line)",
            background: join.done ? "rgba(230,192,105,.14)" : "rgba(255,255,255,.5)",
            opacity: join.have || join.done ? 1 : .5 }}>
            <div style={nameRow}><span style={ico}>⏳</span>Join</div>
            <div className="mono" style={{ ...status,
              color: join.done ? "var(--gold-deep)" : "var(--faint)" }}>
              {join.done ? "branches joined" : `waiting · ${join.have} of ${join.of}`}
            </div>
            <div style={bar}><i style={{ ...fill,
              width: join.done ? "100%" : `${(join.have / Math.max(join.of, 1)) * 100}%`,
              background: join.done ? "var(--gold)" : "var(--violet-soft)" }} /></div>
          </div>
        )}
      </div>

      <div className="mono" style={{ marginTop: 10, paddingTop: 9, fontSize: 11,
        borderTop: "1px solid var(--line)", color: "var(--sub)", display: "flex",
        gap: 16, flexWrap: "wrap" }}>
        <span>running now · <b style={{ color: "var(--ink)" }}>{live}</b></span>
        {wall != null && work != null && work > wall && (
          <span>the three crews · <b style={{ color: "var(--ink)" }}>{wall.toFixed(1)}s</b> on the
            wall clock, <b style={{ color: "var(--ink)" }}>{work.toFixed(1)}s</b> of work</span>
        )}
      </div>
    </div>
  );
}

function Card({ c }: { c: Crew }) {
  const tone = c.state === "done" ? { b: "rgba(111,199,173,.55)", bg: "rgba(111,199,173,.11)", t: "#2f7d67" }
    : c.state === "redo" ? { b: "rgba(229,138,168,.6)", bg: "rgba(229,138,168,.1)", t: "#b03e64" }
    : c.state === "live" ? { b: "var(--line-strong)", bg: "rgba(255,255,255,.85)", t: "var(--violet)" }
    : { b: "var(--line)", bg: "rgba(255,255,255,.55)", t: "var(--faint)" };
  const label = c.state === "done" ? (c.ms ? `${(c.ms / 1000).toFixed(1)}s` : "done")
    : c.state === "redo" ? "again" : c.state === "live" ? "working…" : "—";
  return (
    <div style={{ ...box(c.state), borderColor: tone.b, background: tone.bg,
      opacity: c.state === "idle" ? .5 : 1 }} title={c.text || ""}>
      <div style={nameRow}><span style={ico}>{FACE[c.name] ?? "•"}</span>{c.name}</div>
      <div className="mono" style={{ ...status, color: tone.t }}>{label}</div>
      <div style={bar}><i style={{ ...fill,
        width: c.state === "done" || c.state === "redo" ? "100%" : c.state === "live" ? "62%" : "0",
        background: c.state === "done" ? "var(--mint)"
          : c.state === "redo" ? "var(--rose)" : "var(--violet-soft)" }} /></div>
    </div>
  );
}

const box = (_s: NodeState): React.CSSProperties => ({
  borderRadius: 13, border: "1px solid var(--line)", padding: "10px 11px",
  display: "flex", flexDirection: "column", gap: 7, transition: "all .2s ease",
});
const nameRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7,
  fontWeight: 600, fontSize: 13.5, textTransform: "capitalize" };
const ico: React.CSSProperties = { width: 24, height: 24, borderRadius: 7, display: "grid",
  placeItems: "center", fontSize: 13, background: "rgba(176,143,224,.18)" };
const status: React.CSSProperties = { fontSize: 10.5, letterSpacing: ".04em" };
const bar: React.CSSProperties = { height: 3, borderRadius: 2, overflow: "hidden",
  background: "rgba(176,143,224,.2)" };
const fill: React.CSSProperties = { display: "block", height: "100%", borderRadius: 2,
  transition: "width .45s ease" };
