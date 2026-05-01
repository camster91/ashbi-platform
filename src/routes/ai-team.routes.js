// AI Team Routes — 7 specialized AI agents with chat interfaces

import prisma from '../config/db.js';
import { getProvider } from '../ai/providers/index.js';

const AGENTS = [
  {
    role: 'WEB_DESIGNER',
    name: 'Web Designer',
    description: 'Figma briefs, mockup feedback, style guides',
    color: 'blue',
    icon: 'Palette',
    systemPrompt: 'You are Ashbi Design web designer. Expert in Figma, Elementor, UI/UX for CPG/DTC brands. Give specific visual recommendations.',
    quickActions: [
      'Create a Figma brief',
      'Review this mockup',
      'Generate a style guide',
      'Suggest color palette',
    ],
  },
  {
    role: 'WEB_DEVELOPER',
    name: 'Web Developer',
    description: 'WordPress/Shopify debugging, code snippets',
    color: 'purple',
    icon: 'Code2',
    systemPrompt: 'You are Ashbi Design web developer. Expert in WordPress, WooCommerce, Shopify, Elementor. Give working code examples.',
    quickActions: [
      'Debug this WordPress issue',
      'Write a WooCommerce snippet',
      'Fix Shopify Liquid template',
      'Elementor custom CSS',
    ],
  },
  {
    role: 'PROJECT_MANAGER',
    name: 'Project Manager',
    description: 'Client updates, status reports, milestone tracking',
    color: 'green',
    icon: 'ClipboardList',
    systemPrompt: 'You are Ashbi Design PM. Draft client updates, flag risks, track milestones. Be professional and warm.',
    quickActions: [
      'Draft a client update',
      'Write a status report',
      'Flag project risks',
      'Create milestone plan',
    ],
  },
  {
    role: 'MARKETING_MANAGER',
    name: 'Marketing Manager',
    description: 'Social posts, blog content, campaigns',
    color: 'orange',
    icon: 'Megaphone',
    systemPrompt: 'You are Ashbi Design marketing manager. Create content for CPG/DTC brands. Brand voice: expert, human, not corporate.',
    quickActions: [
      'Write a social post',
      'Draft blog outline',
      'Plan a campaign',
      'Create email newsletter',
    ],
  },
  {
    role: 'SALES',
    name: 'Sales',
    description: 'Outreach emails, proposals, follow-ups',
    color: 'yellow',
    icon: 'HandshakeIcon',
    systemPrompt: 'You are Ashbi Design sales agent. Write outreach emails under 100 words, proposals, follow-ups. CTA: 15-min call. Sign off as Cameron Ashley.',
    quickActions: [
      'Write cold outreach email',
      'Draft a proposal',
      'Write follow-up email',
      'Create pitch deck outline',
    ],
  },
  {
    role: 'LEGAL',
    name: 'Legal',
    description: 'Contracts, NDAs, SOW templates',
    color: 'slate',
    icon: 'Scale',
    systemPrompt: 'You are Ashbi Design legal assistant. Draft contracts, NDAs, SOW for Toronto creative agency. Always recommend professional review.',
    quickActions: [
      'Draft an NDA',
      'Create SOW template',
      'Review contract terms',
      'Write terms of service',
    ],
  },
  {
    role: 'BRANDING_EXPERT',
    name: 'Branding Expert',
    description: 'Brand identity, creative direction, packaging',
    color: 'pink',
    icon: 'Sparkles',
    systemPrompt: 'You are Ashbi Design branding expert. Brand identity, packaging direction, creative briefs for CPG/DTC supplement/skincare/food brands.',
    quickActions: [
      'Create brand brief',
      'Suggest packaging direction',
      'Define brand personality',
      'Review brand identity',
    ],
  },
];

// Build a lookup map
const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.role, a]));

export default async function aiTeamRoutes(fastify) {
  // GET /ai-team/agents — return all 7 agent configs
  fastify.get('/agents', { onRequest: [fastify.authenticate] }, async () => {
    return AGENTS.map(({ systemPrompt, ...rest }) => rest);
  });

  // POST /ai-team/chat — send message to an agent
  fastify.post('/chat', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { agentRole, message, clientId, projectId, history = [] } = request.body;

    const agent = AGENT_MAP[agentRole];
    if (!agent) {
      return reply.status(400).send({ error: 'Unknown agent role' });
    }

    // Build context from DB if clientId or projectId provided
    let contextParts = [];

    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: { contacts: true, projects: { select: { id: true, name: true, status: true } } },
      });
      if (client) {
        contextParts.push(`Client context — ${client.name} (${client.domain || 'no domain'}). Projects: ${client.projects.map(p => `${p.name} [${p.status}]`).join(', ') || 'none'}. Contacts: ${client.contacts.map(c => `${c.name} <${c.email}>`).join(', ') || 'none'}.`);
      }
    }

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: { select: { name: true } } },
      });
      if (project) {
        contextParts.push(`Project context — ${project.name} for ${project.client.name}. Status: ${project.status}. Health: ${project.health}. ${project.aiSummary ? `Summary: ${project.aiSummary}` : ''}`);
      }
    }

    // Build conversation for the AI
    const systemPrompt = contextParts.length > 0
      ? `${agent.systemPrompt}\n\nContext:\n${contextParts.join('\n')}`
      : agent.systemPrompt;

    // Format history + new message as a prompt
    const conversationLines = history.map(h =>
      `${h.role === 'USER' ? 'User' : 'Assistant'}: ${h.content}`
    );
    conversationLines.push(`User: ${message}`);
    const prompt = conversationLines.join('\n\n');

    // Call AI provider
    const ai = getProvider();
    const response = await ai.chat({
      system: systemPrompt,
      prompt,
      temperature: 0.5,
      maxTokens: 4096,
    });

    // Save user message + assistant response
    const saveData = [
      { agentRole, role: 'USER', content: message, clientId: clientId || null, projectId: projectId || null },
      { agentRole, role: 'ASSISTANT', content: response, clientId: clientId || null, projectId: projectId || null },
    ];
    await prisma.aiTeamMessage.createMany({ data: saveData });

    return { response };
  });

  // GET /ai-team/history/:agentRole — recent chat history for an agent
  fastify.get('/history/:agentRole', { onRequest: [fastify.authenticate] }, async (request) => {
    const { agentRole } = request.params;
    const messages = await prisma.aiTeamMessage.findMany({
      where: { agentRole },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return messages.reverse();
  });
}
