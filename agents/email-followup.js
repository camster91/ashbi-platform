#!/usr/bin/env node

/**
 * Email Follow-up Agent
 * 
 * Checks Gmail for "needs_reply" label and sends contextual follow-ups:
 * - Overdue invoices: payment reminder
 * - Old proposals: check-in message
 * - Active projects: status update
 * 
 * Triggered daily at 5pm, removes label after sending
 * Config: Set MAILGUN_API_KEY and MAILGUN_DOMAIN in .env
 */

const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
  MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN || 'ashbi.ca',
  SENDER_EMAIL: 'cameron@ashbi.ca',
  SENDER_NAME: 'Cameron A — Ashbi Design',
  LABEL_NEEDS_REPLY: 'needs_reply',
};

const LOG_FILE = path.join(__dirname, '../memory/email-agent-log.txt');

function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${level}: ${msg}\n`;
  console.log(logEntry);
  fs.appendFileSync(LOG_FILE, logEntry, { flag: 'a' });
}

/**
 * Email Templates
 */
const EMAIL_TEMPLATES = {
  INVOICE_REMINDER: {
    subject: 'Quick follow-up on outstanding invoice',
    template: (data) => `Hi ${data.clientName},

Just following up on the invoice we sent on ${data.invoiceDate}.

Amount due: **${data.amount}**  
Invoice #: ${data.invoiceId}

Please let me know if you have any questions or need us to resend the invoice.

Thanks!

Cameron  
Ashbi Design  
cameron@ashbi.ca  
ashbi.ca`,
  },

  PROPOSAL_CHECKIN: {
    subject: 'Checking in on the proposal we shared',
    template: (data) => `Hi ${data.clientName},

I wanted to check in on the proposal we sent on ${data.proposalDate} for the "${data.projectName}" project.

Do you have any questions about the scope or timeline? Happy to jump on a call if that would help.

Looking forward to working with you!

Cameron  
Ashbi Design  
cameron@ashbi.ca  
ashbi.ca`,
  },

  PROJECT_STATUS_UPDATE: {
    subject: 'Status update: Your Project',
    template: (data) => `Hi ${data.clientName},

Just wanted to give you a quick status update on your project:

**Last Update:** ${data.lastUpdate}  
**Current Status:** ${data.status}  
**Next Steps:** ${data.nextSteps}

Let me know if you have any questions or feedback!

Cameron  
Ashbi Design  
cameron@ashbi.ca  
ashbi.ca`,
  },
};

/**
 * Initialize Gmail API client
 */
async function initGmailClient(auth) {
  return google.gmail({ version: 'v1', auth });
}

/**
 * Get Gmail messages with "needs_reply" label
 */
async function getMessagesWithLabel(gmail, labelName) {
  try {
    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const label = labelsRes.data.labels?.find(l => l.name === labelName);

    if (!label) {
      log(`Label "${labelName}" not found`, 'WARN');
      return [];
    }

    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      q: `label:${label.id}`,
      maxResults: 20,
    });

    if (!messagesRes.data.messages) {
      log(`No messages found with label "${labelName}"`);
      return [];
    }

    log(`Found ${messagesRes.data.messages.length} messages with label "${labelName}"`);

    const messages = [];
    for (const msg of messagesRes.data.messages) {
      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });
      messages.push(fullMsg.data);
    }

    return messages;
  } catch (error) {
    log(`Error fetching Gmail messages: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Extract sender and context from email
 */
function parseEmailContext(message) {
  const headers = message.payload?.headers || [];
  const fromHeader = headers.find(h => h.name === 'From');
  const subjectHeader = headers.find(h => h.name === 'Subject');
  const bodyPart = message.payload?.parts?.[0] || message.payload;
  const bodyData = bodyPart?.body?.data || '';
  const body = Buffer.from(bodyData, 'base64').toString('utf-8');

  return {
    messageId: message.id,
    from: fromHeader?.value || 'Unknown',
    subject: subjectHeader?.value || 'No Subject',
    body: body.substring(0, 500),
    timestamp: new Date(parseInt(message.internalDate)).toISOString(),
  };
}

/**
 * Classify email and determine response template
 */
function classifyEmail(context) {
  const subject = context.subject.toLowerCase();
  const body = context.body.toLowerCase();

  if (subject.includes('invoice') || subject.includes('payment') || body.includes('amount due')) {
    return 'INVOICE_REMINDER';
  } else if (subject.includes('proposal') || subject.includes('quote')) {
    return 'PROPOSAL_CHECKIN';
  } else if (subject.includes('project') || subject.includes('update') || subject.includes('progress')) {
    return 'PROJECT_STATUS_UPDATE';
  }

  return 'PROJECT_STATUS_UPDATE';
}

/**
 * Send email via Mailgun
 */
async function sendEmail(to, subject, body) {
  try {
    const auth = Buffer.from(`api:${CONFIG.MAILGUN_API_KEY}`).toString('base64');

    const response = await fetch(`https://api.mailgun.net/v3/${CONFIG.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        from: `${CONFIG.SENDER_NAME} <${CONFIG.SENDER_EMAIL}>`,
        to: to,
        subject: subject,
        text: body,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mailgun failed: ${response.status}`);
    }

    const data = await response.json();
    log(`✅ Email sent to ${to}: "${subject}"`);
    return data;
  } catch (error) {
    log(`Error sending email to ${to}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Remove label from message
 */
async function removeLabelFromMessage(gmail, messageId, labelId) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [labelId],
      },
    });
    log(`✅ Removed label from message ${messageId}`);
  } catch (error) {
    log(`Error removing label: ${error.message}`, 'WARN');
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    log('🚀 Email Follow-up Agent started');
    log('📧 Email Follow-up Agent ready (OAuth setup required for production)');
    log('Note: Setup Gmail API credentials in ~/.credentials/gmail-oauth.json');
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    log(`Uncaught error: ${error.message}`, 'ERROR');
    process.exit(1);
  });
}

module.exports = { sendEmail, classifyEmail, EMAIL_TEMPLATES };
