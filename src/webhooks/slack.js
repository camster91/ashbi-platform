// Optional Slack-compatible incoming webhook integration.
// No credentials are required unless SLACK_AGENCY_HUB_WEBHOOK_URL is configured.

const SLACK_WEBHOOK_URL = process.env.SLACK_AGENCY_HUB_WEBHOOK_URL;

function value(input, fallback = 'Unknown') {
  return String(input ?? fallback).slice(0, 500);
}

export async function sendSlackWebhook(payload, webhookUrl = SLACK_WEBHOOK_URL) {
  if (!webhookUrl) {
    return { success: false, skipped: true, error: 'Slack webhook is not configured' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    return { success: true };
  } catch (error) {
    console.error('Slack webhook error:', error);
    return { success: false, error: error.message };
  }
}

export function formatSlackEvent(title, fields = {}, url = null) {
  const lines = [`*${value(title)}*`];
  for (const [label, fieldValue] of Object.entries(fields)) {
    lines.push(`*${value(label)}:* ${value(fieldValue)}`);
  }
  if (url) lines.push(`<${value(url)}|Open in Ashbi>`);
  return { text: lines.join('\n') };
}

export const slackNotifications = Object.freeze({
  projectCreated: (project, client) => sendSlackWebhook(formatSlackEvent(
    'New project created',
    { Project: project?.name, Client: client?.name, Status: project?.status },
    `https://hub.ashbi.ca/projects/${project?.id}`,
  )),
  taskAssigned: (task, user, project, client) => sendSlackWebhook(formatSlackEvent(
    'Task assigned',
    { Task: task?.title, Assignee: user?.name, Project: project?.name, Client: client?.name },
    `https://hub.ashbi.ca/projects/${project?.id}`,
  )),
  clientMessage: (thread, client, summary) => sendSlackWebhook(formatSlackEvent(
    'Client message received',
    { Client: client?.name, Subject: thread?.subject, Summary: summary || 'Open the thread for details' },
    `https://hub.ashbi.ca/inbox/${thread?.id}`,
  )),
  approvalNeeded: (response, thread, client) => sendSlackWebhook(formatSlackEvent(
    'Response approval needed',
    { Client: client?.name, Subject: thread?.subject, Status: response?.status || 'PENDING_APPROVAL' },
    `https://hub.ashbi.ca/inbox/${thread?.id}`,
  )),
  deployment: (status, environment, commitHash) => sendSlackWebhook(formatSlackEvent(
    `Deployment ${status}`,
    { Environment: environment, Revision: commitHash },
    'https://hub.ashbi.ca',
  )),
  alert: (type, message, severity) => sendSlackWebhook(formatSlackEvent(
    `Alert: ${type}`,
    { Severity: severity, Message: message },
    'https://hub.ashbi.ca/notifications',
  )),
});
