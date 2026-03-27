// AI configuration and model settings

export const aiConfig = {
  // Model settings
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,

  // Temperature settings by task
  temperatures: {
    parsing: 0.1,      // Low for extraction accuracy
    analysis: 0.3,     // Slightly higher for nuance
    planning: 0.4,     // Allow creative problem-solving
    drafting: 0.6,     // Higher for natural responses
    chat: 0.7          // Conversational
  },

  // Intent classifications
  intents: [
    'bug_report',
    'feature_request',
    'question',
    'approval_request',
    'feedback',
    'status_update',
    'urgent_issue',
    'general'
  ],

  // Urgency levels
  urgencyLevels: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'],

  // Sentiment classifications
  sentiments: ['frustrated', 'happy', 'neutral', 'anxious', 'confused'],

  // Tone options for responses
  tones: ['professional', 'friendly', 'apologetic', 'reassuring'],

  // Task categories for project planning
  taskCategories: [
    'IMMEDIATE',
    'THIS_WEEK',
    'UPCOMING',
    'WAITING_CLIENT',
    'WAITING_US',
    'COMPLETED'
  ]
};

export default aiConfig;
