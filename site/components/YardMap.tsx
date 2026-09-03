"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/** The graph and the yard, which turned out to be the same thing.
 *
 * Each node is a card ON the graph: a face, a name, what it is doing, how long it
 * took. Laid out from the topology the agent reported, so this is the learner's own
 * graph — add an edge and a card appears.
 *
 * The faces travel. A node's avatar flies in from the node it came FROM and settles
 * into its seat, so during the fan-out three of them cross the picture at once and
 * none reaches `render` until the join has all three. That is the lesson, and it
 * needs no caption.
 */

export type NodeState = "idle" | "live" | "done" | "redo";
export type Topo = { nodes: string[]; edges: { from: string; to: string; route: string | null }[];
  fanout: string[] };
type Join = { have: number; of: number; done: boolean } | null;

const AVATAR: Record<string, string> = {
  survey: "/world/npc/odo.jpg",
  blueprint: "/world/npc/odo.jpg",
  // The same three faces the plan signs its rows with — the reader meets a crew
  // member on the graph and then reads what they decided, and it has to be the same
  // animal. These keys were `roof`/`door`/`garden` until the branches were reshaped
  // into ground/stock/weather, after which all three quietly fell back to Odo.
  ground: "/world/npc/crew-door.jpg",    // the rabbit digs
  stock: "/world/npc/crew-roof.jpg",     // the fox in the hard hat goes to the store
  weather: "/world/npc/crew-garden.jpg", // the badger reads the seasons
  // Week one's forgekeeper draws the picture here too, and Vesper signs it off.
  render: "/world/npc/maren.jpg",
  inspect: "/world/npc/twill.jpg",
  finish: "/world/npc/vesper.jpg",
};

const W = 134, H = 56, R = 15;
const GAP_X = 162, GAP_Y = 74, PAD = 26, TOP = 8;

export default function YardMap(
  { topo, states, times, join, activeRoute, wall, work }:
  { topo: Topo | null; states: Record<string, NodeState>; times: Record<string, number>;
    join: Join; activeRoute?: string | null; wall?: number; work?: number },
) {
  const layout = useMemo(() => (topo ? rank(topo) : null), [topo]);
  const [runners, setRunners] = useState<{ key: string; x: number; y: number }[]>([]);
  const settled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!layout) return;
    const reached = Object.entries(states).filter(([, s]) => s !== "idle").map(([n]) => n);
    setRunners((prev) => reached.flatMap((n) => {
      const at = layout.slot[n];
      if (!at) return [];
      if (prev.some((r) => r.key === n) || settled.current.has(n)) return [{ key: n, ...at }];
      // __START__ has no card, and the way-back edge makes `inspect` a parent of
      // `door`: come from the first parent that is actually on screen.
      const from = (layout.parents[n] ?? []).find((p) => layout.slot[p]);
      return [{ key: n, ...(from ? layout.slot[from] : at) }];
    }));
    const id = requestAnimationFrame(() => {
      reached.forEach((n) => settled.current.add(n));
      setRunners((prev) => prev.map((r) => (layout.slot[r.key] ? { ...r, ...layout.slot[r.key] } : r)));
    });
    return () => cancelAnimationFrame(id);
  }, [states, layout]);

  useEffect(() => {
    if (!Object.values(states).some((s) => s !== "idle")) settled.current.clear();
  }, [states]);

  if (!layout) return null;
  const { pos, width, height } = layout;
  const live = Object.values(states).filter((s) => s === "live").length;

  return (
    <div className="glass" style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
        color: "var(--faint)", textTransform: "uppercase", marginBottom: 4 }}>The yard</div>

      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%"
          style={{ minWidth: Math.min(width, 700), display: "block" }}
          role="img" aria-label="the workflow, lighting up as it runs">
          <defs>
            <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5"
              orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="currentColor" /></marker>
            {Object.keys(AVATAR).map((n) => (
              <clipPath key={n} id={`c-${n}`}><circle cx={R} cy={R} r={R} /></clipPath>
            ))}
          </defs>

          {topo!.edges.filter((e) => pos[e.from] && pos[e.to]).map((e, i) => {
            const back = pos[e.to].x <= pos[e.from].x;
            const hot = e.route ? e.route === activeRoute
              : states[e.from] === "done" && (states[e.to] ?? "idle") !== "idle";
            const c = e.route === "rework" ? "var(--rose)"
              : hot ? "var(--violet)" : "var(--line-strong)";
            return (
              <path key={i} d={edgePath(pos[e.from], pos[e.to], back)} fill="none" stroke={c}
                strokeWidth={hot ? 2.2 : 1.3} strokeDasharray={e.route ? "5 4" : undefined}
                opacity={hot ? 1 : .4} markerEnd="url(#tip)" color={c}
                style={{ transition: "stroke .3s, opacity .3s, stroke-width .3s" }} />
            );
          })}

          {topo!.nodes.filter((n) => pos[n]).map((n) => (
            <Card key={n} n={n} at={pos[n]} state={states[n] ?? "idle"} ms={times[n]}
              join={n === "join" ? join : null} />
          ))}

          {runners.map((r) => (
            <g key={r.key} transform={`translate(${r.x},${r.y})`}
              style={{ transition: "transform .7s cubic-bezier(.34,1.3,.5,1)" }}>
              <image href={AVATAR[r.key] ?? "/world/npc/odo.jpg"} width={R * 2} height={R * 2}
                clipPath={`url(#c-${r.key})`} />
              <circle cx={R} cy={R} r={R} fill="none" strokeWidth="2"
                stroke={states[r.key] === "live" ? "var(--violet)"
                  : states[r.key] === "redo" ? "var(--rose)" : "rgba(111,199,173,.9)"}
                style={{ transition: "stroke .3s" }} />
              {states[r.key] === "live" && (
                <animateTransform attributeName="transform" type="translate" additive="sum"
                  values="0 0; 0 -3.5; 0 0" dur="0.7s" repeatCount="indefinite" />
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="mono" style={{ marginTop: 8, paddingTop: 9, fontSize: 11,
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

function Card({ n, at, state, ms, join }:
  { n: string; at: { x: number; y: number }; state: NodeState; ms?: number; join: Join }) {
  const tone = state === "done"
      ? { b: "rgba(111,199,173,.8)", f: "rgba(111,199,173,.13)", t: "#2f7d67", bar: "var(--mint)" }
    : state === "redo"
      ? { b: "var(--rose)", f: "rgba(229,138,168,.12)", t: "#b03e64", bar: "var(--rose)" }
    : state === "live"
      ? { b: "var(--violet)", f: "rgba(255,255,255,.95)", t: "var(--violet)", bar: "var(--violet-soft)" }
      : { b: "var(--line)", f: "rgba(255,255,255,.5)", t: "var(--faint)", bar: "var(--violet-soft)" };

  const label = join
    ? (join.done ? "branches joined" : `waiting · ${join.have} of ${join.of}`)
    : state === "done" ? (ms ? `${(ms / 1000).toFixed(1)}s` : "done")
    : state === "redo" ? "again" : state === "live" ? "working…" : "—";
  const pct = join ? (join.done ? 100 : (join.have / Math.max(join.of, 1)) * 100)
    : state === "done" || state === "redo" ? 100 : state === "live" ? 62 : 0;
  const gold = !!join?.done;
  const dim = state === "idle" && !join?.have && !gold;

  return (
    <g transform={`translate(${at.x - W / 2},${at.y - H / 2})`} opacity={dim ? .6 : 1}
      style={{ transition: "opacity .3s" }}>
      <rect width={W} height={H} rx={13} fill={gold ? "rgba(230,192,105,.15)" : tone.f}
        stroke={gold ? "rgba(230,192,105,.8)" : tone.b} strokeWidth={state === "live" ? 2.2 : 1.2}
        strokeDasharray={join ? "5 4" : undefined}
        style={{ transition: "fill .3s, stroke .3s, stroke-width .3s" }} />
      {/* the avatar's seat — the face itself is drawn in the runner layer above */}
      <circle cx={12 + R} cy={H / 2 - 4} r={R} fill="rgba(176,143,224,.16)" />
      {join && <text x={12 + R} y={H / 2 + 1} textAnchor="middle" fontSize="15">⏳</text>}
      <text x={12 + R * 2 + 10} y={H / 2 - 5} fontSize="12.5" fontWeight="600" fill="var(--ink)"
        fontFamily="var(--font-body), sans-serif"
        style={{ textTransform: "capitalize" }}>{n}</text>
      <text x={12 + R * 2 + 10} y={H / 2 + 10} fontSize="9.5"
        fill={gold ? "var(--gold-deep)" : tone.t} fontFamily="var(--font-mono), monospace"
        style={{ transition: "fill .3s" }}>{label}</text>
      <rect x={12} y={H - 11} width={W - 24} height={3} rx={1.5} fill="rgba(176,143,224,.2)" />
      <rect x={12} y={H - 11} width={(W - 24) * pct / 100} height={3} rx={1.5}
        fill={gold ? "var(--gold)" : tone.bar} style={{ transition: "width .45s ease" }} />
    </g>
  );
}

/** Longest-path ranking, ignoring back edges so a loop cannot push a node rightwards. */
function rank(topo: Topo) {
  const fwd = topo.edges.filter((e) => !e.route || e.route !== "rework");
  const parents: Record<string, string[]> = {};
  topo.edges.forEach((e) => { (parents[e.to] ||= []).push(e.from); });

  const r: Record<string, number> = {};
  topo.nodes.forEach((n) => { r[n] = 0; });
  for (let pass = 0; pass < topo.nodes.length; pass++) {
    fwd.forEach((e) => {
      if (r[e.to] !== undefined && r[e.from] !== undefined && r[e.to] < r[e.from] + 1) {
        r[e.to] = r[e.from] + 1;
      }
    });
  }
  const cols: Record<number, string[]> = {};
  topo.nodes.forEach((n) => { (cols[r[n]] ||= []).push(n); });

  const tallest = Math.max(...Object.values(cols).map((c) => c.length));
  const lastCol = Math.max(...Object.keys(cols).map(Number));
  const height = TOP + PAD * 2 + (tallest - 1) * GAP_Y + H + 26;
  const width = PAD * 2 + lastCol * GAP_X + W;

  const pos: Record<string, { x: number; y: number }> = {};
  const slot: Record<string, { x: number; y: number }> = {};
  Object.entries(cols).forEach(([col, names]) => {
    names.forEach((n, i) => {
      const x = PAD + Number(col) * GAP_X + W / 2;
      const y = TOP + PAD + (i - (names.length - 1) / 2) * GAP_Y + (tallest - 1) * GAP_Y / 2 + H / 2;
      pos[n] = { x, y };
      slot[n] = { x: x - W / 2 + 12, y: y - 4 - R };      // where the face sits
    });
  });
  return { pos, slot, parents, width, height };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, back: boolean) {
  if (back) {
    const lift = 40;
    return `M ${a.x} ${a.y + H / 2} C ${a.x} ${a.y + H / 2 + lift}, ${b.x} ${b.y + H / 2 + lift}, ${b.x} ${b.y + H / 2}`;
  }
  const ax = a.x + W / 2, bx = b.x - W / 2, mid = (ax + bx) / 2;
  return `M ${ax} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${bx} ${b.y}`;
}
