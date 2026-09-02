// POST /api/w2/build — one build, streamed.
//
// The body is passed straight through rather than buffered. Week one's routes read
// the whole JSON reply before answering, which is fine for one picture and useless
// here: a crew card that lights up only after the workflow returns has nothing to
// teach. `duplex: "half"` is what lets fetch stream a request body in node.

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const AGENT_URL = process.env.VALLEY_AGENT_URL || "http://127.0.0.1:8100";

export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const upstream = await fetch(`${AGENT_URL}/build`, {
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
      },
    });
  } catch {
    return new Response(`data: ${JSON.stringify({ kind: "error",
      message: "the yard agent isn't running — start it with: bash valley.sh" })}\n\n`,
      { headers: { "content-type": "text/event-stream" } });
  }
}
