"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeState } from "@/components/CrewRow";

/** The graph, drawn — and someone running along it.
 *
 * Laid out from the topology the agent reported, so this is the learner's own
 * graph: add an edge and a box appears here.
 *
 * The runners are the point. During the fan-out there are three of them moving at
 * once, on three different edges, and none of them reaches `render` until the join
 * has all three. Nothing else on the screen says "at the same time" as plainly as
 * three animals crossing the picture together.
 */

export type Topo = { nodes: string[]; edges: { from: string; to: string; route: string | null }[];
  fanout: string[] };

const AVATAR: Record<string, string> = {
  survey: "/world/npc/odo.jpg",
  blueprint: "/world/npc/odo.jpg",
  roof: "/world/npc/crew-roof.jpg",
  door: "/world/npc/crew-door.jpg",
  garden: "/world/npc/crew-garden.jpg",
  inspect: "/world/npc/twill.jpg",
  // Week one's forgekeeper draws the picture here too, and Vesper signs it off.
  render: "/world/npc/maren.jpg",
  finish: "/world/npc/vesper.jpg",
};

const W = 96, H = 40, GAP_X = 132, GAP_Y = 58, PAD = 30;

export default function YardMap(
  { topo, states, activeRoute }:
  { topo: Topo | null; states: Record<string, NodeState>; activeRoute?: string | null },
) {
  const layout = useMemo(() => (topo ? rank(topo) : null), [topo]);
  const [runners, setRunners] = useState<{ key: string; x: number; y: number }[]>([]);
  const settled = useRef<Set<string>>(new Set());

  // A runner is spawned at the node it came FROM and then moved, so the browser has
  // something to animate between. Spawning it at its destination would just blink.
  useEffect(() => {
    if (!layout) return;
    const live = Object.entries(states).filter(([, s]) => s === "live").map(([n]) => n);
    setRunners((prev) => live.flatMap((n) => {
      // A node can be live for one frame after the graph changed under it — the
      // previous build's states arriving against the new layout.
      const at = layout.pos[n];
      if (!at) return [];
      const existing = prev.find((r) => r.key === n);
      if (existing) return [{ ...existing, x: at.x, y: at.y }];
      if (settled.current.has(n)) return [{ key: n, x: at.x, y: at.y }];
      // __START__ has no box, and a back edge makes `inspect` a parent of `door`.
      // Take the first parent that is actually on screen; fall back to standing still.
      const from = (layout.parents[n] ?? []).find((p) => layout.pos[p]);
      const start = from ? layout.pos[from] : at;
      return [{ key: n, x: start.x, y: start.y }];
    }));
    const id = requestAnimationFrame(() => {
      live.forEach((n) => settled.current.add(n));
      setRunners((prev) => prev.map((r) => (layout.pos[r.key] ? { ...r, ...layout.pos[r.key] } : r)));
    });
    return () => cancelAnimationFrame(id);
  }, [states, layout]);

  useEffect(() => { if (!Object.values(states).some((s) => s === "live")) settled.current.clear(); },
    [states]);

  if (!layout) return null;
  const { pos, width, height } = layout;

  return (
    <div className="glass" style={{ padding: "14px 16px", marginBottom: 14, overflowX: "auto" }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
        color: "var(--faint)", textTransform: "uppercase", marginBottom: 6 }}>Your graph</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%"
        style={{ minWidth: Math.min(width, 760), display: "block", overflow: "visible" }}
        role="img" aria-label="the workflow, lighting up as it runs">
        <defs>
          <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6"
            orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="currentColor" /></marker>
          {Object.keys(AVATAR).map((n) => (
            <clipPath key={n} id={`clip-${n}`}><circle cx="15" cy="15" r="15" /></clipPath>
          ))}
        </defs>

        {topo!.edges.filter((e) => pos[e.from] && pos[e.to]).map((e, i) => {
          const back = pos[e.to].x <= pos[e.from].x;
          const hot = e.route ? e.route === activeRoute
            : states[e.from] === "done" && states[e.to] !== "idle";
          const c = e.route === "rework" ? "var(--rose)" : hot ? "var(--violet)" : "var(--line-strong)";
          return (
            <path key={i} d={edgePath(pos[e.from], pos[e.to], back)} fill="none" stroke={c}
              strokeWidth={hot ? 2.2 : 1.3} strokeDasharray={e.route ? "5 4" : undefined}
              opacity={hot ? 1 : .45} markerEnd="url(#tip)" color={c}
              style={{ transition: "stroke .3s, opacity .3s, stroke-width .3s" }} />
          );
        })}

        {topo!.nodes.filter((n) => pos[n]).map((n) => {
          const s = states[n] ?? "idle";
          const tone = s === "done" ? { b: "rgba(111,199,173,.85)", f: "rgba(111,199,173,.16)" }
            : s === "redo" ? { b: "var(--rose)", f: "rgba(229,138,168,.14)" }
            : s === "live" ? { b: "var(--violet)", f: "rgba(255,255,255,.95)" }
            : { b: "var(--line)", f: "rgba(255,255,255,.55)" };
          return (
            <g key={n} transform={`translate(${pos[n].x - W / 2},${pos[n].y - H / 2})`}
              opacity={s === "idle" ? .55 : 1} style={{ transition: "opacity .3s" }}>
              <rect width={W} height={H} rx={11} fill={tone.f} stroke={tone.b}
                strokeWidth={s === "live" ? 2.2 : 1.2}
                style={{ transition: "fill .3s, stroke .3s, stroke-width .3s" }} />
              <text x={W / 2} y={H / 2 + 4.5} textAnchor="middle" fontSize="12.5" fontWeight="600"
                fill="var(--ink)" fontFamily="var(--font-body), sans-serif">{n}</text>
            </g>
          );
        })}

        {runners.map((r) => (
          <g key={r.key} transform={`translate(${r.x - 15},${r.y - H / 2 - 34})`}
            style={{ transition: "transform .65s cubic-bezier(.4,1.4,.5,1)" }}>
            {AVATAR[r.key]
              ? <image href={AVATAR[r.key]} width="30" height="30" clipPath={`url(#clip-${r.key})`} />
              : <circle cx="15" cy="15" r="13" fill="var(--violet-soft)" />}
            <circle cx="15" cy="15" r="15" fill="none" stroke="var(--violet)" strokeWidth="2" />
            <animateTransform attributeName="transform" type="translate" additive="sum"
              values="0 0; 0 -4; 0 0" dur="0.7s" repeatCount="indefinite" />
          </g>
        ))}
      </svg>
    </div>
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
  const height = PAD * 2 + (tallest - 1) * GAP_Y + H + 34;
  const width = PAD * 2 + Math.max(...Object.keys(cols).map(Number)) * GAP_X + W;

  const pos: Record<string, { x: number; y: number }> = {};
  Object.entries(cols).forEach(([col, names]) => {
    names.forEach((n, i) => {
      pos[n] = {
        x: PAD + Number(col) * GAP_X + W / 2,
        y: PAD + 34 + (i - (names.length - 1) / 2) * GAP_Y + (tallest - 1) * GAP_Y / 2 + H / 2,
      };
    });
  });
  return { pos, parents, width, height };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, back: boolean) {
  if (back) {
    const lift = 46;
    return `M ${a.x} ${a.y + H / 2} C ${a.x} ${a.y + H / 2 + lift}, ${b.x} ${b.y + H / 2 + lift}, ${b.x} ${b.y + H / 2}`;
  }
  const ax = a.x + W / 2, bx = b.x - W / 2, mid = (ax + bx) / 2;
  return `M ${ax} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${bx} ${b.y}`;
}
