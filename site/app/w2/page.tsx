"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import DialogueBox from "@/components/DialogueBox";
import RuntimeInspector from "@/components/RuntimeInspector";
import CrewRow, { type Crew, type NodeState } from "@/components/CrewRow";
import YardMap, { type Topo } from "@/components/YardMap";
import type { TraceEvent } from "@/lib/contracts";
import { updateSave } from "@/lib/save";

const SUGGESTIONS = [
  "somewhere to read in the afternoon",
  "a den for a rainy week",
  "a workshop with one very tall window",
  "a hut that smells of pine",
];

type Built = { part: string; struck?: boolean };

export default function Buildyard() {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [join, setJoin] = useState<{ have: number; of: number; done: boolean } | null>(null);
  const [plot, setPlot] = useState<string>("");
  const [built, setBuilt] = useState<Built[]>([]);
  const [history, setHistory] = useState<{ src: string; label: string }[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [line, setLine] = useState("Tell me what you want built.");
  const [wall, setWall] = useState<number | undefined>();
  const [work, setWork] = useState<number | undefined>();
  const [graphErr, setGraphErr] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [fanoutNames, setFanoutNames] = useState<string[]>([]);
  const [topo, setTopo] = useState<Topo | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const sid = useRef<string>("");
  // Only the fan-out counts. Summing every node would compare 12s of parallel work
  // against a wall clock that also contains two image renders — a true number that
  // says nothing about parallelism.
  const fanout = useRef<string[]>([]);
  const fanWork = useRef(0);
  const fanStart = useRef(0);
  const fanRan = useRef(0);       // branches in THIS round of the fan-out

  // The crew row is built from the learner's own edges, so it is right before a
  // single build has been run — and wrong the moment they add an edge and reload.
  const loadGraph = useCallback(async () => {
    const r = await fetch("/api/w2/graph").then((x) => x.json()).catch(() => null);
    const g = r?.graph;
    setGraphErr(r?.graph_error ?? (g ? null : "the yard agent isn't running — bash valley.sh"));
    if (g) {
      setCrew(g.nodes.filter((n: string) => n !== "join")
        .map((n: string) => ({ name: n, state: "idle" as NodeState })));
      setFanoutNames(g.fanout ?? []);
      setTopo(g);
    }
  }, []);
  useEffect(() => { loadGraph(); }, [loadGraph]);

  const push = (hook: string, label: string) =>
    setEvents((e) => [...e, {
      hook, type: "state_delta", label, run_id: "w2", span_id: `${e.length}`,
      week: 2, payload: {}, cost: { tokens: 0, usd: 0 },
    } as unknown as TraceEvent]);

  const setNode = (name: string, state: NodeState, extra: Partial<Crew> = {}) =>
    setCrew((c) => c.map((n) => (n.name === name ? { ...n, state, ...extra } : n)));

  async function build(text?: string) {
    const msg = (text ?? request).trim();
    if (busy || !msg) return;
    setBusy(true); setRejected(false); setActiveRoute(null); setLine("Right. Crew!");
    setEvents([]); setJoin(null); setWall(undefined); setWork(undefined);
    setCrew((c) => c.map((n) => ({ ...n, state: "idle", ms: undefined })));

    fanWork.current = 0; fanStart.current = 0; fanRan.current = 0;
    const res = await fetch("/api/w2/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: msg, session_id: sid.current || undefined }),
    });
    const reader = res.body?.getReader();
    if (!reader) { setBusy(false); setLine("The yard agent isn't answering."); return; }

    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() ?? "";
      for (const chunk of lines) {
        if (!chunk.startsWith("data: ")) continue;
        const d = JSON.parse(chunk.slice(6));

        if (d.kind === "graph") {
          setGraphErr(d.graph_error ?? null);
          setCrew(d.graph.nodes.filter((n: string) => n !== "join")
            .map((n: string) => ({ name: n, state: "idle" as NodeState })));
          fanout.current = d.graph.fanout ?? [];
          setFanoutNames(d.graph.fanout ?? []);
          setTopo(d.graph); setActiveRoute(null);
          setJoin({ have: 0, of: d.graph.fanout.length || 1, done: false });
        } else if (d.kind === "node.start") {
          if (fanout.current.includes(d.node)) {
            // A rework re-runs one branch. Rolling it into the round that had three
            // would turn "9.6s of wall clock against 23.7s of work" into a pair of
            // numbers that are true and prove nothing.
            if (!fanStart.current) { fanStart.current = Date.now(); fanWork.current = 0; fanRan.current = 0; }
            fanRan.current += 1;
          }
          setNode(d.node, "live");
          push("node", `${d.node} · running`);
        } else if (d.kind === "node.done") {
          setNode(d.node, "done", { ms: d.ms, text: d.text });
          if (fanout.current.includes(d.node)) {
            fanWork.current += (d.ms ?? 0) / 1000;
            if (fanRan.current > 1) {          // one branch alone says nothing
              setWork(fanWork.current);
              setWall((Date.now() - fanStart.current) / 1000);
            }
          }
          push("node", `${d.node} · done ${(d.ms / 1000).toFixed(1)}s`);
        } else if (d.kind === "join.wait") {
          setJoin({ have: d.have, of: d.of, done: false });
          push("join", `waiting · ${d.have} of ${d.of}`);
        } else if (d.kind === "join.done") {
          setJoin((j) => ({ have: j?.of ?? 3, of: j?.of ?? 3, done: true }));
          fanStart.current = 0;               // the next round starts its own clock
          push("join", `branches joined: ${d.branches.length}`);
        } else if (d.kind === "render") {
          setPlot(d.image);
          const parts = (d.text || "").replace(/^built:\s*/, "").split(";")
            .map((s: string) => s.trim()).filter(Boolean);
          setBuilt(parts.map((p: string) => ({ part: p })));
          setHistory((h) => [...h, { src: d.image, label: `turn ${h.length + 1}` }]);
          push("render", "one image from three descriptions");
        } else if (d.kind === "route") {
          if (d.route === "rework") {
            setRejected(true); setLine(d.why || "hang it again");
            setNode(d.to, "redo");
            // The plot has to go backwards. A rejection that only produces another
            // picture has not taught a loop.
            setBuilt((b) => b.map((x, i) => (i === 1 ? { ...x, struck: true } : x)));
            setHistory((h) => [...h, { src: plot, label: `− ${d.to}` }]);
            setJoin({ have: 0, of: 1, done: false });
          } else {
            setRejected(false); setLine(d.why || "that will stand");
          }
          setActiveRoute(d.route);
          push("route", `${d.from} → ${d.to} · ${d.route}`);
        } else if (d.kind === "error") {
          setLine(d.message); push("error", d.message);
        } else if (d.kind === "done") {
          setLine("That will stand. Sign it off.");
        }
      }
    }
    setBusy(false); setRequest("");
    updateSave({ stamps: [false, true, false, false, false] });
  }

  return (
    <div className="wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        marginBottom: 14, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">02 · DECOMPOSE</div>
          <h1 className="serif" style={{ fontWeight: 500, fontSize: 30, margin: "4px 0 0" }}>
            The Buildyard
          </h1>
        </div>
        {graphErr && (
          <span className="mono" style={{ fontSize: 11, color: "var(--gold-deep)",
            background: "rgba(230,192,105,.18)", padding: "6px 12px", borderRadius: 10 }}>
            showing the shipped graph — your edit didn&apos;t import
          </span>
        )}
      </div>

      <DialogueBox portrait="/world/npc/odo.jpg" speaker="Odo" role="the Yardmaster" text={line} />

      <div className="glass" style={{ padding: "14px 16px", margin: "14px 0" }}>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
          color: "var(--faint)", textTransform: "uppercase" }}>Your request → the yard</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={request} disabled={busy}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") build(); }}
            placeholder="somewhere to read in the afternoon…"
            style={{ flex: 1, padding: "12px 14px", borderRadius: 12, fontSize: 15,
              border: "1px solid var(--gold)", background: "#fffdf6", color: "var(--ink)" }} />
          <button className="rune on" disabled={busy || !request.trim()} onClick={() => build()}
            style={{ opacity: busy || !request.trim() ? .5 : 1 }}>✦ build</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="rune" disabled={busy} onClick={() => setRequest(s)}>{s}</button>
          ))}
        </div>
      </div>

      <YardMap topo={topo} states={Object.fromEntries(crew.map((c) => [c.name, c.state]))}
        activeRoute={activeRoute} />

      <CrewRow crew={crew} join={join} fanout={fanoutNames} wall={wall} work={work} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "stretch" }}>
        <div className="glass" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10 }}>
            <span className="serif" style={{ fontSize: 16 }}>🏡 The plot</span>
            <span className={`pill ${rejected ? "warn" : "gold"}`}>
              {rejected ? "sent back" : built.length ? `${built.length} built` : "empty"}
            </span>
          </div>
          <div style={{ borderRadius: 14, overflow: "hidden", minHeight: 200,
            border: `2px solid ${rejected ? "var(--rose)" : "var(--gold)"}`,
            boxShadow: `0 0 22px ${rejected ? "rgba(229,138,168,.4)" : "rgba(230,192,105,.34)"}`,
            background: "#eef2fb", display: "grid", placeItems: "center" }}>
            {plot ? <img src={plot} alt="the plot" width="100%" style={{ display: "block" }} />
              : <span className="mono" style={{ fontSize: 12.5, color: "var(--faint)", padding: 40 }}>
                  nothing here yet</span>}
          </div>

          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
            color: "var(--faint)", margin: "12px 0 6px", textTransform: "uppercase" }}>
            Built · {built.filter((b) => !b.struck).length}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 26 }}>
            {built.length === 0
              ? <span style={{ fontSize: 12.5, color: "var(--faint)" }}>ask for something ↑</span>
              : built.map((b, i) => (
                <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px",
                  borderRadius: 999, textDecoration: b.struck ? "line-through" : "none",
                  background: b.struck ? "rgba(229,138,168,.14)" : "rgba(111,199,173,.16)",
                  color: b.struck ? "#b03e64" : "#2f7d67",
                  border: `1px solid ${b.struck ? "rgba(229,138,168,.45)" : "rgba(111,199,173,.4)"}` }}>
                  {b.part}
                </span>
              ))}
          </div>

          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
            color: "var(--faint)", margin: "12px 0 6px", textTransform: "uppercase" }}>
            Session · {history.length}
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {history.map((h, i) => (
              <div key={i} style={{ flexShrink: 0, width: 74 }}>
                {h.src && <img src={h.src} alt={h.label} width={74} height={74}
                  style={{ borderRadius: 10, objectFit: "cover", display: "block",
                    border: "1px solid var(--line)" }} />}
                <div style={{ fontSize: 9.5, textAlign: "center", marginTop: 3,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  color: h.label.startsWith("−") ? "var(--rose)" : "var(--mint)" }}>{h.label}</div>
              </div>
            ))}
          </div>
        </div>

        <RuntimeInspector events={events} />
      </div>
    </div>
  );
}
