# Agency Hub Integrations

## Discord & OpenClaw Sync Integration

Agency Hub now pushes real-time events and notifications to Discord channels and OpenClaw for unified visibility across Cameron's workflow.

## Event Schema

### Events Tracked
- **Project Events**: Created, Updated
- **Task Events**: Assigned, Completed
- **Client Communication**: Message received, Response draft ready, Response sent
- **System Events**: Deployments, Alerts, Health checks

### Discord Channels
- `#agency-hub` → Projects, Tasks, Client messages, Task assignments
- `#alerts` → Health check failures, sync errors, system alerts
- `#deployments` → Deployment success/failure notifications

### Event Data Structure
```javascript
{
  eventType: 'project_created',
  timestamp: '2026-03-20T16:50:00.000Z',
  data: {
    project: { /* Project object */ },
    client: { /* Client object */ },
    // Other relevant data
  },
  metadata: {
    source: 'agency-hub',
    triggeredBy: 'user_id' // Optional
  }
}
```

## Integration Files

### Core Components
- `src/webhooks/discord.js` — Discord webhook posting logic
- `src/webhooks/openclaw.js` — OpenClaw messaging logic  
- `src/events/hub-events.js` — Event emitter system
- `src/routes/webhook.routes.js` — External webhook endpoints

### Event Emitters Added To:
- `src/routes/project.routes.js` → Project creation
- `src/routes/task.routes.js` → Task assignment & completion
- `src/services/pipeline.service.js` → Client message processing, response drafts

## Webhook Endpoints

### Slack-compatible outbound notifications

Set `SLACK_AGENCY_HUB_WEBHOOK_URL` in the deployment secret store to receive
project, task, client-message, approval, deployment, and alert events through a
Slack incoming webhook. Delivery is optional and fail-closed: missing or failed
Slack delivery never blocks the Hub event or database workflow. Inbound Slack
channel sync remains a separate, unverified integration gate.

### GitHub Deployment Webhook
```
POST /api/webhooks/github/deployment
```
Receives GitHub Actions deployment status and pushes to Discord/OpenClaw.

### OpenClaw Command Webhook  
```
POST /api/webhooks/openclaw/command
```
Allows Cameron to control Hub via OpenClaw commands.

### Discord Interaction Webhook
```
POST /api/webhooks/discord/interaction
```
Handles Discord button clicks (approve/reject responses).

### Health Check Endpoint
```
GET /api/webhooks/health
```
Monitors Hub health and triggers alerts on failures.

## Real-time Updates

Socket.io events are emitted alongside webhook notifications:
- `project_created` 
- `task_assigned`
- `message_received`
- `approval_needed`
- `response_sent`
- `alert`

## Configuration

### Environment Variables
```bash
# OpenClaw Integration
OPENCLAW_URL=http://localhost:3000
OPENCLAW_API_KEY=your-api-key

# Webhook Security
WEBHOOK_SECRET=your-webhook-secret
```

### Discord Webhook URLs
Store Discord webhook URLs only in the deployment secret store and expose them
through `DISCORD_AGENCY_HUB_WEBHOOK_URL`, `DISCORD_DEPLOYMENTS_WEBHOOK_URL`,
`DISCORD_ALERTS_WEBHOOK_URL`, and `DISCORD_CAM_WEBHOOK_URL`. Notifications are
skipped safely when the corresponding variable is not configured.

## Testing

### Manual Test Commands
```javascript
// Test project creation event
emitHubEvent.projectCreated(project, client, io);

// Test task assignment
emitHubEvent.taskAssigned(task, user, project, client, io);

// Test alert
emitHubEvent.alertTriggered('Test Alert', 'Integration test message', 'info', io);
```

### Smoke Test Checklist
1. ✅ Create a project → Verify Discord notification
2. ✅ Assign a task → Verify Discord + OpenClaw notification  
3. ✅ Process client email → Verify message alerts
4. ✅ Generate response draft → Verify approval notification
5. ✅ Trigger deployment → Verify deployment status
6. ✅ Health check failure → Verify alert posting

## OpenClaw Commands

Available commands via `/api/webhooks/openclaw/command`:

- `sync_status` — Check sync health
- `create_project` — Create project from OpenClaw (planned)
- `assign_task` — Assign task from OpenClaw (planned)  
- `approve_response` — Approve response from OpenClaw (planned)

## Error Handling

- Failed Discord webhooks are logged but don't block Hub operations
- Failed OpenClaw messages are logged but don't block Hub operations
- Sync events are logged in OpenClaw history for audit trail
- Health checks monitor integration status

## Architecture

```
Agency Hub Events
       ↓
Hub Event Emitter (events/hub-events.js)
       ↓
   ┌─Discord──┐    ┌─OpenClaw─┐    ┌─Socket.io─┐
   │webhooks  │    │messaging │    │real-time │
   │/discord.js│    │/openclaw.js   │frontend  │
   └─────────┘    └─────────┘    └─────────┘
```

Events flow through the central emitter to maintain consistency and enable easy debugging/monitoring of all integrations.
