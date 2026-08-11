import aiClient from '../ai/client.js';
import { validateBody, aiBridgeChatSchema } from '../validators/schemas.js';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12000;

function normalizeMessage(message) {
  if (!message || !['system', 'user', 'assistant'].includes(message.role)) return null;
  const content = typeof message.content === 'string' ? message.content : '';
  return content.trim() ? { role: message.role, content: content.slice(0, MAX_MESSAGE_CHARS) } : null;
}

function openAiResponse(content, model) {
  return {
    id: `chatcmpl-ashbi-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'ashbi',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

export default async function aiBridgeRoutes(fastify) {
  fastify.get('/capabilities', { onRequest: [fastify.authenticateWithApiKey] }, async (request) => ({
    name: 'Ashbi Agency Hub',
    version: '1',
    organizationId: request.user.organizationId || null,
    transport: 'OpenAI-compatible HTTP API',
    chatCompletions: '/api/ai-bridge/v1/chat/completions',
    authentication: 'x-api-key or Authorization: Bearer ashbi_…',
    capabilities: [
      { name: 'agency_context_chat', mode: 'read', description: 'Ask about the authenticated organization\'s projects, tasks, clients, threads, and retainers.' },
      { name: 'workflow_actions', mode: 'write', description: 'Planned action bridge; writes require explicit confirmation and durable audit records.' },
    ],
    safety: { tenantScoped: true, writesRequireConfirmation: true, credentialsNeverReturned: true },
  }));

  fastify.post('/v1/chat/completions', { onRequest: [fastify.authenticateWithApiKey], preHandler: validateBody(aiBridgeChatSchema) }, async (request, reply) => {
    const body = request.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES) : [];
    if (!messages.length || !messages.some(message => message.role === 'user')) {
      return reply.status(400).send({ error: { message: 'messages must include at least one user message', type: 'invalid_request_error' } });
    }

    const [projects, tasks, clients] = await Promise.all([
      request.prisma.project.findMany({ select: { id: true, name: true, status: true, health: true }, take: 25, orderBy: { updatedAt: 'desc' } }),
      request.prisma.task.findMany({ where: { status: { not: 'COMPLETED' } }, select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { name: true } } }, take: 50, orderBy: { updatedAt: 'desc' } }),
      request.prisma.client.findMany({ select: { id: true, name: true, status: true, domain: true }, take: 50, orderBy: { updatedAt: 'desc' } }),
    ]);
    const system = `You are Ashbi's agency operations assistant. You may discuss only the authenticated organization's data. Never invent records, expose credentials, or claim a write occurred. Writes are not available through this endpoint yet; direct the user to confirm in Ashbi.\n\nOrganization context:\n${JSON.stringify({ projects, tasks, clients })}`;
    const prompt = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');

    try {
      const result = await aiClient.chat({ system, prompt, temperature: 0.2, maxTokens: 1200 });
      const content = typeof result === 'string' ? result : result?.content || result?.text || JSON.stringify(result);
      return openAiResponse(content, body.model);
    } catch (error) {
      request.log.error({ err: error }, 'AI bridge completion failed');
      return reply.status(502).send({ error: { message: 'AI provider unavailable', type: 'upstream_error' } });
    }
  });
}
