/**
 * Worker entry point. Routes a WebSocket upgrade to the Durable Object that
 * holds the requested room.
 */

import { Room } from './room.ts';

export { Room };

export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

const cors = (origins: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origins,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowed = env.ALLOWED_ORIGINS ?? '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(allowed) });
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: cors(allowed) });
    }

    if (url.pathname === '/ws') {
      // Everyone without a room name lands in the same queue, which is what
      // makes matchmaking work at low player counts.
      const name = url.searchParams.get('room') ?? 'public-1';
      const id = env.ROOM.idFromName(name);
      return env.ROOM.get(id).fetch(request);
    }

    return new Response(
      'Servidor de salas de Genesys. Conecta a /ws?room=<nombre>.',
      { status: 200, headers: cors(allowed) },
    );
  },
};
