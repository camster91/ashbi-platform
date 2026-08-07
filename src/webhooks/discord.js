// Discord webhook integration for Agency Hub events

const DISCORD_WEBHOOKS = Object.freeze({
  AGENCY_HUB: process.env.DISCORD_AGENCY_HUB_WEBHOOK_URL,
  DEPLOYMENTS: process.env.DISCORD_DEPLOYMENTS_WEBHOOK_URL,
  ALERTS: process.env.DISCORD_ALERTS_WEBHOOK_URL,
});

/**
 * Send a message to Discord via webhook
 */
export async function sendDiscordWebhook(webhookUrl, data) {
  if (!webhookUrl) {
    console.warn('Discord webhook is not configured; skipping notification');
    return { success: false, error: 'Discord webhook is not configured' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Discord webhook error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format project created notification for Discord
 */
export function formatProjectCreated(project, client) {
  return {
    embeds: [{
      title: "🚀 New Project Created",
      description: `**${project.name}** for ${client.name}`,
      color: 0x00d4aa, // Ashbi green
      fields: [
        {
          name: "Project ID",
          value: project.id,
          inline: true
        },
        {
          name: "Client",
          value: client.name,
          inline: true
        },
        {
          name: "Status",
          value: project.status || "STARTING_UP",
          inline: true
        },
        {
          name: "Description",
          value: project.description || "No description provided",
          inline: false
        }
      ],
      footer: {
        text: "Agency Hub",
        icon_url: "https://ashbi.ca/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1, // Action row
      components: [{
        type: 2, // Button
        style: 5, // Link button
        label: "View Project",
        url: `https://hub.ashbi.ca/projects/${project.id}`
      }]
    }]
  };
}

/**
 * Format task assigned notification for Discord
 */
export function formatTaskAssigned(task, user, project, client) {
  return {
    embeds: [{
      title: "📋 Task Assigned",
      description: `**${task.title}** assigned to ${user.name}`,
      color: 0x3b82f6, // Blue
      fields: [
        {
          name: "Project",
          value: project.name,
          inline: true
        },
        {
          name: "Client",
          value: client.name,
          inline: true
        },
        {
          name: "Priority",
          value: task.priority || "NORMAL",
          inline: true
        },
        {
          name: "Assignee",
          value: user.name,
          inline: true
        },
        {
          name: "Due Date",
          value: task.dueAt ? new Date(task.dueAt).toLocaleDateString('en-CA') : "No due date",
          inline: true
        },
        {
          name: "Status",
          value: task.status || "PENDING",
          inline: true
        }
      ],
      footer: {
        text: "Agency Hub",
        icon_url: "https://ashbi.ca/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * Format client message received notification for Discord
 */
export function formatClientMessage(thread, client, messageSummary) {
  return {
    embeds: [{
      title: "💬 New Client Message",
      description: `Message from **${client.name}**`,
      color: 0xf59e0b, // Yellow/orange
      fields: [
        {
          name: "Subject",
          value: thread.subject || "No subject",
          inline: false
        },
        {
          name: "Summary",
          value: messageSummary || "Message received - processing...",
          inline: false
        },
        {
          name: "Client",
          value: client.name,
          inline: true
        },
        {
          name: "Status",
          value: thread.status || "OPEN",
          inline: true
        }
      ],
      footer: {
        text: "Agency Hub",
        icon_url: "https://ashbi.ca/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1, // Action row
      components: [{
        type: 2, // Button
        style: 5, // Link button
        label: "View Thread",
        url: `https://hub.ashbi.ca/inbox/${thread.id}`
      }]
    }]
  };
}

/**
 * Format approval needed notification for Discord
 */
export function formatApprovalNeeded(response, thread, client) {
  return {
    embeds: [{
      title: "✅ Approval Needed",
      description: `Response draft ready for **${client.name}**`,
      color: 0xdc2626, // Red
      fields: [
        {
          name: "Subject",
          value: thread.subject || "No subject",
          inline: false
        },
        {
          name: "Client",
          value: client.name,
          inline: true
        },
        {
          name: "Thread Status",
          value: thread.status || "OPEN",
          inline: true
        },
        {
          name: "Draft Preview",
          value: response.content.substring(0, 200) + "...",
          inline: false
        }
      ],
      footer: {
        text: "Agency Hub - Awaiting Cameron's approval",
        icon_url: "https://ashbi.ca/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1, // Action row
      components: [
        {
          type: 2, // Button
          style: 3, // Green button
          label: "Approve & Send",
          custom_id: `approve_${response.id}`
        },
        {
          type: 2, // Button
          style: 4, // Red button
          label: "Reject",
          custom_id: `reject_${response.id}`
        },
        {
          type: 2, // Button
          style: 5, // Link button
          label: "Edit Response",
          url: `https://hub.ashbi.ca/inbox/${thread.id}`
        }
      ]
    }]
  };
}

/**
 * Format deployment notification for Discord
 */
export function formatDeployment(status, environment, commitHash, commitMessage) {
  const isSuccess = status === 'success';
  return {
    embeds: [{
      title: isSuccess ? "🚀 Deployment Successful" : "❌ Deployment Failed",
      description: `Agency Hub deployment to **${environment}**`,
      color: isSuccess ? 0x10b981 : 0xdc2626, // Green or red
      fields: [
        {
          name: "Environment",
          value: environment,
          inline: true
        },
        {
          name: "Status",
          value: status.toUpperCase(),
          inline: true
        },
        {
          name: "Commit",
          value: commitHash ? `\`${commitHash.substring(0, 8)}\`` : "Unknown",
          inline: true
        },
        {
          name: "Commit Message",
          value: commitMessage || "No message",
          inline: false
        }
      ],
      footer: {
        text: "GitHub Actions",
        icon_url: "https://github.com/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * Format alert notification for Discord
 */
export function formatAlert(type, message, severity = 'warning') {
  const colors = {
    error: 0xdc2626,   // Red
    warning: 0xf59e0b, // Yellow
    info: 0x3b82f6     // Blue
  };

  const emojis = {
    error: "🚨",
    warning: "⚠️",
    info: "ℹ️"
  };

  return {
    embeds: [{
      title: `${emojis[severity]} ${type}`,
      description: message,
      color: colors[severity] || colors.warning,
      footer: {
        text: "Agency Hub Monitoring",
        icon_url: "https://ashbi.ca/favicon.ico"
      },
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * Send notifications for different Hub events
 */
export const discordNotifications = {
  projectCreated: async (project, client) => {
    const message = formatProjectCreated(project, client);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.AGENCY_HUB, message);
  },

  taskAssigned: async (task, user, project, client) => {
    const message = formatTaskAssigned(task, user, project, client);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.AGENCY_HUB, message);
  },

  clientMessage: async (thread, client, messageSummary) => {
    const message = formatClientMessage(thread, client, messageSummary);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.AGENCY_HUB, message);
  },

  approvalNeeded: async (response, thread, client) => {
    const message = formatApprovalNeeded(response, thread, client);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.AGENCY_HUB, message);
  },

  deployment: async (status, environment, commitHash, commitMessage) => {
    const message = formatDeployment(status, environment, commitHash, commitMessage);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.DEPLOYMENTS, message);
  },

  alert: async (type, message, severity = 'warning') => {
    const alertMessage = formatAlert(type, message, severity);
    return await sendDiscordWebhook(DISCORD_WEBHOOKS.ALERTS, alertMessage);
  }
};
