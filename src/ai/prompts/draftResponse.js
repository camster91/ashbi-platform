// AI Prompt: Draft Response (Step 4)

import { senderDescription, signOffInstruction } from '../../utils/organization-name.js';

/**
 * @param {object} input
 * @param {{ name?: string } | null} [input.sender] the person the drafts are for, when known
 * @param {string} [input.organizationName] their organization's name, when known
 */
export function buildDraftResponsePrompt({ message, thread, project, analysis, client, sender = null, organizationName = '' }) {
  const system = `You are an AI assistant for Agency Hub, helping draft client response emails on behalf of ${senderDescription(sender, organizationName)}.

Your task is to generate 2-3 response options with different approaches.

Guidelines:
1. Always be professional and helpful
2. Match the client's communication style when known
3. Address all explicit and important implicit questions
4. Be specific about timelines and next steps
5. Don't over-promise or make commitments without context
6. Keep responses concise but complete
7. Use appropriate tone based on sentiment
8. ${signOffInstruction(sender, organizationName, 'Sign each option as')}

Response lengths:
- short: 2-4 sentences, quick acknowledgment
- medium: 1-2 paragraphs, standard response
- detailed: 3+ paragraphs, complex situations

${client?.communicationPrefs ? `Client preferences: ${client.communicationPrefs}` : ''}`;

  const prompt = `Draft response options for this client message:

ORIGINAL MESSAGE:
From: ${message.senderEmail} (${message.senderName || 'Unknown'})
Subject: ${message.subject}
Body:
${message.bodyText}

AI ANALYSIS:
Intent: ${analysis.intent}
Urgency: ${analysis.urgency}
Sentiment: ${analysis.sentiment}
Summary: ${analysis.summary}

Questions to answer:
${analysis.questionsToAnswer?.map(q => `- ${q.question} (${q.priority})`).join('\n') || 'None identified'}

Key points to address:
${analysis.responseApproach?.keyPointsToAddress?.join('\n- ') || 'None specified'}

${thread?.messages?.length > 1 ? `THREAD CONTEXT:
Previous exchanges: ${thread.messages.length - 1}
Thread started: ${thread.createdAt}` : 'This is a new thread.'}

${project ? `PROJECT CONTEXT:
Name: ${project.name}
Status: ${project.status}
Summary: ${project.aiSummary || 'No summary'}` : 'No project context available.'}

Generate 2-3 response options. Respond with JSON:
{
  "recommendedOption": 1,
  "recommendationReason": "why this option is best for this situation",
  "options": [
    {
      "approach": "brief description of this response style",
      "subject": "Re: original subject or new subject if needed",
      "body": "full email response body",
      "tone": "professional|friendly|apologetic|reassuring",
      "length": "short|medium|detailed"
    }
  ],
  "warnings": ["any concerns about responding", "things to verify before sending"],
  "needsPersonalTouch": true/false,
  "personalTouchReason": "why the sender should personalize this before sending",
  "suggestedFollowUp": {
    "needed": true/false,
    "when": "suggested timing",
    "what": "what to follow up on"
  }
}`;

  return { system, prompt, temperature: 0.6 };
}

export default buildDraftResponsePrompt;
