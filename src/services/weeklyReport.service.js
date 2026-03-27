// Weekly report generation service

import aiClient from '../ai/client.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateWeeklyReport(clientId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Fetch client with projects
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        where: { status: 'ACTIVE' },
        include: {
          tasks: {
            where: {
              OR: [
                { completedAt: { gte: sevenDaysAgo } },
                { createdAt: { gte: sevenDaysAgo } }
              ]
            }
          },
          threads: {
            where: { lastActivityAt: { gte: sevenDaysAgo } },
            select: { id: true, subject: true, status: true, priority: true }
          },
          timeEntries: {
            where: { date: { gte: sevenDaysAgo } },
            select: { duration: true, description: true }
          },
          revisionRounds: {
            where: { createdAt: { gte: sevenDaysAgo } },
            select: { roundNumber: true, status: true }
          }
        }
      }
    }
  });

  if (!client) {
    throw new Error('Client not found');
  }

  // Build summary data per project
  const projectsSummary = client.projects.map(project => {
    const tasksCompleted = project.tasks.filter(t => t.completedAt).length;
    const tasksCreated = project.tasks.filter(t => t.createdAt >= sevenDaysAgo).length;
    const totalHours = project.timeEntries.reduce((sum, te) => sum + te.duration, 0) / 60;

    return {
      name: project.name,
      tasksCompleted,
      tasksCreated,
      activeThreads: project.threads.length,
      hoursLogged: Math.round(totalHours * 10) / 10,
      revisionRounds: project.revisionRounds.length
    };
  });

  // Use AI to draft the report email
  const prompt = `You are writing a weekly status report email for a client named "${client.name}".

Here is the activity summary for the past 7 days:

${JSON.stringify(projectsSummary, null, 2)}

Write a professional, friendly weekly summary email. Include:
- A brief greeting
- Project-by-project highlights (tasks completed, hours worked, any revision rounds)
- Overall status / what's coming next week
- A professional sign-off from "The Ashbi Team"

Keep it concise but informative. Do NOT use markdown formatting — write in plain email style.

Respond with valid JSON only:
{
  "subject": "the email subject line",
  "body": "the full email body"
}`;

  const result = await aiClient.chatJSON({
    system: 'You are a professional agency project manager writing client-facing weekly reports.',
    prompt,
    temperature: 0.5
  });

  return {
    subject: result.subject,
    body: result.body,
    clientId: client.id,
    clientName: client.name,
    projectsSummary
  };
}
