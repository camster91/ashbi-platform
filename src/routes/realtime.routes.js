// Realtime configuration for authenticated browsers.

import env from '../config/env.js';
import { resolveIceServers } from '../services/call-signalling.service.js';

export default async function realtimeRoutes(fastify) {
  // ICE servers for project calls. TURN credentials are only handed to
  // signed-in users, never embedded in the public bundle.
  fastify.get('/ice-servers', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { iceServers: resolveIceServers(env.webrtcIceServers) };
  });
}
