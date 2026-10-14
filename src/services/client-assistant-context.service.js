import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';

const MAX_PROJECTS = 25;

/**
 * Read-only, bounded context for a client assistant preview. Callers must
 * authorize access to the client before using it. No internal project content
 * or contact details are selected or returned.
 * @param {any} prisma
 * @param {{organizationId: string, clientId: string}} scope
 */
export async function buildClientAssistantContext(prisma, { organizationId, clientId }) {
  if (typeof organizationId !== 'string' || !organizationId.trim()
    || typeof clientId !== 'string' || !clientId.trim()) return null;

  const scoped = createScopedPrisma(prisma, organizationId);
  const client = await scoped.client.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { id: true, name: true, domain: true, organizationId: true, deletedAt: true },
  });
  if (!client || client.id !== clientId || client.organizationId !== organizationId || client.deletedAt != null) return null;

  const rows = await scoped.project.findMany({
    where: { clientId, organizationId, deletedAt: null },
    select: {
      id: true, name: true, status: true, startDate: true, endDate: true,
      clientId: true, organizationId: true, deletedAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: MAX_PROJECTS + 1,
  });
  const visible = rows.filter((project) => project.clientId === clientId
    && project.organizationId === organizationId && project.deletedAt == null);
  return {
    client: { id: client.id, name: client.name, domain: client.domain },
    projects: visible.slice(0, MAX_PROJECTS).map((project) => ({
      id: project.id, name: project.name, status: project.status,
      startDate: project.startDate, endDate: project.endDate,
    })),
    truncated: visible.length > MAX_PROJECTS,
  };
}
