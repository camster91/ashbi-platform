import env from '../config/env.js';
import { loadUnifiedLaunchReadiness } from '../services/unifiedLaunchReport.service.js';

export default async function launchReadinessRoutes(fastify) {
  const adminOnly = { onRequest: [fastify.authenticate, fastify.adminOnly] };

  fastify.get('/', adminOnly, async () => (
    loadUnifiedLaunchReadiness(env.unifiedLaunchManifestPath)
  ));
}
