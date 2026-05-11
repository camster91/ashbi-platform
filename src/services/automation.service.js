// Workflow Automations Engine
// Handles trigger-action automations for invoices, proposals, and contracts

import prisma from '../config/db.js';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import crypto from 'crypto';

// ==================== EMAIL HELPER ====================

async function sendEmail(to, subject, html) {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    console.log(`[Automation] Email not configured — would send to ${to}: ${subject}`);
    return false;
  }

  try {
    const mg = new Mailgun(FormData);
    const client = mg.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY
    });

    await client.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `Ashbi Design <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to,
      subject,
      html
    });

    console.log(`[Automation] Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Automation] Failed to send email to ${to}:`, err.message);
    return false;
  }
}

// ==================== NOTIFICATION HELPER ====================

async function createAdminNotification(type, title, message, data = null) {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  if (!admin) {
    console.warn('[Automation] No admin user found for notification');
    return null;
  }

  return prisma.notification.create({
    data: {
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : null,
      userId: admin.id
    }
  });
}

// ==================== ACTIVITY LOG HELPER ====================

async function logAutomation(type, action, entityType, entityId, entityName, metadata = {}) {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  if (!admin) return null;

  return prisma.activity.create({
    data: {
      type,
      action,
      entityType,
      entityId,
      entityName,
      metadata: JSON.stringify({ ...metadata, automatedBy: 'WORKFLOW_ENGINE' }),
      userId: admin.id
    }
  });
}

// ==================== CLIENT EMAIL HELPER ====================

async function getClientEmail(clientId) {
  // Try primary contact first, then any contact
  const contact = await prisma.contact.findFirst({
    where: { clientId },
    orderBy: { isPrimary: 'desc' },
    select: { email: true, name: true }
  });

  return contact;
}

// ==================== TRIGGER: PROPOSAL APPROVED ====================

export async function onProposalApproved(proposalId) {
  console.log(`[Automation] Proposal approved: ${proposalId}`);

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        client: { select: { id: true, name: true } },
        lineItems: true,
        createdBy: { select: { id: true, name: true } }
      }
    });

    if (!proposal) {
      console.error(`[Automation] Proposal ${proposalId} not found`);
      return;
    }

    // Action 1: Auto-create contract from proposal
    const scopeLines = proposal.lineItems.map(li =>
      `- ${li.description} (${li.quantity} x $${li.unitPrice.toFixed(2)})`
    ).join('\n');

    const contractContent = `
      <h1>${proposal.title}</h1>
      <h2>Scope of Work</h2>
      <p>This contract covers the following deliverables as outlined in the approved proposal:</p>
      <ul>
        ${proposal.lineItems.map(li =>
          `<li><strong>${li.description}</strong> — ${li.quantity} x $${li.unitPrice.toFixed(2)} = $${li.total.toFixed(2)}</li>`
        ).join('\n')}
      </ul>
      <h2>Total</h2>
      <p><strong>$${proposal.total.toFixed(2)}</strong></p>
      <h2>Terms</h2>
      <p>By signing below, the client agrees to the scope and pricing outlined above.</p>
    `.trim();

    const contract = await prisma.contract.create({
      data: {
        title: `Contract: ${proposal.title}`,
        status: 'DRAFT',
        content: contractContent,
        templateType: 'PROJECT',
        signToken: crypto.randomUUID(),
        proposalId: proposal.id,
        clientId: proposal.clientId,
        createdById: proposal.createdById
      }
    });

    console.log(`[Automation] Contract created: ${contract.id} from proposal ${proposalId}`);

    // Action 2: Auto-create pipeline deal from approved proposal
    try {
      // Find the first pipeline stage (usually "New" or similar)
      const defaultStage = await prisma.pipelineStage.findFirst({
        orderBy: { order: 'asc' },
        select: { id: true }
      });

      if (defaultStage) {
        const deal = await prisma.pipelineDeal.create({
          data: {
            title: proposal.title,
            value: proposal.total,
            clientId: proposal.clientId,
            stageId: defaultStage.id,
            probability: 100, // Won
            expectedCloseDate: new Date(),
            notes: `Auto-created from approved proposal ${proposalId}`
          }
        });
        console.log(`[Automation] Pipeline deal created: ${deal.id} from proposal ${proposalId}`);
      }
    } catch (dealErr) {
      console.error(`[Automation] Could not create pipeline deal:`, dealErr.message);
    }

    // Action 3: Create notification for admin
    await createAdminNotification(
      'PROPOSAL_APPROVED',
      'Proposal Approved',
      `"${proposal.title}" for ${proposal.client.name} was approved. A draft contract has been auto-created.`,
      { proposalId, contractId: contract.id, clientName: proposal.client.name }
    );

    // Log activity
    await logAutomation(
      'AUTOMATION_RAN',
      'created',
      'CONTRACT',
      contract.id,
      contract.title,
      { trigger: 'PROPOSAL_APPROVED', proposalId, proposalTitle: proposal.title }
    );

  } catch (err) {
    console.error(`[Automation] onProposalApproved failed:`, err);
  }
}

// ==================== TRIGGER: CONTRACT SIGNED ====================

export async function onContractSigned(contractId) {
  console.log(`[Automation] Contract signed: ${contractId}`);

  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        client: { select: { id: true, name: true } },
        proposal: { select: { id: true, title: true, total: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    if (!contract) {
      console.error(`[Automation] Contract ${contractId} not found`);
      return;
    }

    // Action 1: Auto-create project linked to contract's client
    const projectName = contract.proposal?.title || contract.title.replace('Contract: ', '');

    const project = await prisma.project.create({
      data: {
        name: projectName,
        description: `Auto-created from signed contract: ${contract.title}`,
        status: 'STARTING_UP',
        health: 'ON_TRACK',
        clientId: contract.clientId
      }
    });

    console.log(`[Automation] Project created: ${project.id} from contract ${contractId}`);

    // Action 2: Send welcome email to client
    const contact = await getClientEmail(contract.clientId);
    if (contact) {
      const hubUrl = process.env.HUB_URL || 'https://hub.ashbi.ca';
      await sendEmail(
        contact.email,
        `Welcome! Your project "${projectName}" is underway - Ashbi Design`,
        `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">Welcome aboard, ${contact.name || contract.client.name}!</h2>
            <p>Great news — your contract for <strong>${contract.title}</strong> has been signed and your project is now officially underway.</p>
            <p>Here's what happens next:</p>
            <ul>
              <li>Your project <strong>"${projectName}"</strong> has been created in our system</li>
              <li>Our team will reach out shortly with next steps and a kickoff plan</li>
              <li>You'll receive access to your client portal where you can track progress</li>
            </ul>
            <p style="margin-top: 24px;">
              <a href="${hubUrl}" style="background-color: #c9a84c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Visit Portal</a>
            </p>
            <p style="color: #666; font-size: 14px; margin-top: 32px;">
              If you have any questions, just reply to this email.<br/>
              — The Ashbi Design Team
            </p>
          </div>
        `
      );
    }

    // Action 3: Create notification for admin
    await createAdminNotification(
      'CONTRACT_SIGNED',
      'Contract Signed',
      `${contract.client.name} signed "${contract.title}". Project "${projectName}" auto-created.`,
      { contractId, projectId: project.id, clientName: contract.client.name }
    );

    // Log activity
    await logAutomation(
      'AUTOMATION_RAN',
      'created',
      'PROJECT',
      project.id,
      project.name,
      { trigger: 'CONTRACT_SIGNED', contractId, contractTitle: contract.title }
    );

  } catch (err) {
    console.error(`[Automation] onContractSigned failed:`, err);
  }
}

// ==================== TRIGGER: CHECK OVERDUE INVOICES ====================

export async function checkOverdueInvoices() {
  console.log(`[Automation] Checking overdue invoices...`);

  try {
    const now = new Date();

    // Find invoices that are SENT and past dueDate
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: 'SENT',
        dueDate: { lt: now }
      },
      include: {
        client: { select: { id: true, name: true, relationshipStatus: true } }
      }
    });

    if (overdueInvoices.length === 0) {
      console.log(`[Automation] No overdue invoices found`);
      return;
    }

    console.log(`[Automation] Found ${overdueInvoices.length} overdue invoice(s)`);

    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.floor((now - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24));
      const hubUrl = process.env.HUB_URL || 'https://hub.ashbi.ca';
      const portalLink = invoice.viewToken
        ? `${hubUrl}/portal/invoice/${invoice.viewToken}`
        : null;

      // Mark as OVERDUE
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'OVERDUE' }
      });

      const contact = await getClientEmail(invoice.clientId);

      if (daysOverdue >= 7) {
        // ==================== INVOICE_OVERDUE_7D ====================
        // Only escalate if we haven't already (check reminderSentAt as a flag)
        const reminderSent = invoice.reminderSentAt;
        const reminderDate = reminderSent ? new Date(reminderSent) : null;
        const alreadyEscalated = reminderDate && (now - reminderDate) > (6 * 24 * 60 * 60 * 1000);

        // Action 1: Send escalation email
        if (contact) {
          await sendEmail(
            contact.email,
            `URGENT: Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue`,
            `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc2626;">Payment Overdue — Immediate Attention Required</h2>
                <p>Dear ${contact.name || invoice.client.name},</p>
                <p>Invoice <strong>${invoice.invoiceNumber}</strong>${invoice.title ? ` (${invoice.title})` : ''} for <strong>$${invoice.total.toFixed(2)}</strong> was due on <strong>${new Date(invoice.dueDate).toLocaleDateString('en-CA')}</strong> and is now <strong>${daysOverdue} days overdue</strong>.</p>
                <p>Please arrange payment at your earliest convenience to avoid any disruption to ongoing work.</p>
                ${portalLink ? `
                  <p style="margin-top: 24px;">
                    <a href="${portalLink}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Pay Now</a>
                  </p>
                ` : ''}
                <p style="color: #666; font-size: 14px; margin-top: 32px;">
                  If you've already sent payment, please disregard this notice.<br/>
                  — Ashbi Design
                </p>
              </div>
            `
          );
        }

        // Action 2: Flag client health as AT_RISK
        // Update client's payment status
        await prisma.client.update({
          where: { id: invoice.clientId },
          data: { paymentStatus: 'AT_RISK' }
        });

        // Notify admin
        await createAdminNotification(
          'INVOICE_OVERDUE_7D',
          `Invoice ${daysOverdue}+ Days Overdue`,
          `${invoice.invoiceNumber} for ${invoice.client.name} ($${invoice.total.toFixed(2)}) is ${daysOverdue} days overdue. Client flagged as AT_RISK.`,
          { invoiceId: invoice.id, daysOverdue, clientId: invoice.clientId }
        );

        await logAutomation(
          'AUTOMATION_RAN',
          'escalated',
          'INVOICE',
          invoice.id,
          invoice.invoiceNumber,
          { trigger: 'INVOICE_OVERDUE_7D', daysOverdue, clientName: invoice.client.name }
        );

      } else {
        // ==================== INVOICE_OVERDUE (just became overdue) ====================
        // Only send reminder if we haven't recently
        if (!invoice.reminderSentAt) {
          // Action 1: Send reminder email
          if (contact) {
            await sendEmail(
              contact.email,
              `Friendly Reminder: Invoice ${invoice.invoiceNumber} is past due`,
              `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1a1a2e;">Payment Reminder</h2>
                  <p>Dear ${contact.name || invoice.client.name},</p>
                  <p>This is a friendly reminder that invoice <strong>${invoice.invoiceNumber}</strong>${invoice.title ? ` (${invoice.title})` : ''} for <strong>$${invoice.total.toFixed(2)}</strong> was due on <strong>${new Date(invoice.dueDate).toLocaleDateString('en-CA')}</strong>.</p>
                  <p>If you've already sent payment, thank you! Otherwise, we'd appreciate it if you could arrange payment at your convenience.</p>
                  ${portalLink ? `
                    <p style="margin-top: 24px;">
                      <a href="${portalLink}" style="background-color: #c9a84c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">View & Pay Invoice</a>
                    </p>
                  ` : ''}
                  <p style="color: #666; font-size: 14px; margin-top: 32px;">
                    Questions? Just reply to this email.<br/>
                    — Ashbi Design
                  </p>
                </div>
              `
            );
          }

          // Mark reminder as sent
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { reminderSentAt: now }
          });

          // Action 2: Notify admin
          await createAdminNotification(
            'INVOICE_OVERDUE',
            'Invoice Overdue',
            `${invoice.invoiceNumber} for ${invoice.client.name} ($${invoice.total.toFixed(2)}) is now overdue. Reminder sent.`,
            { invoiceId: invoice.id, daysOverdue, clientId: invoice.clientId }
          );

          await logAutomation(
            'AUTOMATION_RAN',
            'reminded',
            'INVOICE',
            invoice.id,
            invoice.invoiceNumber,
            { trigger: 'INVOICE_OVERDUE', daysOverdue, clientName: invoice.client.name }
          );
        }
      }
    }

    console.log(`[Automation] Overdue invoice check complete`);
  } catch (err) {
    console.error(`[Automation] checkOverdueInvoices failed:`, err);
  }
}

// ==================== WORKFLOW ENGINE ====================

export async function executeWorkflow(workflow, triggerData = {}) {
  const { id: workflowId, name, actions, triggerType, triggerConfig } = workflow;
  const runId = crypto.randomUUID();
  let status = 'SUCCESS';
  let error = null;
  const results = [];

  console.log(`[Workflow] Starting execution: ${name} (${workflowId})`);

  // Create run record
  const run = await prisma.workflowRun.create({
    data: {
      id: runId,
      workflowId,
      status: 'RUNNING',
      triggerData
    }
  });

  try {
    // Execute each action sequentially
    for (const action of actions) {
      try {
        const result = await executeAction(action, triggerData, workflow);
        results.push({ action: action.type, success: true, result });
      } catch (err) {
        console.error(`[Workflow] Action ${action.type} failed:`, err);
        results.push({ action: action.type, success: false, error: err.message });
        status = 'PARTIAL';
        error = err.message;
      }
    }

    // Update workflow stats
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        lastRun: new Date(),
        lastStatus: status,
        lastError: error,
        runCount: { increment: 1 }
      }
    });

  } catch (err) {
    console.error(`[Workflow] Execution failed: ${name}`, err);
    status = 'FAILED';
    error = err.message;
  }

  // Complete the run record
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      error,
      resultData: { results }
    }
  });

  console.log(`[Workflow] Completed: ${name} - ${status}`);

  return { runId, status, results, error };
}

// ==================== ACTION EXECUTORS ====================

async function executeAction(action, triggerData, workflow) {
  const { type, config } = action;

  switch (type) {
    case 'SEND_EMAIL':
      return executeSendEmail(config, triggerData);
    case 'CREATE_TASK':
      return executeCreateTask(config, triggerData);
    case 'SEND_TELEGRAM':
      return executeSendTelegram(config, triggerData);
    case 'UPDATE_DEAL_STAGE':
      return executeUpdateDealStage(config, triggerData);
    case 'WEBHOOK_CALL':
      return executeWebhookCall(config, triggerData);
    case 'CONDITION':
      return executeCondition(config, triggerData);
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

async function executeSendEmail(config, triggerData) {
  const { to, subject, body, from } = config;

  // Resolve template variables
  const resolvedTo = resolveTemplate(to, triggerData);
  const resolvedSubject = resolveTemplate(subject, triggerData);
  const resolvedBody = resolveTemplate(body, triggerData);

  if (!resolvedTo || !resolvedSubject) {
    throw new Error('SEND_EMAIL requires "to" and "subject" config');
  }

  // If email is configured, send it
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
    return sendEmail(resolvedTo, resolvedSubject, resolvedBody);
  }

  // Otherwise just log
  console.log(`[Workflow] Would send email to ${resolvedTo}: ${resolvedSubject}`);
  return { simulated: true, to: resolvedTo, subject: resolvedSubject };
}

async function executeCreateTask(config, triggerData) {
  const { title, description, projectId, assigneeId, priority = 'NORMAL' } = config;

  const resolvedTitle = resolveTemplate(title, triggerData);
  const resolvedDesc = resolveTemplate(description || '', triggerData);

  // If projectId is a template like {{clientId}}, resolve it
  let resolvedProjectId = resolveTemplate(projectId, triggerData);
  let resolvedAssigneeId = resolveTemplate(assigneeId, triggerData);

  // Validate project exists
  const project = resolvedProjectId ? await prisma.project.findUnique({ where: { id: resolvedProjectId } }) : null;
  if (!project && resolvedProjectId) {
    throw new Error(`Project ${resolvedProjectId} not found`);
  }

  const task = await prisma.task.create({
    data: {
      title: resolvedTitle,
      description: resolvedDesc,
      status: 'PENDING',
      priority,
      projectId: resolvedProjectId || 'unknown',
      assigneeId: resolvedAssigneeId || null
    }
  });

  await logAutomation('WORKFLOW_ACTION', 'created', 'TASK', task.id, task.title,
    { workflowName: workflow.name, actionType: 'CREATE_TASK' });

  return { taskId: task.id, title: task.title };
}

async function executeSendTelegram(config, triggerData) {
  const { chatId, message } = config;

  const resolvedChatId = resolveTemplate(chatId, triggerData);
  const resolvedMessage = resolveTemplate(message, triggerData);

  if (!resolvedChatId || !resolvedMessage) {
    throw new Error('SEND_TELEGRAM requires "chatId" and "message" config');
  }

  // Check if Telegram bot is configured
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`[Workflow] Would send Telegram to ${resolvedChatId}: ${resolvedMessage}`);
    return { simulated: true, chatId: resolvedChatId, message: resolvedMessage };
  }

  // Send via Telegram API
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: resolvedChatId,
      text: resolvedMessage,
      parse_mode: 'HTML'
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.statusText}`);
  }

  const data = await response.json();
  return { messageId: data.result.message_id };
}

async function executeUpdateDealStage(config, triggerData) {
  const { dealId, stage } = config;

  const resolvedDealId = resolveTemplate(dealId, triggerData);
  const resolvedStage = resolveTemplate(stage, triggerData);

  if (!resolvedDealId || !resolvedStage) {
    throw new Error('UPDATE_DEAL_STAGE requires "dealId" and "stage" config');
  }

  // Update pipeline deal stage
  const deal = await prisma.pipelineDeal.update({
    where: { id: resolvedDealId },
    data: { stage: resolvedStage }
  });

  await logAutomation('WORKFLOW_ACTION', 'updated', 'PIPELINE_DEAL', deal.id, deal.title,
    { workflowName: workflow.name, newStage: resolvedStage });

  return { dealId: deal.id, newStage: resolvedStage };
}

async function executeWebhookCall(config, triggerData) {
  const { url, method = 'POST', headers = {}, body } = config;

  const resolvedUrl = resolveTemplate(url, triggerData);
  const resolvedBody = resolveTemplate(body || '{}', triggerData);

  const response = await fetch(resolvedUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: resolvedBody
  });

  if (!response.ok) {
    throw new Error(`Webhook call failed: ${response.statusText}`);
  }

  const data = await response.json().catch(() => null);
  return { success: true, statusCode: response.status, response: data };
}

async function executeCondition(config, triggerData) {
  // Condition actions are evaluated against triggerData
  // If condition is met, subsequent actions proceed
  // This is a simple key-value check for now
  const { field, operator, value } = config;

  const fieldValue = getNestedValue(triggerData, field);
  let result = false;

  switch (operator) {
    case 'equals':
      result = fieldValue == value;
      break;
    case 'not_equals':
      result = fieldValue != value;
      break;
    case 'contains':
      result = String(fieldValue).includes(value);
      break;
    case 'greater_than':
      result = Number(fieldValue) > Number(value);
      break;
    case 'less_than':
      result = Number(fieldValue) < Number(value);
      break;
    case 'exists':
      result = fieldValue !== undefined && fieldValue !== null;
      break;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }

  console.log(`[Workflow] Condition: ${field} ${operator} ${value} => ${result}`);
  return { conditionMet: result, field, operator, value };
}

// ==================== HELPERS ====================

function resolveTemplate(template, data) {
  if (typeof template !== 'string') return template;

  // Replace {{field.path}} with data values
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(data, path.trim());
    return value !== undefined ? value : match;
  });
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

// ==================== SCHEDULE CHECKER ====================

let scheduleInterval = null;

export function startScheduleChecker() {
  // Run every minute to check scheduled workflows
  scheduleInterval = setInterval(async () => {
    try {
      const now = new Date();

      // Find enabled SCHEDULE workflows
      const workflows = await prisma.workflow.findMany({
        where: {
          triggerType: 'SCHEDULE',
          enabled: true
        }
      });

      for (const workflow of workflows) {
        const { cronExpression, lastChecked } = workflow.triggerConfig;

        // Simple cron check - supports basic expressions like "*/5 * * * *"
        if (shouldRunNow(cronExpression, lastChecked ? new Date(lastChecked) : null)) {
          console.log(`[Schedule] Running workflow: ${workflow.name}`);
          await executeWorkflow(workflow, { scheduled: true, cronExpression });

          // Update lastChecked
          await prisma.workflow.update({
            where: { id: workflow.id },
            data: { triggerConfig: { ...workflow.triggerConfig, lastChecked: now.toISOString() } }
          });
        }
      }
    } catch (err) {
      console.error('[Schedule] Checker error:', err);
    }
  }, 60000); // Every minute

  console.log('[Workflow] Schedule checker started');
}

export function stopScheduleChecker() {
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
    scheduleInterval = null;
    console.log('[Workflow] Schedule checker stopped');
  }
}

function shouldRunNow(cronExpression, lastChecked) {
  if (!cronExpression) return false;

  const now = new Date();
  const parts = cronExpression.split(' ');

  if (parts.length !== 5) return false;

  const [min, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Simple check for "every N minutes" patterns like "*/5 * * * *"
  if (min.startsWith('*/')) {
    const interval = parseInt(min.slice(2));
    if (interval > 0 && now.getMinutes() % interval === 0) {
      // Also check if we haven't run in the last interval
      if (!lastChecked || (now - lastChecked) >= (interval * 60 * 1000 * 0.8)) {
        return true;
      }
    }
    return false;
  }

  // For exact minute matches
  const currentMin = now.getMinutes();
  if (min !== '*' && parseInt(min) !== currentMin) return false;

  const currentHour = now.getHours();
  if (hour !== '*' && parseInt(hour) !== currentHour) return false;

  const currentDayOfMonth = now.getDate();
  if (dayOfMonth !== '*' && parseInt(dayOfMonth) !== currentDayOfMonth) return false;

  const currentMonth = now.getMonth() + 1;
  if (month !== '*' && parseInt(month) !== currentMonth) return false;

  const currentDayOfWeek = now.getDay();
  if (dayOfWeek !== '*' && parseInt(dayOfWeek) !== currentDayOfWeek) return false;

  // Ensure we don't run more than once per minute
  if (lastChecked && (now - lastChecked) < 55000) return false;

  return true;
}

// ==================== START INTERVAL ====================

let overdueInterval = null;

export function startOverdueChecker() {
  // Run every hour (3600000ms)
  const ONE_HOUR = 60 * 60 * 1000;

  // Run immediately on startup, then hourly
  checkOverdueInvoices().catch(err =>
    console.error('[Automation] Initial overdue check failed:', err)
  );

  overdueInterval = setInterval(() => {
    checkOverdueInvoices().catch(err =>
      console.error('[Automation] Scheduled overdue check failed:', err)
    );
  }, ONE_HOUR);

  console.log('[Automation] Overdue invoice checker started (hourly)');
}

export function stopOverdueChecker() {
  if (overdueInterval) {
    clearInterval(overdueInterval);
    overdueInterval = null;
    console.log('[Automation] Overdue invoice checker stopped');
  }
}
