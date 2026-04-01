// OpenClaw messaging integration for Agency Hub events

/**
 * Send a message to OpenClaw
 * This assumes OpenClaw is running and has a message endpoint
 */
async function sendOpenClawMessage(channel, content, metadata = {}) {
  try {
    // For now, we'll use a simple HTTP POST to OpenClaw's message endpoint
    // This might need to be adjusted based on OpenClaw's actual API
    const openclawUrl = process.env.OPENCLAW_URL || 'http://localhost:3000';
    
    const payload = {
      channel: channel || 'agency-hub',
      content,
      metadata: {
        ...metadata,
        source: 'agency-hub',
        timestamp: new Date().toISOString()
      }
    };

    const response = await fetch(`${openclawUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENCLAW_API_KEY || ''}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenClaw message failed: ${response.status} ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    console.error('OpenClaw messaging error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Log sync events for audit trail
 */
async function logSyncEvent(eventType, data) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      data,
      source: 'agency-hub-sync'
    };

    console.log('Hub→OpenClaw Sync Event:', JSON.stringify(logEntry, null, 2));
    
    // Send to OpenClaw for persistent logging
    return await sendOpenClawMessage('sync-logs', 
      `📊 Hub Sync: ${eventType}`, 
      logEntry
    );
  } catch (error) {
    console.error('Sync event logging error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * OpenClaw notification handlers for different Hub events
 */
export const openclawNotifications = {
  projectCreated: async (project, client) => {
    const message = `🚀 **New Project Created**
**${project.name}** for ${client.name}
• Project ID: ${project.id}
• Status: ${project.status || 'STARTING_UP'}
• Description: ${project.description || 'No description provided'}

View: https://hub.ashbi.ca/projects/${project.id}`;

    const result = await sendOpenClawMessage('agency-hub', message, {
      eventType: 'project_created',
      projectId: project.id,
      clientId: client.id,
      projectName: project.name,
      clientName: client.name
    });

    await logSyncEvent('project_created', { project, client });
    return result;
  },

  taskAssigned: async (task, user, project, client) => {
    const message = `📋 **Task Assigned**
**${task.title}** → ${user.name}
• Project: ${project.name} (${client.name})
• Priority: ${task.priority || 'NORMAL'}
• Status: ${task.status || 'PENDING'}
• Due: ${task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No due date'}

View: https://hub.ashbi.ca/projects/${project.id}`;

    const result = await sendOpenClawMessage('agency-hub', message, {
      eventType: 'task_assigned',
      taskId: task.id,
      userId: user.id,
      projectId: project.id,
      clientId: client.id,
      taskTitle: task.title,
      assigneeName: user.name
    });

    await logSyncEvent('task_assigned', { task, user, project, client });
    return result;
  },

  clientMessage: async (thread, client, messageSummary) => {
    const message = `💬 **New Client Message**
From: **${client.name}**
Subject: ${thread.subject || 'No subject'}

Summary: ${messageSummary || 'Message received - processing...'}

View: https://hub.ashbi.ca/inbox/${thread.id}`;

    const result = await sendOpenClawMessage('agency-hub', message, {
      eventType: 'client_message',
      threadId: thread.id,
      clientId: client.id,
      subject: thread.subject,
      summary: messageSummary
    });

    await logSyncEvent('client_message', { thread, client, messageSummary });
    return result;
  },

  approvalNeeded: async (response, thread, client) => {
    const preview = response.content.substring(0, 150) + (response.content.length > 150 ? '...' : '');
    
    const message = `✅ **Approval Needed**
Response draft ready for **${client.name}**
Subject: ${thread.subject || 'No subject'}

Preview: "${preview}"

Cameron: Review and approve at https://hub.ashbi.ca/inbox/${thread.id}`;

    const result = await sendOpenClawMessage('agency-hub', message, {
      eventType: 'approval_needed',
      responseId: response.id,
      threadId: thread.id,
      clientId: client.id,
      preview,
      needsApproval: true
    });

    await logSyncEvent('approval_needed', { response, thread, client });
    return result;
  },

  deployment: async (status, environment, commitHash, commitMessage) => {
    const emoji = status === 'success' ? '🚀' : '❌';
    const message = `${emoji} **Deployment ${status.toUpperCase()}**
Agency Hub → ${environment}
• Commit: ${commitHash ? commitHash.substring(0, 8) : 'Unknown'}
• Message: ${commitMessage || 'No message'}
• Time: ${new Date().toLocaleString()}`;

    const result = await sendOpenClawMessage('deployments', message, {
      eventType: 'deployment',
      status,
      environment,
      commitHash,
      commitMessage
    });

    await logSyncEvent('deployment', { status, environment, commitHash, commitMessage });
    return result;
  },

  alert: async (type, alertMessage, severity = 'warning') => {
    const emojis = {
      error: '🚨',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const message = `${emojis[severity]} **${type}**
${alertMessage}

Source: Agency Hub Monitoring
Time: ${new Date().toLocaleString()}`;

    const result = await sendOpenClawMessage('alerts', message, {
      eventType: 'alert',
      alertType: type,
      severity,
      message: alertMessage
    });

    await logSyncEvent('alert', { type, message: alertMessage, severity });
    return result;
  },

  syncStatus: async () => {
    const message = `📊 **Hub→OpenClaw Sync Status**
Status: ✅ Active
Last sync: ${new Date().toLocaleString()}
Events tracked: Projects, Tasks, Messages, Approvals, Deployments, Alerts`;

    return await sendOpenClawMessage('sync-logs', message, {
      eventType: 'sync_status',
      active: true,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Handle commands from OpenClaw to control Hub
 */
export async function handleOpenClawCommand(command, params) {
  try {
    switch (command) {
      case 'create_project':
        // Cameron could create projects via OpenClaw
        // This would integrate with the project creation pipeline
        return { success: false, error: 'Command not implemented yet' };
        
      case 'assign_task':
        // Cameron could assign tasks via OpenClaw
        return { success: false, error: 'Command not implemented yet' };
        
      case 'approve_response':
        // Cameron could approve responses via OpenClaw
        return { success: false, error: 'Command not implemented yet' };
        
      case 'sync_status':
        return await openclawNotifications.syncStatus();
        
      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  } catch (error) {
    console.error('OpenClaw command error:', error);
    return { success: false, error: error.message };
  }
}

export { logSyncEvent };