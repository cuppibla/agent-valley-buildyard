"use client";

/** The graph, cast instead of drawn.
 *
 * Every node is a card with a state; the join is a card that says how many branches
 * it is still waiting for. Nothing is animated character art and nothing needs to
 * be: three cards live at once IS the fan-out, and `waiting · 2 of 3` is the whole
 * of what a join has to say.
 *
 * The nodes that are PEOPLE get a face; the nodes that are steps get a glyph. That
 * is not decoration — the faces are exactly the group that runs together, so the
 * fan-out reads before anyone has looked at a status line.
 *
 * The cards come from the learner's own edges — whatever /graph returned.
 */

export type NodeState = "idle" | "live" | "done" | "redo";
export type Crew = { name: string; state: NodeState; ms?: number; text?: string };

const FACE: Record<string, string> = {
  survey: "/world/npc/odo.jpg",
  blueprint: "/world/npc/odo.jpg",
  roof: "/world/npc/crew-roof.jpg",
  door: "/world/npc/crew-door.jpg",
  garden: "/world/npc/crew-garden.jpg",
  inspect: "/world/npc/twill.jpg",
  render: "/world/npc/maren.jpg",
  finish: "/world/npc/vesper.jpg",
};
const GLYPH: Record<string, string> = { join: "⏳" };

export default function CrewRow(
  { crew, join, fanout = [], wall, work }:
  { crew: Crew[]; join: { have: number; of: number; done: boolean } | null;
    fanout?: string[]; wall?: number; work?: number },
) {
  const live = crew.filter((c) => c.state === "live").length;
  const inFan = (n: string) => fanout.includes(n);
  const before = crew.filter((c) => !inFan(c.name) && idx(crew, c.name) < firstFan(crew, fanout));
  const fan = fanout.map((n) => crew.find((c) => c.name === n)).filter(Boolean) as Crew[];
  const after = crew.filter((c) => !inFan(c.name) && idx(crew, c.name) > firstFan(crew, fanout));

  return (
    <div className="glass" style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
        color: "var(--faint)", textTransform: "uppercase" }}>The yard</div>

      <div style={{ display: "flex", gap: 9, marginTop: 9, alignItems: "stretch",
        flexWrap: "wrap" }}>
        {before.map((c) => <Card key={c.name} c={c} />)}

        {fan.length > 0 && (
          // The one group that must never wrap. Three crews stacked into two rows
          // stop looking simultaneous, which is the only thing this row is for.
          <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", flex: "1 1 460px",
            minWidth: 430, overflowX: "auto", padding: "7px 9px", borderRadius: 15,
            border: "1px dashed var(--line-strong)", background: "rgba(138,107,255,.05)" }}>
            {fan.map((c) => <Card key={c.name} c={c} grow />)}
          </div>
        )}

        {join && (
          <div style={{ ...box, borderStyle: "dashed", minWidth: 132,
            borderColor: join.done ? "rgba(230,192,105,.75)" : "var(--line)",
            background: join.done ? "rgba(230,192,105,.14)" : "rgba(255,255,255,.5)",
            opacity: join.have || join.done ? 1 : .5 }}>
            <div style={nameRow}><span style={glyphBox}>⏳</span>Join</div>
            <div className="mono" style={{ ...status,
              color: join.done ? "var(--gold-deep)" : "var(--faint)" }}>
              {join.done ? "branches joined" : `waiting · ${join.have} of ${join.of}`}
            </div>
            <div style={bar}><i style={{ ...fill,
              width: join.done ? "100%" : `${(join.have / Math.max(join.of, 1)) * 100}%`,
              background: join.done ? "var(--gold)" : "var(--violet-soft)" }} /></div>
          </div>
        )}

        {after.map((c) => <Card key={c.name} c={c} />)}
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

const idx = (crew: Crew[], n: string) => crew.findIndex((c) => c.name === n);
const firstFan = (crew: Crew[], fanout: string[]) => {
  const positions = fanout.map((n) => idx(crew, n)).filter((i) => i >= 0);
  return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
};

function Card({ c, grow }: { c: Crew; grow?: boolean }) {
  const tone = c.state === "done" ? { b: "rgba(111,199,173,.55)", bg: "rgba(111,199,173,.11)", t: "#2f7d67" }
    : c.state === "redo" ? { b: "rgba(229,138,168,.6)", bg: "rgba(229,138,168,.1)", t: "#b03e64" }
    : c.state === "live" ? { b: "var(--line-strong)", bg: "rgba(255,255,255,.88)", t: "var(--violet)" }
    : { b: "var(--line)", bg: "rgba(255,255,255,.55)", t: "var(--faint)" };
  const label = c.state === "done" ? (c.ms ? `${(c.ms / 1000).toFixed(1)}s` : "done")
    : c.state === "redo" ? "again" : c.state === "live" ? "working…" : "—";
  const face = FACE[c.name];
  return (
    <div style={{ ...box, borderColor: tone.b, background: tone.bg,
      flex: grow ? "1 1 0" : "0 1 auto", minWidth: grow ? 0 : 128,
      opacity: c.state === "idle" ? .55 : 1,
      boxShadow: c.state === "live" ? "0 4px 14px rgba(138,107,255,.16)" : undefined }}
      title={c.text || ""}>
      <div style={nameRow}>
        {face
          ? <img src={face} alt="" width={30} height={30} style={{ borderRadius: 9,
              display: "block", flexShrink: 0, objectFit: "cover",
              filter: c.state === "idle" ? "saturate(.55)" : "none",
              boxShadow: c.state === "live" ? "0 0 8px rgba(138,107,255,.45)" : "none" }} />
          : <span style={glyphBox}>{GLYPH[c.name] ?? "•"}</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
      </div>
      <div className="mono" style={{ ...status, color: tone.t }}>{label}</div>
      <div style={bar}><i style={{ ...fill,
        width: c.state === "done" || c.state === "redo" ? "100%" : c.state === "live" ? "62%" : "0",
        background: c.state === "done" ? "var(--mint)"
          : c.state === "redo" ? "var(--rose)" : "var(--violet-soft)" }} /></div>
    </div>
  );
}

const box: React.CSSProperties = {
  borderRadius: 13, border: "1px solid var(--line)", padding: "9px 11px",
  display: "flex", flexDirection: "column", gap: 7, transition: "all .2s ease",
};
const nameRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8,
  fontWeight: 600, fontSize: 13.5, textTransform: "capitalize", whiteSpace: "nowrap" };
const glyphBox: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, display: "grid",
  placeItems: "center", fontSize: 14, background: "rgba(176,143,224,.18)", flexShrink: 0 };
const status: React.CSSProperties = { fontSize: 10.5, letterSpacing: ".04em" };
const bar: React.CSSProperties = { height: 3, borderRadius: 2, overflow: "hidden",
  background: "rgba(176,143,224,.2)" };
const fill: React.CSSProperties = { display: "block", height: "100%", borderRadius: 2,
  transition: "width .45s ease" };
