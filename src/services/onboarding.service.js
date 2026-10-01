// Client onboarding service — creates client, contact, project, thread, message, notification

import { clientDomainFromEmail, normalizeContactEmail } from '../utils/client-identity.js';

const TIER_HOURS = {
  '999': 20,
  '1999': 40,
  '3999': 80
};

export async function onboardClient(fastify, { name, email, contactName, retainerTier, notes }) {
  const { prisma } = fastify;
  const result = await prisma.$transaction(async transaction => {
    const client = await transaction.client.create({
      data: { name, domain: clientDomainFromEmail(email), status: 'ACTIVE' },
    });
    const contact = await transaction.contact.create({
      data: { email: normalizeContactEmail(email), name: contactName, role: 'Primary Contact', isPrimary: true, clientId: client.id },
    });
    await transaction.retainerPlan.create({
      data: { clientId: client.id, tier: retainerTier, hoursPerMonth: TIER_HOURS[retainerTier] || 20 },
    });
    const project = await transaction.project.create({
      data: {
        name: `Onboarding - ${name}`,
        description: notes || `Onboarding project for ${name}`,
        status: 'STARTING_UP',
        clientId: client.id,
      },
    });
    const thread = await transaction.thread.create({
      data: {
        subject: `Welcome - ${name} Onboarding`,
        status: 'OPEN',
        priority: 'NORMAL',
        clientId: client.id,
        projectId: project.id,
        matchConfidence: 1.0,
        matchReason: 'Auto-created during onboarding',
      },
    });
    await transaction.message.create({
      data: {
        direction: 'INBOUND',
        senderEmail: email,
        senderName: contactName,
        subject: `Welcome - ${name} Onboarding`,
        bodyText: 'Client onboarded via Agency Hub',
        threadId: thread.id,
      },
    });
    const admins = await transaction.user.findMany({ where: { role: 'ADMIN', isActive: true } });
    const notifications = [];
    for (const admin of admins) {
      notifications.push(await transaction.notification.create({
        data: {
          type: 'CLIENT_ONBOARDED',
          title: `New client onboarded: ${name}`,
          message: `${contactName} (${email}) has been onboarded with the $${retainerTier}/mo retainer plan.`,
          data: { clientId: client.id, projectId: project.id },
          userId: admin.id,
        },
      }));
    }
    return { client, contact, project, thread, notifications };
  });

  // The rows were persisted inside the transaction; after commit only the
  // realtime event is sent (one row per admin, never a second one).
  for (const notification of result.notifications) {
    fastify.emitNotification(notification.userId, notification);
  }
  return {
    client: { ...result.client, contact: result.contact },
    project: result.project,
    threadId: result.thread.id,
  };
}
