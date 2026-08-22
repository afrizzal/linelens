import { getEmitter, type ChangePayload } from "@/lib/listener";

/**
 * GET /api/stream — the SSE fan-out endpoint (03-01-PLAN.md Task 1;
 * ARCHITECTURE.md Pattern 3). Self-hosted, long-lived Node process (never
 * serverless), so `getEmitter()`'s globalThis-cached LISTEN client genuinely
 * persists across requests within this process.
 *
 * `runtime = 'nodejs'` is required (the listener needs `pg`, not Edge-safe)
 * and `dynamic = 'force-dynamic'` prevents Next from statically optimizing
 * away the stream (STACK.md "SSE in Next.js App Router").
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 15_000;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const lineId = searchParams.get("lineId");

  const encoder = new TextEncoder();
  const emitter = getEmitter();

  const stream = new ReadableStream<Uint8Array>({
    // Deliberately NOT async / no await inside start() — enqueue synchronously
    // and return so Next.js flushes the response immediately instead of
    // buffering until the stream closes (PITFALLS.md "NextResponse for the
    // SSE stream" trap; we also never use NextResponse here, only raw
    // Response + ReadableStream).
    start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed — a NOTIFY-triggered change event raced
          // the abort/close path; abort cleanup will run momentarily.
        }
      };

      const onChange = (payload: ChangePayload): void => {
        if (lineId && !payload.lineIds.includes(lineId)) return;
        send("change", payload);
      };

      emitter.on("change", onChange);

      // Defeats the well-known ~35s idle proxy/browser timeout (STACK.md).
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // Controller already closed — a ping tick raced the abort/close
          // path; abort cleanup will run momentarily.
        }
      }, PING_INTERVAL_MS);

      const cleanup = (): void => {
        emitter.off("change", onChange);
        clearInterval(pingTimer);
        // Verification signal for 03-01-PLAN.md Task 1 <verify> ("no listener
        // leak — subscriber count returns to 0"): logged so a manual
        // `docker compose up` + `curl -N` + Ctrl-C check can confirm it.
        console.info("[stream] client disconnected, subscribers:", emitter.listenerCount("change"));
        try {
          controller.close();
        } catch {
          // Already closed — request.signal 'abort' can fire after the
          // stream naturally ended; closing twice would throw.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defeats reverse-proxy buffering (nginx et al.) inside docker compose
      // — this is the difference between "works in `next dev`, breaks in
      // compose" per PITFALLS.md.
      "X-Accel-Buffering": "no",
    },
  });
}
