// POST /api/w2/sign — the traveler's answer, streamed back.
//
// Identical to the build route on purpose. To the workflow a first request and an
// answer to a question are the same thing — a message arriving on a session — so
// there is nothing here to do differently. `duplex: "half"` lets node stream it.

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const AGENT_URL = process.env.VALLEY_AGENT_URL || "http://127.0.0.1:8100";

export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const upstream = await fetch(`${AGENT_URL}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // @ts-expect-error — node fetch needs this to stream, the DOM types do not have it
      duplex: "half",
      signal: AbortSignal.timeout(295000),
    });
    if (!upstream.ok || !upstream.body) {
      return new Response(`data: ${JSON.stringify({ kind: "error",
        message: "the yard agent answered " + upstream.status })}\n\n`,
        { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        // Pass the session id back. Without it the browser cannot answer a
        // question the graph stopped on, because it does not know which
        // conversation the question belongs to.
        "x-session-id": upstream.headers.get("x-session-id") ?? "",
      },
    });
  } catch {
    return new Response(`data: ${JSON.stringify({ kind: "error",
      message: "the yard agent isn't running — start it with: bash valley.sh" })}\n\n`,
      { headers: { "content-type": "text/event-stream" } });
  }
}
