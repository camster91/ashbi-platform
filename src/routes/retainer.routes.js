// Retainer plan routes — track hours & revision rounds per client

export default async function retainerRoutes(fastify) {
  // GET /retainer — list all retainer plans with client info
  fastify.get('/retainer', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const plans = await fastify.prisma.retainerPlan.findMany({
      include: {
        client: { select: { id: true, name: true, status: true } }
      },
      orderBy: { billingCycleStart: 'desc' }
    });

    const now = new Date();
    return plans.map(plan => {
      const revisionCount = 0; // lightweight list — detail page has revision count
      const percentUsed = plan.hoursPerMonth > 0
        ? Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100)
        : 0;
      return {
        ...plan,
        hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
        percentUsed,
        scopeCreepRisk: percentUsed > 80,
        daysInCycle: Math.floor((now - new Date(plan.billingCycleStart)) / 86400000),
      };
    });
  });

  // POST /retainer — create a retainer plan for a client
  fastify.post('/retainer', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const {
      clientId,
      tier,
      hoursPerMonth,
      monthlyAmountUsd,
      monthlyAmountCad,
    } = request.body;

    if (!clientId || !hoursPerMonth) {
      return reply.status(400).send({ error: 'clientId and hoursPerMonth are required' });
    }

    const plan = await fastify.prisma.retainerPlan.upsert({
      where: { clientId },
      create: {
        clientId,
        tier: tier || 'custom',
        hoursPerMonth: parseInt(hoursPerMonth),
        monthlyAmountUsd: monthlyAmountUsd ? parseFloat(monthlyAmountUsd) : null,
        monthlyAmountCad: monthlyAmountCad ? parseFloat(monthlyAmountCad) : null,
        billingCycleStart: new Date(),
      },
      update: {
        tier: tier || 'custom',
        hoursPerMonth: parseInt(hoursPerMonth),
        monthlyAmountUsd: monthlyAmountUsd ? parseFloat(monthlyAmountUsd) : null,
        monthlyAmountCad: monthlyAmountCad ? parseFloat(monthlyAmountCad) : null,
      },
      include: { client: { select: { id: true, name: true } } }
    });

    return plan;
  });

  // PUT /retainer/:clientId — update a retainer plan
  fastify.put('/retainer/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { clientId } = request.params;
    const { tier, hoursPerMonth, monthlyAmountUsd, monthlyAmountCad, resetHours } = request.body;

    const data = {};
    if (tier !== undefined) data.tier = tier;
    if (hoursPerMonth !== undefined) data.hoursPerMonth = parseInt(hoursPerMonth);
    if (monthlyAmountUsd !== undefined) data.monthlyAmountUsd = parseFloat(monthlyAmountUsd);
    if (monthlyAmountCad !== undefined) data.monthlyAmountCad = parseFloat(monthlyAmountCad);
    if (resetHours) {
      data.hoursUsed = 0;
      data.billingCycleStart = new Date();
    }

    const plan = await fastify.prisma.retainerPlan.update({
      where: { clientId },
      data,
      include: { client: { select: { id: true, name: true } } }
    });

    return plan;
  });


  // GET /retainer/:clientId — plan + hours used + % remaining + revision count
  fastify.get('/retainer/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId } = request.params;

    const plan = await fastify.prisma.retainerPlan.findUnique({
      where: { clientId },
      include: { client: { select: { name: true } } }
    });

    if (!plan) {
      return reply.status(404).send({ error: 'No retainer plan found for this client' });
    }

    const revisionCount = await fastify.prisma.revisionRound.count({
      where: { project: { clientId } }
    });

    return {
      ...plan,
      hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
      percentUsed: Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100),
      revisionCount
    };
  });

  // POST /retainer/:clientId/log-hours — log time and update hoursUsed
  fastify.post('/retainer/:clientId/log-hours', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    const { clientId } = request.params;
    const { hours, description, projectId } = request.body;

    if (!hours || hours <= 0) {
      return reply.status(400).send({ error: 'hours must be a positive number' });
    }

    const plan = await fastify.prisma.retainerPlan.findUnique({ where: { clientId } });
    if (!plan) {
      return reply.status(404).send({ error: 'No retainer plan found for this client' });
    }

    // Log time entry if we have a project and a user
    if (projectId) {
      const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (admin) {
        await fastify.prisma.timeEntry.create({
          data: {
            description: description || 'Retainer hours logged',
            duration: Math.round(hours * 60),
            billable: true,
            projectId,
            userId: admin.id
          }
        });
      }
    }

    const updated = await fastify.prisma.retainerPlan.update({
      where: { clientId },
      data: { hoursUsed: { increment: hours } }
    });

    return {
      hoursUsed: updated.hoursUsed,
      hoursRemaining: updated.hoursPerMonth - updated.hoursUsed,
      percentUsed: Math.round((updated.hoursUsed / updated.hoursPerMonth) * 100)
    };
  });

  // GET /retainer/:clientId/status — full status with scope creep risk
  fastify.get('/retainer/:clientId/status', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId } = request.params;

    const plan = await fastify.prisma.retainerPlan.findUnique({
      where: { clientId },
      include: { client: { select: { name: true } } }
    });

    if (!plan) {
      return reply.status(404).send({ error: 'No retainer plan found for this client' });
    }

    const revisionRounds = await fastify.prisma.revisionRound.count({
      where: { project: { clientId } }
    });

    const percentUsed = Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100);

    return {
      clientName: plan.client.name,
      tier: plan.tier,
      hoursTotal: plan.hoursPerMonth,
      hoursUsed: plan.hoursUsed,
      hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
      percentUsed,
      revisionRounds,
      scopeCreepRisk: percentUsed > 80
    };
  });

  // POST /retainer/check-all — check all clients, return any at risk (>80%)
  fastify.post('/retainer/check-all', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    const plans = await fastify.prisma.retainerPlan.findMany({
      include: { client: { select: { name: true } } }
    });

    const atRisk = plans
      .map(plan => ({
        clientId: plan.clientId,
        clientName: plan.client.name,
        tier: plan.tier,
        hoursTotal: plan.hoursPerMonth,
        hoursUsed: plan.hoursUsed,
        hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
        percentUsed: Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100)
      }))
      .filter(p => p.percentUsed > 80);

    return { total: plans.length, atRiskCount: atRisk.length, atRisk };
  });
}
