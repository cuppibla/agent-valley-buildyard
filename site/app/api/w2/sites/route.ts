// GET /api/w2/sites — the sites the survey can choose between, so the yard can
// offer "build it on the ridge instead" without hardcoding the valley.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_URL = process.env.VALLEY_AGENT_URL || "http://127.0.0.1:8100";

export async function GET() {
  try {
    const r = await fetch(`${AGENT_URL}/sites`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return NextResponse.json(await r.json());
  } catch { /* agent down — the yard just does not offer the experiment */ }
  return NextResponse.json({ sites: {} });
}
