// AI Prompt: Analyze Message (Step 2)

export function buildAnalyzeMessagePrompt({ message, thread, project }) {
  const system = `You are an AI assistant for Agency Hub, helping analyze client messages.

Your task is to deeply analyze a client message to:
1. Classify intent and urgency
2. Detect sentiment and tone
3. Extract action items and questions
4. Suggest response approach

Intent categories: bug_report, feature_request, question, approval_request, feedback, status_update, urgent_issue, general

Urgency levels:
- CRITICAL: Production down, legal issues, major deadline today
- HIGH: Important deadline this week, frustrated client, blocking issues
- NORMAL: Standard requests, questions, updates
- LOW: Nice-to-haves, FYIs, non-urgent feedback

Sentiment: frustrated, happy, neutral, anxious, confused

Be thorough in extracting action items - even implied ones.`;

  const prompt = `Analyze this client message:

Subject: ${message.subject || 'No subject'}
From: ${message.senderEmail}
Body:
${message.bodyText}

${thread ? `Thread history (previous messages):
${thread.messages?.map(m => `[${m.direction}] ${m.bodyText.substring(0, 200)}...`).join('\n')}` : 'This is the first message in the thread.'}

${project ? `Project context:
Name: ${project.name}
Status: ${project.status}
Current AI Summary: ${project.aiSummary || 'No summary yet'}` : 'No project matched yet.'}

Respond with JSON:
{
  "intent": "one of the intent categories",
  "summary": "2-3 sentence summary of the message",
  "urgency": "CRITICAL|HIGH|NORMAL|LOW",
  "urgencyReason": "why this urgency level",
  "sentiment": "frustrated|happy|neutral|anxious|confused",
  "sentimentIndicators": ["specific phrases/signals that indicate sentiment"],
  "actionItems": [
    {
      "task": "specific task to complete",
      "assignmentSuggestion": "dev|design|cameron|anyone",
      "estimatedEffort": "quick|medium|significant",
      "reason": "why this task is needed"
    }
  ],
  "questionsToAnswer": [
    {
      "question": "the explicit or implicit question",
      "explicit": true/false,
      "priority": "must_answer|should_answer|optional",
      "context": "any relevant context for answering"
    }
  ],
  "responseApproach": {
    "suggestedTone": "professional|friendly|apologetic|reassuring",
    "keyPointsToAddress": ["point 1", "point 2"],
    "suggestedTimeline": "when we should respond",
    "warnings": ["any concerns about how to handle this"]
  }
}`;

  return { system, prompt, temperature: 0.3 };
}

export default buildAnalyzeMessagePrompt;
