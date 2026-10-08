import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createWorkspaceTools } from '../integrations/workspace-tools.js';
import { createWorkspaceMcp } from '../integrations/workspace-mcp.js';
import { ToolError } from '../ai/tools/registry.js';

const context = request => ({ prisma: request.prisma, user: request.user, scopes: request.apiKeyScopes ?? [],
  requestId: request.id, ip: request.ip, log: request.log });

export default async function workspaceApiRoutes(fastify, options = {}) {
  const service = options.service ?? createWorkspaceTools();
  const auth = { onRequest: [fastify.authenticateWithApiKey] };
  fastify.get('/agent/tools', auth, async request => ({
    version: '1', tools: service.list(context(request)), mcp: '/api/mcp',
    authentication: 'Authorization: Bearer <API key>',
  }));
  fastify.post('/agent/tools/:name', { ...auth, schema: { body: { type: 'object' } } }, async (request, reply) => {
    try {
      return { data: await service.call(context(request), request.params.name, request.body), meta: { requestId: request.id } };
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, meta: { requestId: request.id } });
    }
  });
  fastify.post('/mcp', auth, async (request, reply) => {
    // Reject browser cross-origin requests even with a valid key. Non-browser
    // MCP clients omit Origin. CORS_ORIGIN is the deployment's explicit list.
    const origin = request.headers.origin;
    const allowedOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) return reply.code(403).send({ error: { code: 'ORIGIN_DENIED' } });
    const server = createWorkspaceMcp(service, context(request));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    reply.raw.once('close', () => { void server.close(); });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  for (const method of ['get', 'delete']) {
    fastify[method]('/mcp', auth, async (_request, reply) => {
      return reply.header('Allow', 'POST').code(405).send({ error: { code: 'METHOD_NOT_ALLOWED' } });
    });
  }
}
