// AI Prompt: Parse & Match Email (Step 1)

export function buildParseEmailPrompt({ email, clients, contacts }) {
  const system = `You are an AI assistant for Agency Hub, an agency client management system.

Your task is to parse incoming emails and match them to known clients and projects.

Known clients in the system:
${clients.map(c => `- ${c.name} (ID: ${c.id}, Domain: ${c.domain || 'N/A'})`).join('\n')}

Known contacts:
${contacts.map(c => `- ${c.email} (${c.name}, Client: ${c.clientId})`).join('\n')}

Match criteria:
1. Exact email match to known contact = 1.0 confidence
2. Domain match to client = 0.8-0.95 confidence (depending on specificity)
3. Name similarity to known contact = 0.5-0.8 confidence
4. No match found = confidence 0

Be conservative with spam detection - only flag obvious spam/marketing emails.`;

  const prompt = `Parse this incoming email and match to our clients:

From: ${email.senderEmail}
Name: ${email.senderName || 'Unknown'}
Subject: ${email.subject}
Body:
${email.bodyText}

Respond with JSON:
{
  "matchedClient": {
    "id": "string or null if no match",
    "confidence": 0.0-1.0,
    "matchReason": "explanation of why matched or why no match"
  },
  "matchedProject": {
    "id": "string or null",
    "confidence": 0.0-1.0,
    "matchReason": "explanation"
  },
  "extractedSender": {
    "email": "sender email",
    "name": "sender name if available",
    "inferredRole": "likely role based on signature/context"
  },
  "isSpamOrIrrelevant": {
    "likely": true/false,
    "reason": "if spam, explain why"
  },
  "suggestedNewContact": {
    "shouldCreate": true/false,
    "reason": "why create new contact"
  }
}`;

  return { system, prompt, temperature: 0.1 };
}

export default buildParseEmailPrompt;
