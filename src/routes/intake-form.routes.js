// Intake Form routes — CRUD + public submission

export default async function intakeFormRoutes(fastify) {

  // ─── GET / — list all forms ──────────────────────────────────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const forms = await fastify.prisma.intakeForm.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { responses: true } },
      },
    });

    return forms.map(f => ({
      ...f,
      fields: JSON.parse(f.fields || '[]'),
      responseCount: f._count.responses,
      _count: undefined,
    }));
  });

  // ─── POST / — create form ───────────────────────────────────────────────────
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { name, description, fields, clientId, isActive } = request.body || {};

    if (!name) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    const form = await fastify.prisma.intakeForm.create({
      data: {
        name,
        description: description || null,
        fields: JSON.stringify(fields || []),
        clientId: clientId || null,
        isActive: isActive !== false,
      },
    });

    return { ...form, fields: JSON.parse(form.fields) };
  });

  // ─── GET /:id — get form with responses ─────────────────────────────────────
  fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    const form = await fastify.prisma.intakeForm.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        responses: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!form) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    return {
      ...form,
      fields: JSON.parse(form.fields || '[]'),
      responses: form.responses.map(r => ({
        ...r,
        answers: JSON.parse(r.answers || '{}'),
      })),
    };
  });

  // ─── PUT /:id — update form ─────────────────────────────────────────────────
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, fields, clientId, isActive } = request.body || {};

    const existing = await fastify.prisma.intakeForm.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    const updated = await fastify.prisma.intakeForm.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(fields !== undefined && { fields: JSON.stringify(fields) }),
        ...(clientId !== undefined && { clientId: clientId || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return { ...updated, fields: JSON.parse(updated.fields) };
  });

  // ─── DELETE /:id — delete form ──────────────────────────────────────────────
  fastify.delete('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    const existing = await fastify.prisma.intakeForm.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    await fastify.prisma.intakeForm.delete({ where: { id } });
    return { success: true };
  });
}
