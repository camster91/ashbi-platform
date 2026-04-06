// prisma/reset.js — wipe all data except User accounts
// Run with: node prisma/reset.js

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Starting data reset — keeping User accounts only...');

  // Delete in dependency order (children before parents)
  const steps = [
    // Outreach / AI agents
    () => prisma.coldEmailProspect.deleteMany(),
    () => prisma.coldEmailSequence.deleteMany(),
    () => prisma.linkedInProspect.deleteMany(),
    () => prisma.linkedInSequence.deleteMany(),
    () => prisma.outreachLead.deleteMany(),
    () => prisma.outreachSequence.deleteMany(),
    () => prisma.emailTriageDraft.deleteMany(),
    () => prisma.emailTriageItem.deleteMany(),
    () => prisma.contentDraft.deleteMany(),
    () => prisma.socialPost.deleteMany(),
    () => prisma.blogPost.deleteMany(),
    () => prisma.callLog.deleteMany(),

    // Finance
    () => prisma.invoicePayment.deleteMany(),
    () => prisma.invoiceLineItem.deleteMany(),
    () => prisma.invoice.deleteMany(),
    () => prisma.proposalLineItem.deleteMany(),
    () => prisma.proposal.deleteMany(),
    () => prisma.contract.deleteMany(),
    () => prisma.retainerPlan.deleteMany(),
    () => prisma.expense.deleteMany(),
    () => prisma.revenueSnapshot.deleteMany(),
    () => prisma.lineItemTemplate.deleteMany(),

    // Project work
    () => prisma.approval.deleteMany(),
    () => prisma.revisionRound.deleteMany(),
    () => prisma.taskComment.deleteMany(),
    () => prisma.timeEntry.deleteMany(),
    () => prisma.milestone.deleteMany(),
    () => prisma.attachment.deleteMany(),
    () => prisma.task.deleteMany(),
    () => prisma.note.deleteMany(),
    () => prisma.activity.deleteMany(),
    () => prisma.calendarEvent.deleteMany(),
    () => prisma.projectCommunication.deleteMany(),
    () => prisma.projectContext.deleteMany(),

    // Threads / messaging
    () => prisma.response.deleteMany(),
    () => prisma.internalNote.deleteMany(),
    () => prisma.message.deleteMany(),
    () => prisma.thread.deleteMany(),
    () => prisma.unmatchedEmail.deleteMany(),

    // AI / chat
    () => prisma.ashChatMessage.deleteMany(),
    () => prisma.ashConversation.deleteMany(),
    () => prisma.aiTeamMessage.deleteMany(),
    () => prisma.aiContext.deleteMany(),
    () => prisma.chatReaction.deleteMany(),
    () => prisma.chatMessage.deleteMany(),

    // Client / project structure
    () => prisma.eventAttendee.deleteMany(),
    () => prisma.projectTemplate.deleteMany(),
    () => prisma.intakeFormResponse.deleteMany(),
    () => prisma.intakeForm.deleteMany(),
    () => prisma.project.deleteMany(),
    () => prisma.clientEmailMapping.deleteMany(),
    () => prisma.contact.deleteMany(),
    () => prisma.client.deleteMany(),

    // Reports / digests
    () => prisma.report.deleteMany(),
    () => prisma.weeklyDigest.deleteMany(),

    // Misc
    () => prisma.upworkContract.deleteMany(),
    () => prisma.notification.deleteMany(),
    () => prisma.pushSubscription.deleteMany(),
    () => prisma.credential.deleteMany(),
    () => prisma.brandSettings.deleteMany(),
    () => prisma.taskTemplate.deleteMany(),
  ];

  for (const step of steps) {
    try {
      const result = await step();
      if (result?.count > 0) {
        console.log(`  Deleted ${result.count} records`);
      }
    } catch (err) {
      // Log but continue — some tables may not exist yet
      console.warn(`  Warning: ${err.message}`);
    }
  }

  const users = await prisma.user.findMany({ select: { email: true, role: true } });
  console.log('\nReset complete. Remaining users:');
  users.forEach(u => console.log(`  ${u.email} (${u.role})`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
