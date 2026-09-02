// GET /api/w2/graph — the shape of the learner's own graph, for the crew row.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_URL = process.env.VALLEY_AGENT_URL || "http://127.0.0.1:8100";

export async function GET() {
  try {
    const r = await fetch(`${AGENT_URL}/graph`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return NextResponse.json(await r.json());
  } catch { /* agent down — the page says so */ }
  return NextResponse.json({ graph: null, graph_error: "the yard agent isn't running" });
}
