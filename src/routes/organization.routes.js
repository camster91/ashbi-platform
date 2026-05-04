// Organization management routes (Master Admin only)

export default async function organizationRoutes(fastify) {
  // Only Master Admins can manage organizations
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.user?.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Master Admin access required' });
    }
  });

  // GET /api/organizations
  fastify.get('/', async (request) => {
    return fastify.prisma.organization.findMany({
      include: {
        _count: {
          select: { users: true, clients: true, projects: true }
        }
      }
    });
  });

  // POST /api/organizations
  fastify.post('/', async (request, reply) => {
    const { name, slug, plan = 'FREE' } = request.body;

    const organization = await fastify.prisma.organization.create({
      data: { name, slug, plan }
    });

    return reply.status(201).send(organization);
  });

  // GET /api/organizations/:id
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const organization = await fastify.prisma.organization.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true } },
        _count: {
          select: { clients: true, projects: true }
        }
      }
    });

    if (!organization) return reply.status(404).send({ error: 'Organization not found' });
    return organization;
  });
}
