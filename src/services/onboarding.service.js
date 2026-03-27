// Client onboarding service — creates client, contact, project, thread, message, notification

const TIER_HOURS = {
  '999': 20,
  '1999': 40,
  '3999': 80
};

export async function onboardClient(fastify, { name, email, contactName, retainerTier, notes }) {
  const { prisma } = fastify;

  // Create client
  const client = await prisma.client.create({
    data: {
      name,
      domain: email.split('@')[1] || null,
      status: 'ACTIVE'
    }
  });

  // Create contact
  const contact = await prisma.contact.create({
    data: {
      email,
      name: contactName,
      role: 'Primary Contact',
      isPrimary: true,
      clientId: client.id
    }
  });

  // Create retainer plan
  await prisma.retainerPlan.create({
    data: {
      clientId: client.id,
      tier: retainerTier,
      hoursPerMonth: TIER_HOURS[retainerTier] || 20
    }
  });

  // Create onboarding project
  const project = await prisma.project.create({
    data: {
      name: `Onboarding - ${name}`,
      description: notes || `Onboarding project for ${name}`,
      status: 'ACTIVE',
      clientId: client.id
    }
  });

  // Create welcome thread
  const thread = await prisma.thread.create({
    data: {
      subject: `Welcome - ${name} Onboarding`,
      status: 'OPEN',
      priority: 'NORMAL',
      clientId: client.id,
      projectId: project.id,
      matchConfidence: 1.0,
      matchReason: 'Auto-created during onboarding'
    }
  });

  // Create first message
  await prisma.message.create({
    data: {
      direction: 'INBOUND',
      senderEmail: email,
      senderName: contactName,
      subject: `Welcome - ${name} Onboarding`,
      bodyText: 'Client onboarded via Agency Hub',
      threadId: thread.id
    }
  });

  // Notify all admin users
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true } });
  for (const admin of admins) {
    await prisma.notification.create({
      data: {
        type: 'CLIENT_ONBOARDED',
        title: `New client onboarded: ${name}`,
        message: `${contactName} (${email}) has been onboarded with the $${retainerTier}/mo retainer plan.`,
        data: JSON.stringify({ clientId: client.id, projectId: project.id }),
        userId: admin.id
      }
    });
    fastify.notify(admin.id, 'CLIENT_ONBOARDED', { clientId: client.id, clientName: name });
  }

  return {
    client: { ...client, contact },
    project,
    threadId: thread.id
  };
}
