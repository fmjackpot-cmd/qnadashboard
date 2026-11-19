export function createLanBroker() {
  const rooms = new Map();
  return {
    issueToken: async room => ({ transport: 'sse', channel: room }),
    publish: async (room, state) => {
      for (const client of rooms.get(room) || []) {
        if (!client.write(`data: ${JSON.stringify(state)}\n\n`)) client.destroy();
      }
    },
    attach(request, response, room) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      response.write(': connected\n\n');
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(response);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
      heartbeat.unref();
      response.on('close', () => {
        clearInterval(heartbeat);
        rooms.get(room)?.delete(response);
        if (!rooms.get(room)?.size) rooms.delete(room);
      });
    },
    close() { for (const clients of rooms.values()) for (const client of clients) client.destroy(); }
  };
}
