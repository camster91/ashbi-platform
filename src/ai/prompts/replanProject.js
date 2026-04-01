// AI Prompt: Replan Project (Step 3)

export function buildReplanProjectPrompt({ project, threads, newMessage }) {
  const system = `You are an AI assistant for Agency Hub, helping maintain dynamic project plans.

Your task is to analyze the current state of a project and generate an updated plan.

Project health calculation:
- Start at 100 points
- Critical open threads: -30
- More than 2 threads needing response: -15
- Stale threads (no activity 3+ days): -10 each
- Long client waits: -5 each

Health thresholds:
- 80+: ON_TRACK
- 50-79: NEEDS_ATTENTION
- Below 50: AT_RISK

Task categories:
- IMMEDIATE: Must be done today/urgent
- THIS_WEEK: Should complete this week
- UPCOMING: Next steps after this week
- WAITING_CLIENT: Blocked on client input
- WAITING_US: Client waiting on us

Be specific and actionable in task descriptions.`;

  const prompt = `Update the project plan based on new message:

PROJECT: ${project.name}
Current Status: ${project.status}
Current Health: ${project.health} (Score: ${project.healthScore})
Current AI Summary: ${project.aiSummary || 'None'}
Current Plan: ${project.aiPlan || 'None'}

ACTIVE THREADS:
${threads.map(t => `- [${t.priority}] ${t.subject} (Status: ${t.status}, Last: ${t.lastActivityAt})`).join('\n')}

NEW MESSAGE:
Subject: ${newMessage.subject}
From: ${newMessage.senderEmail}
Body:
${newMessage.bodyText}

Respond with JSON:
{
  "projectSummary": "2-3 sentence current state summary",
  "overallHealth": "ON_TRACK|NEEDS_ATTENTION|AT_RISK",
  "healthScore": 0-100,
  "healthReason": "why this health status",
  "plan": {
    "immediate": [
      {
        "task": "specific task description",
        "reason": "why this is immediate",
        "suggestedAssignee": "dev|design|cameron",
        "estimatedTime": "time estimate",
        "blockedBy": "null or what's blocking"
      }
    ],
    "thisWeek": [],
    "upcoming": [],
    "waitingOnClient": [
      {
        "item": "what we're waiting for",
        "askedOn": "when we asked",
        "shouldFollowUp": true/false,
        "daysWaiting": number
      }
    ],
    "waitingOnUs": [
      {
        "item": "what client is waiting for",
        "promisedBy": "when we promised",
        "isOverdue": true/false
      }
    ]
  },
  "risks": [
    {
      "risk": "what could go wrong",
      "likelihood": "low|medium|high",
      "impact": "low|medium|high",
      "mitigation": "how to address"
    }
  ],
  "suggestedNextAction": {
    "action": "single most important next step",
    "owner": "who should do it",
    "by": "when it should be done"
  }
}`;

  return { system, prompt, temperature: 0.4 };
}

export default buildReplanProjectPrompt;
