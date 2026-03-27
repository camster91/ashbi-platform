# OpenClaw Integration with Agency Hub

## Overview

This integration connects Agency Hub with OpenClaw, allowing AI assistants within Hub to communicate with OpenClaw, spawn specialists, execute commands, and maintain a seamless workflow between the two systems.

## Architecture

```
Agency Hub Frontend (React) 
        ↓
Agency Hub Backend (Fastify/Node.js)
        ↓
OpenClaw Gateway (localhost:18789)
        ↓
OpenClaw Specialists & Tools
```

## Components

### 1. **AIChatPanel.jsx** - Floating AI Chat
- Context-aware floating chat interface
- Can communicate with both Hub AI and OpenClaw
- Supports all 7 AI team specialists
- Position: bottom-right (configurable)
- Features: message history, agent selection, quick actions

### 2. **TaskAIChat.jsx** - Task-Specific AI Chat
- Embedded chat for task/project pages
- Pre-loaded with task context
- Specialized quick actions for task management
- Copy-to-clipboard for AI responses

### 3. **AIActions.jsx** - Quick AI Buttons
- Contextual quick actions based on current page
- One-click AI operations (summarize, draft, triage, etc.)
- Compact and expanded modes
- Real-time feedback on actions

## API Endpoints

### OpenClaw Routes (`/api/openclaw/*`)

#### `GET /health`
Check OpenClaw gateway connectivity.

#### `POST /message`
Send a message to any OpenClaw channel.

#### `POST /command`
Execute a command via OpenClaw.

#### `POST /spawn`
Spawn an OpenClaw specialist for a task.

#### `GET /specialists`
Get available OpenClaw specialists.

#### `POST /query`
Query OpenClaw for information.

#### `GET /sessions`
Get OpenClaw session status.

### AI Team Routes (`/api/ai-team/*`)

#### `GET /agents`
Get all 7 AI specialist agents.

#### `POST /chat`
Chat with a specific AI agent.

#### `GET /history/:agentRole`
Get chat history for an agent.

## Database Schema Updates

### AiTeamMessage Model
Already exists in schema.prisma:
```prisma
model AiTeamMessage {
  id        String   @id @default(cuid())
  agentRole String   // WEB_DESIGNER, WEB_DEVELOPER, PROJECT_MANAGER, etc.
  role      String   // USER or ASSISTANT
  content   String
  clientId  String?
  projectId String?
  createdAt DateTime @default(now())

  client  Client?  @relation(fields: [clientId], references: [id], onDelete: SetNull)
  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

  @@index([agentRole, createdAt])
  @@map("ai_team_messages")
}
```

### Task Metadata
Tasks created by OpenClaw specialists include metadata:
```json
{
  "type": "openclaw_specialist",
  "specialist": "coding-agent",
  "openclawTaskId": "abc123",
  "context": { /* original context */ }
}
```

## Context Injection

The AI system automatically injects context based on the current page:

### Project Page Context
```javascript
{
  project: {
    id: "proj_123",
    name: "Website Redesign",
    status: "ACTIVE",
    health: "HEALTHY"
  },
  client: {
    id: "client_456",
    name: "Acme Corp"
  },
  page: "project-detail"
}
```

### Task Page Context
```javascript
{
  task: {
    id: "task_789",
    title: "Design homepage",
    status: "IN_PROGRESS",
    priority: "HIGH"
  },
  project: { /* project info */ },
  client: { /* client info */ },
  page: "task-detail"
}
```

### Inbox Context
```javascript
{
  thread: {
    id: "thread_101",
    subject: "Urgent: Website down",
    priority: "CRITICAL"
  },
  client: { /* client info */ },
  page: "inbox"
}
```

## Quick Actions

### General Actions (available everywhere)
- "What's my most urgent task?"
- "Summarize active projects"
- "Which clients need follow-up?"
- "Draft a status update"

### Task-Specific Actions
- "Update status"
- "Break down"
- "Estimate time"
- "Draft update"
- "Identify blockers"
- "Suggest resources"

### Project-Specific Actions
- "Generate project summary"
- "Draft client update"
- "Analyze project health"
- "Create milestone plan"

## OpenClaw Specialist Integration

### Available Specialists
The system can spawn these OpenClaw specialists:

1. **coding-agent** - Code development and debugging
2. **seo-agent** - SEO analysis and optimization
3. **deploy-agent** - Deployment and infrastructure
4. **email-agent** - Email campaigns and templates
5. **content-agent** - Content creation and editing
6. **research-agent** - Market and competitor research
7. **analytics-agent** - Data analysis and reporting

### Spawning Process
1. User requests specialist via AI chat
2. Hub creates tracking task
3. OpenClaw spawns specialist
4. Specialist work is tracked in Hub task
5. Results are saved to Hub

## Setup & Configuration

### 1. Environment Variables
```bash
# OpenClaw Gateway URL (default: localhost:18789)
OPENCLAW_URL=http://localhost:18789

# OpenClaw API Key (if required)
OPENCLAW_API_KEY=your_api_key_here
```

### 2. OpenClaw Gateway
Ensure OpenClaw is running:
```bash
openclaw gateway start
# Verify it's accessible at http://localhost:18789
```

### 3. Hub Integration
The integration is automatically enabled when:
- OpenClaw gateway is accessible
- `/api/openclaw/health` returns healthy status
- User has appropriate permissions

## Usage Examples

### Example 1: Asking AI about a Project
```javascript
// User in project page asks:
"What's the status of this project?"

// AI responds with context-aware answer:
"Project 'Website Redesign' for Acme Corp is ACTIVE with HEALTHY status.
There are 3 open tasks, 1 overdue. Last client communication was 2 days ago."
```

### Example 2: Spawning a Specialist
```javascript
// User asks:
"Can you help me debug this WordPress issue?"

// AI responds:
"I'll spawn a coding-agent specialist to help with this."

// Process:
1. Creates Hub task: "AI Specialist: coding-agent - WordPress debug"
2. Spawns OpenClaw coding-agent
3. Specialist analyzes and provides solution
4. Solution saved to Hub task
```

### Example 3: Quick Action
```javascript
// User clicks "Draft Update" button
// AI generates:
"Subject: Project Update - Website Redesign

Hi [Client],

Here's an update on the Website Redesign project..."

// User can copy, edit, or send directly
```

## Error Handling

### OpenClaw Unavailable
If OpenClaw gateway is unreachable:
- AI chat falls back to Hub's internal AI
- Specialist spawning is disabled
- User sees warning message
- Health check shows "unreachable"

### API Errors
- Errors are logged to AiTeamMessage with metadata
- User gets friendly error message
- Failed actions can be retried

## Security

### Authentication
- All OpenClaw routes require Hub authentication
- User context is passed to OpenClaw
- Session-based permissions are enforced

### Data Privacy
- Client/project data is only sent when relevant
- Sensitive data is not logged
- OpenClaw responses are stored in Hub database

## Monitoring

### Health Checks
- Automatic OpenClaw health monitoring
- Dashboard shows integration status
- Alerts if OpenClaw becomes unavailable

### Usage Analytics
- AI conversation logging
- Specialist spawn tracking
- Action completion rates
- Response time metrics

## Deployment

### Production
1. Build frontend: `npm run build`
2. Deploy backend to production server
3. Ensure OpenClaw gateway is running
4. Set environment variables
5. Run database migrations

### Development
1. Start Hub dev server: `npm run dev`
2. Start OpenClaw: `openclaw gateway start`
3. Access at `http://localhost:5173`

## Future Enhancements

### Planned Features
1. **Real-time updates** - Live specialist progress in Hub
2. **Two-way sync** - OpenClaw can trigger Hub actions
3. **Advanced context** - More detailed context injection
4. **Specialist marketplace** - Browse and select specialists
5. **Workflow automation** - AI-guided process automation

### Integration Points
1. **GitHub Actions** - Auto-deploy on specialist completion
2. **Notion** - Sync AI conversations to Notion
3. **Slack/Telegram** - Notifications for specialist results
4. **Stripe** - Auto-invoicing for specialist work

## Support & Troubleshooting

### Common Issues

#### OpenClaw Not Responding
1. Check if OpenClaw is running: `openclaw gateway status`
2. Verify port 18789 is accessible
3. Check OpenClaw logs

#### AI Not Understanding Context
1. Verify page context is being injected
2. Check browser console for errors
3. Ensure user is authenticated

#### Specialist Spawn Failing
1. Check OpenClaw specialist availability
2. Verify task creation permissions
3. Check database connection

### Getting Help
- Check Hub logs: `npm run logs`
- Check OpenClaw logs: `openclaw logs`
- Review API responses in browser dev tools
- Contact development team

## Conclusion

The OpenClaw integration transforms Agency Hub from a passive management tool into an active AI-powered assistant. By combining Hub's context awareness with OpenClaw's specialist capabilities, users get intelligent, actionable assistance for every aspect of agency operations.