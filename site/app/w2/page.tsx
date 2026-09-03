"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import DialogueBox from "@/components/DialogueBox";
import RuntimeInspector from "@/components/RuntimeInspector";
import YardMap, { type NodeState, type Topo } from "@/components/YardMap";
import type { TraceEvent } from "@/lib/contracts";
import { updateSave } from "@/lib/save";

const ORDER = ["ground", "stock", "weather"];
const FACE: Record<string,string> = {
  ground: "/world/npc/crew-door.jpg",   // the rabbit digs
  stock:  "/world/npc/crew-roof.jpg",   // the fox in the hard hat goes to the store
  weather:"/world/npc/crew-garden.jpg", // the badger reads the seasons
};

const SUGGESTIONS = [
  "somewhere to read in the afternoon",
  "a den for a rainy week",
  "a workshop with one very tall window",
  "a hut that smells of pine",
];

type Crew = { name: string; state: NodeState; ms?: number; text?: string };
type Row = { branch: string; found: string; decided: string; stale?: boolean };

export default function Buildyard() {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [join, setJoin] = useState<{ have: number; of: number; done: boolean } | null>(null);
  const [plot, setPlot] = useState<string>("");
  const [plan, setPlan] = useState<Row[]>([]);
  const [sites, setSites] = useState<Record<string, string>>({});
  const [site, setSite] = useState<string>("");
  const lastReq = useRef<string>("");
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
  const fanDone = useRef(0);      // …and how many of them are home

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
  useEffect(() => {
    fetch("/api/w2/sites").then((r) => r.json())
      .then((d) => setSites(d.sites ?? {})).catch(() => {});
  }, []);

  const push = (hook: string, label: string) =>
    setEvents((e) => [...e, {
      hook, type: "state_delta", label, run_id: "w2", span_id: `${e.length}`,
      week: 2, payload: {}, cost: { tokens: 0, usd: 0 },
    } as unknown as TraceEvent]);

  const setNode = (name: string, state: NodeState, extra: Partial<Crew> = {}) =>
    setCrew((c) => c.map((n) => (n.name === name ? { ...n, state, ...extra } : n)));

  async function build(text?: string, forceSite?: string) {
    const msg = (text ?? request).trim();
    if (busy || !msg) return;
    lastReq.current = msg;
    setBusy(true); setRejected(false); setActiveRoute(null); setLine("Right. Crew!");
    setPlan([]);
    setEvents([]); setJoin(null); setWall(undefined); setWork(undefined);
    setCrew((c) => c.map((n) => ({ ...n, state: "idle", ms: undefined })));

    fanWork.current = 0; fanStart.current = 0; fanRan.current = 0; fanDone.current = 0;
    const res = await fetch("/api/w2/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: msg, session_id: sid.current || undefined,
        site: forceSite || undefined }),
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
            if (!fanStart.current) { fanStart.current = Date.now(); fanWork.current = 0; fanRan.current = 0; fanDone.current = 0; }
            fanRan.current += 1;
          }
          setNode(d.node, "live");
          push("node", `${d.node} · running`);
        } else if (d.kind === "node.done") {
          setNode(d.node, "done", { ms: d.ms, text: d.text });
          if (fanout.current.includes(d.node)) {
            fanWork.current += (d.ms ?? 0) / 1000;
            fanDone.current += 1;
            // Only once the whole round is home. A half-summed round reads
            // "9.0s on the wall clock, 9.0s of work" — true, and an invitation to
            // conclude that running them together bought nothing.
            if (fanRan.current > 1 && fanDone.current >= fanRan.current) {
              setWork(fanWork.current);
              setWall((Date.now() - fanStart.current) / 1000);
            }
          }
          if (d.finding?.branch) {
            // A row at a time, as each branch lands — so three pieces of research
            // are watched arriving rather than asserted afterwards.
            setPlan((rows) => [...rows.filter((r) => r.branch !== d.finding.branch),
              { branch: d.finding.branch, found: d.finding.found, decided: d.finding.decided }]
              .sort((x, y) => ORDER.indexOf(x.branch) - ORDER.indexOf(y.branch)));
            push("found", `${d.finding.branch} · ${d.finding.found}`);
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
          if (Array.isArray(d.plan) && d.plan.length) setPlan(d.plan);
          setHistory((h) => [...h, { src: d.image, label: `turn ${h.length + 1}` }]);
          push("render", "one image from three descriptions");
        } else if (d.kind === "route") {
          if (d.route === "rework") {
            setRejected(true); setLine(d.why || "hang it again");
            setNode(d.to, "redo");
            // The plot goes backwards, and the plan says WHICH row moved — without
            // that the picture changing and the plan changing are two things that
            // happened near each other rather than one event.
            setPlan((rows) => rows.map((r) => ({ ...r, stale: r.branch !== d.to })));
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

      <YardMap topo={topo}
        states={Object.fromEntries(crew.map((c) => [c.name, c.state]))}
        times={Object.fromEntries(crew.filter((c) => c.ms).map((c) => [c.name, c.ms!]))}
        join={join} activeRoute={activeRoute} wall={wall} work={work} />

      {/* The plan is the deliverable and the picture illustrates it, so the plan
          gets a full row. Squeezed into half a column under the image the layout
          said the opposite, and every line ended in an ellipsis. */}
      {(plan.length > 0 || busy) && (
        <div className="glass" style={{ padding: "14px 18px", marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em",
            color: "var(--faint)", textTransform: "uppercase", marginBottom: 9 }}>
            The plan
          </div>
          {plan.length === 0
            ? <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>
                three crews are finding out&hellip;</span>
            : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {plan.map((r) => (
                  <div key={r.branch} style={{ display: "grid", alignItems: "center", gap: 12,
                    gridTemplateColumns: "26px 84px minmax(0,1fr) 14px minmax(0,1.15fr)",
                    fontSize: 13, opacity: r.stale ? .4 : 1, transition: "opacity .3s" }}>
                    <img src={FACE[r.branch]} alt="" width={26} height={26}
                      style={{ borderRadius: 8, objectFit: "cover", display: "block",
                        filter: r.stale ? "saturate(.4)" : "none" }} />
                    <span className="mono" style={{ fontSize: 11, letterSpacing: ".06em",
                      color: "var(--violet-soft)", textTransform: "uppercase" }}>{r.branch}</span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--sub)" }}>{r.found}</span>
                    <span style={{ color: "var(--faint)" }}>&rarr;</span>
                    <span style={{ fontWeight: 600,
                      color: r.stale ? "var(--faint)" : "#2f7d67" }}>{r.decided}</span>
                  </div>
                ))}
              </div>}

          {/* The experiment, one click. Same request, same crew, one variable moved. */}
          {plan.length > 0 && !busy && Object.keys(sites).length > 1 && (
            <div style={{ display: "flex", gap: 7, marginTop: 13, paddingTop: 11,
              borderTop: "1px solid var(--line)", flexWrap: "wrap", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)",
                letterSpacing: ".1em" }}>SAME REQUEST, SOMEWHERE ELSE</span>
              {Object.entries(sites).filter(([id]) => id !== site).slice(0, 3).map(([id, name]) => (
                <button key={id} className="rune" style={{ fontSize: 11 }}
                  onClick={() => { setSite(id); build(lastReq.current, id); }}>
                  &#8635; {name.replace(/^the /, "")}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "stretch" }}>
        <div className="glass" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10 }}>
            <span className="serif" style={{ fontSize: 16 }}>🏡 The plot</span>
            <span className={`pill ${rejected ? "warn" : "gold"}`}>
              {rejected ? "sent back" : plan.length ? `${plan.length} decisions` : "empty"}
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
