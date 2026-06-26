import { sseClients } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      sseClients.add(controller);
      console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

      // Send initial heartbeat
      const heartbeat = new TextEncoder().encode(': heartbeat\n\n');
      ctrl.enqueue(heartbeat);
    },
    cancel() {
      sseClients.delete(controller);
      console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
