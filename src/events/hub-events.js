// Event emitter system for Agency Hub
// Handles all internal events and triggers Discord/OpenClaw notifications

import { EventEmitter } from 'events';
import { discordNotifications } from '../webhooks/discord.js';
import { openclawNotifications } from '../webhooks/openclaw.js';

// Create a singleton event emitter for the entire Hub
export const hubEvents = new EventEmitter();

// Increase max listeners to handle many integrations
hubEvents.setMaxListeners(50);

/**
 * Event types that can be emitted
 */
export const EVENT_TYPES = {
  PROJECT_CREATED: 'project_created',
  PROJECT_UPDATED: 'project_updated', 
  TASK_CREATED: 'task_created',
  TASK_ASSIGNED: 'task_assigned',
  TASK_COMPLETED: 'task_completed',
  CLIENT_MESSAGE_RECEIVED: 'client_message_received',
  RESPONSE_DRAFT_READY: 'response_draft_ready',
  RESPONSE_APPROVED: 'response_approved',
  RESPONSE_SENT: 'response_sent',
  THREAD_CREATED: 'thread_created',
  THREAD_CLOSED: 'thread_closed',
  USER_ASSIGNED: 'user_assigned',
  DEADLINE_APPROACHING: 'deadline_approaching',
  HEALTH_CHECK_FAILED: 'health_check_failed',
  SYNC_ERROR: 'sync_error',
  DEPLOYMENT_SUCCESS: 'deployment_success',
  DEPLOYMENT_FAILED: 'deployment_failed',
  ALERT_TRIGGERED: 'alert_triggered'
};

/**
 * Setup all event listeners for Discord and OpenClaw notifications
 */
export function setupEventListeners() {
  console.log('🔗 Setting up Hub event listeners...');

  // Project events
  hubEvents.on(EVENT_TYPES.PROJECT_CREATED, async (data) => {
    console.log('📊 Event: Project created', data.project.name);
    
    // Send to Discord
    try {
      await discordNotifications.projectCreated(data.project, data.client);
    } catch (error) {
      console.error('Discord notification failed (project_created):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.projectCreated(data.project, data.client);
    } catch (error) {
      console.error('OpenClaw notification failed (project_created):', error);
    }

    // Real-time update to frontend via Socket.io
    if (data.io) {
      data.io.emit('project_created', {
        project: data.project,
        client: data.client
      });
    }
  });

  hubEvents.on(EVENT_TYPES.PROJECT_UPDATED, async (data) => {
    console.log('📊 Event: Project updated', data.project.name);
    
    // Only send notifications for significant changes (status, health)
    if (data.significantChange) {
      // Real-time update to frontend
      if (data.io) {
        data.io.emit('project_updated', {
          project: data.project,
          changes: data.changes
        });
      }
    }
  });

  // Task events
  hubEvents.on(EVENT_TYPES.TASK_ASSIGNED, async (data) => {
    console.log('📋 Event: Task assigned', data.task.title, '→', data.user.name);
    
    // Send to Discord
    try {
      await discordNotifications.taskAssigned(data.task, data.user, data.project, data.client);
    } catch (error) {
      console.error('Discord notification failed (task_assigned):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.taskAssigned(data.task, data.user, data.project, data.client);
    } catch (error) {
      console.error('OpenClaw notification failed (task_assigned):', error);
    }

    // Real-time update to frontend
    if (data.io) {
      data.io.emit('task_assigned', {
        task: data.task,
        user: data.user,
        project: data.project
      });
    }
  });

  hubEvents.on(EVENT_TYPES.TASK_COMPLETED, async (data) => {
    console.log('✅ Event: Task completed', data.task.title);
    
    // Real-time update to frontend
    if (data.io) {
      data.io.emit('task_completed', {
        task: data.task,
        project: data.project
      });
    }
  });

  // Message/Thread events
  hubEvents.on(EVENT_TYPES.CLIENT_MESSAGE_RECEIVED, async (data) => {
    console.log('💬 Event: Client message received from', data.client.name);
    
    // Send to Discord
    try {
      await discordNotifications.clientMessage(data.thread, data.client, data.summary);
    } catch (error) {
      console.error('Discord notification failed (client_message):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.clientMessage(data.thread, data.client, data.summary);
    } catch (error) {
      console.error('OpenClaw notification failed (client_message):', error);
    }

    // Real-time update to frontend
    if (data.io) {
      data.io.emit('message_received', {
        thread: data.thread,
        client: data.client,
        summary: data.summary
      });
    }
  });

  hubEvents.on(EVENT_TYPES.RESPONSE_DRAFT_READY, async (data) => {
    console.log('✅ Event: Response draft ready for approval');
    
    // Send to Discord (approvals channel)
    try {
      await discordNotifications.approvalNeeded(data.response, data.thread, data.client);
    } catch (error) {
      console.error('Discord notification failed (approval_needed):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.approvalNeeded(data.response, data.thread, data.client);
    } catch (error) {
      console.error('OpenClaw notification failed (approval_needed):', error);
    }

    // Real-time update to frontend
    if (data.io) {
      data.io.emit('approval_needed', {
        response: data.response,
        thread: data.thread,
        client: data.client
      });
    }
  });

  hubEvents.on(EVENT_TYPES.RESPONSE_SENT, async (data) => {
    console.log('📤 Event: Response sent to', data.client.name);
    
    // Real-time update to frontend
    if (data.io) {
      data.io.emit('response_sent', {
        response: data.response,
        thread: data.thread,
        client: data.client
      });
    }
  });

  // System events
  hubEvents.on(EVENT_TYPES.DEPLOYMENT_SUCCESS, async (data) => {
    console.log('🚀 Event: Deployment successful', data.environment);
    
    // Send to Discord
    try {
      await discordNotifications.deployment('success', data.environment, data.commitHash, data.commitMessage);
    } catch (error) {
      console.error('Discord notification failed (deployment):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.deployment('success', data.environment, data.commitHash, data.commitMessage);
    } catch (error) {
      console.error('OpenClaw notification failed (deployment):', error);
    }
  });

  hubEvents.on(EVENT_TYPES.DEPLOYMENT_FAILED, async (data) => {
    console.log('❌ Event: Deployment failed', data.environment);
    
    // Send to Discord
    try {
      await discordNotifications.deployment('failed', data.environment, data.commitHash, data.commitMessage);
    } catch (error) {
      console.error('Discord notification failed (deployment_failed):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.deployment('failed', data.environment, data.commitHash, data.commitMessage);
    } catch (error) {
      console.error('OpenClaw notification failed (deployment_failed):', error);
    }
  });

  hubEvents.on(EVENT_TYPES.ALERT_TRIGGERED, async (data) => {
    console.log('🚨 Event: Alert triggered', data.type, data.severity);
    
    // Send to Discord
    try {
      await discordNotifications.alert(data.type, data.message, data.severity);
    } catch (error) {
      console.error('Discord notification failed (alert):', error);
    }

    // Send to OpenClaw
    try {
      await openclawNotifications.alert(data.type, data.message, data.severity);
    } catch (error) {
      console.error('OpenClaw notification failed (alert):', error);
    }

    // Real-time update to frontend
    if (data.io) {
      data.io.emit('alert', {
        type: data.type,
        message: data.message,
        severity: data.severity
      });
    }
  });

  console.log('✅ Hub event listeners setup complete');
}

/**
 * Helper functions to emit events with proper data structure
 */
export const emitHubEvent = {
  projectCreated: (project, client, io = null) => {
    hubEvents.emit(EVENT_TYPES.PROJECT_CREATED, { project, client, io });
  },

  projectUpdated: (project, changes = {}, significantChange = false, io = null) => {
    hubEvents.emit(EVENT_TYPES.PROJECT_UPDATED, { project, changes, significantChange, io });
  },

  taskAssigned: (task, user, project, client, io = null) => {
    hubEvents.emit(EVENT_TYPES.TASK_ASSIGNED, { task, user, project, client, io });
  },

  taskCompleted: (task, project, io = null) => {
    hubEvents.emit(EVENT_TYPES.TASK_COMPLETED, { task, project, io });
  },

  clientMessageReceived: (thread, client, summary = null, io = null) => {
    hubEvents.emit(EVENT_TYPES.CLIENT_MESSAGE_RECEIVED, { thread, client, summary, io });
  },

  responseDraftReady: (response, thread, client, io = null) => {
    hubEvents.emit(EVENT_TYPES.RESPONSE_DRAFT_READY, { response, thread, client, io });
  },

  responseSent: (response, thread, client, io = null) => {
    hubEvents.emit(EVENT_TYPES.RESPONSE_SENT, { response, thread, client, io });
  },

  deploymentSuccess: (environment, commitHash = null, commitMessage = null) => {
    hubEvents.emit(EVENT_TYPES.DEPLOYMENT_SUCCESS, { environment, commitHash, commitMessage });
  },

  deploymentFailed: (environment, error, commitHash = null, commitMessage = null) => {
    hubEvents.emit(EVENT_TYPES.DEPLOYMENT_FAILED, { environment, error, commitHash, commitMessage });
  },

  alertTriggered: (type, message, severity = 'warning', io = null) => {
    hubEvents.emit(EVENT_TYPES.ALERT_TRIGGERED, { type, message, severity, io });
  }
};