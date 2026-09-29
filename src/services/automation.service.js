// Workflow Automations Engine
// Handles trigger-action automations for invoices, proposals, and contracts

import prisma from '../config/db.js';
import { prisma as backgroundPrisma } from '../config/db.js';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import crypto from 'crypto';
import { resolveTenantOrganizationIds, runTenantJob } from '../jobs/tenant-iteration.js';
import { sendInvoiceOverdueEmail } from './email.service.js';
import { formatMoney } from '../utils/money.js';
import { invoicePublicAccessFailure } from '../utils/public-document-access.js';
import { outboundSignal } from '../utils/outbound-timeouts.js';

// ==================== EMAIL HELPER ====================

async function sendEmail(to, subject, html) {
  if (process.env.NODE_ENV === 'test' && process.env.ASHBI_RUN_EMAIL_TESTS !== '1') return false;
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

async function createAdminNotification(type, title, message, data = null, organizationId = null) {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', ...(organizationId ? { organizationId } : {}) },
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

// Best-effort: the activity feed is project-scoped, so an entity without a
// project (e.g. an invoice with no project) cannot be logged under tenant
// scope. A logging failure is reported and never aborts the automation.
async function logAutomation(type, action, entityType, entityId, entityName, metadata = {}, organizationId = null, projectId = null) {
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN', ...(organizationId ? { organizationId } : {}) },
      select: { id: true }
    });

    if (!admin) return null;

    return await prisma.activity.create({
      data: {
        type,
        action,
        entityType,
        entityId,
        entityName,
        metadata: JSON.stringify({ ...metadata, automatedBy: 'WORKFLOW_ENGINE' }),
        userId: admin.id,
        ...(projectId ? { projectId } : {}),
      }
    });
  } catch (err) {
    console.warn(`[Automation] Activity log skipped for ${entityType} ${entityId}:`, err?.message);
    return null;
  }
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
        client: { select: { id: true, name: true, organizationId: true } },
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
        where: { organizationId: proposal.client.organizationId },
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
      { proposalId, contractId: contract.id, clientName: proposal.client.name },
      proposal.client.organizationId,
    );

    // Log activity
    await logAutomation(
      'AUTOMATION_RAN',
      'created',
      'CONTRACT',
      contract.id,
      contract.title,
      { trigger: 'PROPOSAL_APPROVED', proposalId, proposalTitle: proposal.title },
      proposal.client.organizationId,
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
        client: { select: { id: true, name: true, organizationId: true } },
        proposal: { select: { id: true, title: true, total: true, projectId: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    if (!contract) {
      console.error(`[Automation] Contract ${contractId} not found`);
      return;
    }

    // Action 1: the signed work's project. Reuse the proposal's project when
    // it has one (the proposal was scoped to it); only create a project when
    // there is none, and link it back to the proposal so a retry or a later
    // invoice from the proposal uses the same project instead of forking.
    const projectName = contract.proposal?.title || contract.title.replace('Contract: ', '');
    let project = contract.proposal?.projectId
      ? await prisma.project.findFirst({
        where: { id: contract.proposal.projectId, clientId: contract.clientId },
        select: { id: true, name: true },
      })
      : null;
    const projectCreated = !project;

    if (!project) {
      project = await prisma.project.create({
        data: {
          name: projectName,
          description: `Auto-created from signed contract: ${contract.title}`,
          status: 'STARTING_UP',
          health: 'ON_TRACK',
          clientId: contract.clientId,
          organizationId: contract.client.organizationId,
        }
      });
      if (contract.proposal?.id) {
        await prisma.proposal.update({ where: { id: contract.proposal.id }, data: { projectId: project.id } });
      }
      console.log(`[Automation] Project created: ${project.id} from contract ${contractId}`);
    } else {
      console.log(`[Automation] Contract ${contractId} continues existing project ${project.id}`);
    }

    // Action 2: Send welcome email to client
    const contact = await getClientEmail(contract.clientId);
    if (contact) {
      const hubUrl = process.env.HUB_URL || 'https://hub.ashbi.ca';
      await sendEmail(
        contact.email,
        `Welcome! Your project "${project.name}" is underway - Ashbi Design`,
        `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">Welcome aboard, ${contact.name || contract.client.name}!</h2>
            <p>Great news — your contract for <strong>${contract.title}</strong> has been signed and your project is now officially underway.</p>
            <p>Here's what happens next:</p>
            <ul>
              <li>Your project <strong>"${project.name}"</strong> is set up in our system</li>
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
      `${contract.client.name} signed "${contract.title}". Project "${project.name}" ${projectCreated ? 'auto-created' : 'continues'}.`,
      { contractId, projectId: project.id, clientName: contract.client.name },
      contract.client.organizationId,
    );

    // Log activity
    await logAutomation(
      'AUTOMATION_RAN',
      projectCreated ? 'created' : 'linked',
      'PROJECT',
      project.id,
      project.name,
      { trigger: 'CONTRACT_SIGNED', contractId, contractTitle: contract.title },
      contract.client.organizationId,
      project.id,
    );

  } catch (err) {
    console.error(`[Automation] onContractSigned failed:`, err);
  }
}

// ==================== TRIGGER: CHECK OVERDUE INVOICES ====================

const OVERDUE_ESCALATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_PAGE_SIZE = 200;
const OPEN_INVOICE_STATUSES = ['SENT', 'OVERDUE'];

function hubUrl() {
  return process.env.APP_URL || process.env.HUB_URL || 'https://hub.ashbi.ca';
}

// Best-effort side effect: log and continue so one failing step (activity
// log, notification) never stops the remaining invoices.
async function bestEffort(label, invoiceId, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[Automation] ${label} failed for invoice ${invoiceId}:`, err?.message);
    return null;
  }
}

/**
 * Which message, if any, an overdue invoice is due for: one reminder while it
 * is less than OVERDUE_ESCALATION_DAYS late, then a single escalation
 * (recorded in overdueEscalatedAt, after which the invoice leaves the job).
 */
export function overdueReminderStage(invoice, now = new Date()) {
  const daysOverdue = Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / DAY_MS);
  if (daysOverdue >= OVERDUE_ESCALATION_DAYS) {
    return { stage: invoice.overdueEscalatedAt ? null : 'ESCALATION', daysOverdue };
  }
  return { stage: invoice.reminderSentAt ? null : 'REMINDER', daysOverdue };
}

/**
 * Claim the stage before sending anything: a compare-and-set on the values
 * this run read, and only while the invoice is still open. A payment or void
 * that lands mid-job, or an overlapping run that claimed first, makes the
 * claim fail and nothing is sent. Returns an undo for a failed delivery.
 */
async function claimOverdueStage(db, invoice, stage, now) {
  const where = { id: invoice.id, status: { in: OPEN_INVOICE_STATUSES }, reminderSentAt: invoice.reminderSentAt ?? null };
  const data = { reminderSentAt: now };
  if (stage === 'ESCALATION') {
    where.overdueEscalatedAt = null;
    data.overdueEscalatedAt = now;
  }
  const claimed = await db.invoice.updateMany({ where, data });
  if (claimed.count !== 1) return null;
  return async () => {
    // Undo only our own claim, so the next run retries this stage.
    const release = { reminderSentAt: invoice.reminderSentAt ?? null };
    if (stage === 'ESCALATION') release.overdueEscalatedAt = null;
    await db.invoice.updateMany({ where: { id: invoice.id, reminderSentAt: now }, data: release });
  };
}

async function processOverdueInvoice(db, invoice, { now, sendOverdueEmail }) {
  // Compare-and-set: never overwrite a payment or void that just landed.
  if (invoice.status === 'SENT') {
    const moved = await db.invoice.updateMany({ where: { id: invoice.id, status: 'SENT' }, data: { status: 'OVERDUE' } });
    if (moved.count !== 1) return { reminded: false, skipped: 'changed' };
  }
  const { stage, daysOverdue } = overdueReminderStage(invoice, now);
  if (!stage) return { reminded: false };

  const release = await claimOverdueStage(db, invoice, stage, now);
  if (!release) return { reminded: false, skipped: 'claimed_or_changed' };

  const contact = await getClientEmail(invoice.clientId);
  // The pay link is the public invoice page, which creates or refreshes a
  // Checkout session on demand; only link it while the link is valid.
  const linkUsable = invoice.viewToken && !invoicePublicAccessFailure({ ...invoice, status: 'OVERDUE' }, now);
  let delivered = false;
  if (contact?.email && linkUsable) {
    let delivery;
    try {
      delivery = await sendOverdueEmail({
        to: contact.email,
        clientName: contact.name || invoice.client?.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        currency: invoice.currency,
        daysOverdue,
        viewUrl: `${hubUrl()}/portal/invoice/${invoice.viewToken}`,
        invoiceId: invoice.id,
      });
    } catch (err) {
      delivery = { ok: false, error: err?.message };
    }
    delivered = Boolean(delivery?.ok);
    if (!delivered) {
      await release();
      console.warn(`[Automation] Overdue ${stage.toLowerCase()} for invoice ${invoice.id} was not accepted by the email provider; will retry`);
      return { reminded: false };
    }
  }
  // Without a contact or a usable link the stage stays claimed (staff are
  // notified below) rather than being retried on every run.

  const amount = formatMoney(invoice.total, invoice.currency);
  const organizationId = invoice.organizationId || null;
  if (stage === 'ESCALATION') {
    await bestEffort('Client payment-status flag', invoice.id, () => db.client.update({
      where: { id: invoice.clientId },
      data: { paymentStatus: 'AT_RISK' },
    }));
  }
  await bestEffort('Admin notification', invoice.id, () => createAdminNotification(
    stage === 'ESCALATION' ? 'INVOICE_OVERDUE_7D' : 'INVOICE_OVERDUE',
    stage === 'ESCALATION' ? `Invoice ${daysOverdue}+ Days Overdue` : 'Invoice Overdue',
    stage === 'ESCALATION'
      ? `${invoice.invoiceNumber} for ${invoice.client?.name} (${amount}) is ${daysOverdue} days overdue. Client flagged as AT_RISK.`
      : `${invoice.invoiceNumber} for ${invoice.client?.name} (${amount}) is now overdue.${delivered ? ' Reminder sent.' : ' No reminder could be sent (no contact email or link).'}`,
    { invoiceId: invoice.id, daysOverdue, clientId: invoice.clientId },
    organizationId,
  ));
  await logAutomation(
    'AUTOMATION_RAN',
    stage === 'ESCALATION' ? 'escalated' : 'reminded',
    'INVOICE',
    invoice.id,
    invoice.invoiceNumber,
    { trigger: stage === 'ESCALATION' ? 'INVOICE_OVERDUE_7D' : 'INVOICE_OVERDUE', daysOverdue, clientName: invoice.client?.name, emailSent: delivered },
    organizationId,
    invoice.projectId,
  );
  return { reminded: delivered };
}

/**
 * Mark past-due invoices OVERDUE and send templated reminders. Runs inside a
 * tenant job (db defaults to the request-context client, which runTenantJob
 * scopes to one organization). Every open, past-due, not-yet-escalated
 * invoice is examined, page by page (keyset on id), so escalated or already
 * reminded invoices can never starve new ones. Each invoice is isolated: a
 * failure is logged and reported, and the rest are still processed.
 */
export async function checkOverdueInvoices(db = prisma, { now = new Date(), sendOverdueEmail = sendInvoiceOverdueEmail, pageSize = OVERDUE_PAGE_SIZE } = {}) {
  const result = { processed: 0, reminded: 0, failed: [] };
  let cursor = null;
  for (;;) {
    const page = await db.invoice.findMany({
      where: {
        status: { in: OPEN_INVOICE_STATUSES },
        dueDate: { lt: now },
        overdueEscalatedAt: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
    });
    for (const invoice of page) {
      try {
        const outcome = await processOverdueInvoice(db, invoice, { now, sendOverdueEmail });
        result.processed += 1;
        if (outcome.reminded) result.reminded += 1;
      } catch (err) {
        console.error(`[Automation] Overdue processing failed for invoice ${invoice.id}:`, err?.message);
        result.failed.push({ invoiceId: invoice.id, error: err?.message });
      }
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return result;
}

// ==================== WORKFLOW ENGINE ====================

export async function executeWorkflow(workflow, triggerData = {}) {
  const { id: workflowId, name, actions } = workflow;
  const runId = crypto.randomUUID();
  let status = 'SUCCESS';
  let error = null;
  const results = [];

  console.log(`[Workflow] Starting execution: ${name} (${workflowId})`);

  // Create run record
  await prisma.workflowRun.create({
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

  // Validate action config schema before execution
  if (!config || typeof config !== 'object') {
    throw new Error(`Action config is required and must be an object for action type: ${type}`);
  }

  const REQUIRED_FIELDS = {
    SEND_EMAIL: ['to', 'subject'],
    CREATE_TASK: ['title'],
    SEND_TELEGRAM: ['chat_id', 'message'],
    UPDATE_DEAL_STAGE: ['deal_id', 'stage'],
    WEBHOOK_CALL: ['url', 'method'],
    CONDITION: ['field', 'operator'],
  };

  const required = REQUIRED_FIELDS[type];
  if (required) {
    const missing = required.filter(f => !config[f]);
    if (missing.length > 0) {
      throw new Error(`Action type "${type}" is missing required config field(s): ${missing.join(', ')}`);
    }
  }

  switch (type) {
    case 'SEND_EMAIL':
      return executeSendEmail(config, triggerData);
    case 'CREATE_TASK':
      return executeCreateTask(config, triggerData, workflow);
    case 'SEND_TELEGRAM':
      return executeSendTelegram(config, triggerData);
    case 'UPDATE_DEAL_STAGE':
      return executeUpdateDealStage(config, triggerData, workflow);
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

async function executeCreateTask(config, triggerData, workflow) {
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
    { workflowName: workflow?.name, actionType: 'CREATE_TASK' });

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
    signal: outboundSignal('webhook'),
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

async function executeUpdateDealStage(config, triggerData, workflow) {
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
    { workflowName: workflow?.name, newStage: resolvedStage });

  return { dealId: deal.id, newStage: resolvedStage };
}

async function executeWebhookCall(config, triggerData) {
  const { url, method = 'POST', headers = {}, body } = config;

  const resolvedUrl = resolveTemplate(url, triggerData);
  const resolvedBody = resolveTemplate(body || '{}', triggerData);

  const response = await fetch(resolvedUrl, {
    signal: outboundSignal('webhook'),
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

/**
 * Run the overdue check for the given organizations, each in its own tenant
 * job. A failing organization (or invoice) is reported and the rest still
 * run; the call throws at the end if anything failed so the queue retries
 * (every step is idempotent).
 */
export async function checkOverdueInvoicesForOrganizations(organizationIds, { db = null, sendOverdueEmail, now, pageSize } = {}) {
  const failed = [];
  let processed = 0;
  for (const organizationId of organizationIds) {
    try {
      const result = await runTenantJob(
        db || prisma,
        organizationId,
        (tenantPrisma) => checkOverdueInvoices(tenantPrisma, { sendOverdueEmail, now, pageSize }),
        db || backgroundPrisma,
      );
      processed += result.processed;
      for (const failure of result.failed) failed.push({ organizationId, ...failure });
    } catch (err) {
      console.error(`[Automation] Overdue check failed for organization ${organizationId}:`, err?.message);
      failed.push({ organizationId, error: err?.message });
    }
  }
  return { organizations: organizationIds.length, processed, failed };
}

export async function checkOverdueInvoicesForAllOrganizations() {
  const organizationIds = await resolveTenantOrganizationIds(prisma);
  const result = await checkOverdueInvoicesForOrganizations(organizationIds);
  if (result.failed.length > 0) {
    const error = new Error(`Overdue invoice check failed for ${result.failed.length} item(s)`);
    error.failures = result.failed;
    throw error;
  }
  return result;
}

// ==================== WORKFLOW ENGINE ====================

/**
 * Evaluate conditions against a context object.
 * Each condition: { field, operator, value }
 * Supported operators: eq, neq, gt, gte, lt, lte, contains, in, not_in
 */
function evaluateConditions(conditions, context) {
  if (!conditions || conditions.length === 0) return true;

  for (const cond of conditions) {
    const fieldValue = context[cond.field];
    const condValue = cond.value;

    switch (cond.operator) {
      case 'eq': if (fieldValue !== condValue) return false; break;
      case 'neq': if (fieldValue === condValue) return false; break;
      case 'gt': if (!(fieldValue > condValue)) return false; break;
      case 'gte': if (!(fieldValue >= condValue)) return false; break;
      case 'lt': if (!(fieldValue < condValue)) return false; break;
      case 'lte': if (!(fieldValue <= condValue)) return false; break;
      case 'contains': if (!String(fieldValue).includes(String(condValue))) return false; break;
      case 'in': if (!Array.isArray(condValue) || !condValue.includes(fieldValue)) return false; break;
      case 'not_in': if (Array.isArray(condValue) && condValue.includes(fieldValue)) return false; break;
      default:
        console.warn(`[WorkflowEngine] Unknown operator: ${cond.operator}`);
        return false;
    }
  }

  return true;
}

/**
 * Execute a single action against a context.
 * Action types: send_email, create_task, send_notification, update_deal_stage, trigger_hermes, log_activity
 */
async function executeWorkflowAction(action, context, runId) {
  const { type, config } = action;
  const result = { type, status: 'SUCCESS', message: '' };

  try {
    switch (type) {
      case 'send_email': {
        const to = config.to || context.contactEmail;
        const subject = interpolateTemplate(config.subject || '', context);
        const body = interpolateTemplate(config.body || '', context);
        const html = config.html ? interpolateTemplate(config.html, context) : `<p>${body}</p>`;
        const sent = await sendEmail(to, subject, html);
        result.status = sent ? 'SUCCESS' : 'FAILED';
        result.message = sent ? `Email sent to ${to}` : `Failed to send email to ${to}`;
        break;
      }

      case 'create_task': {
        const task = await prisma.task.create({
          data: {
            title: interpolateTemplate(config.title, context),
            description: config.description ? interpolateTemplate(config.description, context) : null,
            status: 'PENDING',
            priority: config.priority || 'NORMAL',
            category: config.category || 'UPCOMING',
            projectId: config.projectId || context.projectId || null,
            assigneeId: config.assigneeId || null,
          }
        });
        result.message = `Task "${task.title}" created (${task.id})`;
        break;
      }

      case 'send_notification': {
        await createAdminNotification(
          config.type || 'WORKFLOW_TRIGGER',
          interpolateTemplate(config.title, context),
          interpolateTemplate(config.message, context),
          { runId, ...context }
        );
        result.message = `Notification sent: ${config.title}`;
        break;
      }

      case 'update_deal_stage': {
        if (context.dealId) {
          await prisma.pipelineDeal.update({
            where: { id: context.dealId },
            data: { stage: config.stage }
          });
          result.message = `Deal ${context.dealId} moved to ${config.stage}`;
        } else {
          result.status = 'FAILED';
          result.message = 'No dealId in context';
        }
        break;
      }

      case 'trigger_hermes': {
        const hermesUrl = process.env.HERMES_WEBHOOK_URL || 'http://localhost:8080/webhook';
        try {
          const resp = await fetch(hermesUrl, {
            signal: outboundSignal('webhook'),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: config.hermesAction || 'run_workflow',
              payload: { ...context, workflowAction: config }
            })
          });
          if (!resp.ok) throw new Error(`Hermes responded ${resp.status}`);
          result.message = `Hermes triggered: ${config.hermesAction}`;
        } catch (err) {
          result.status = 'FAILED';
          result.message = `Hermes trigger failed: ${err.message}`;
        }
        break;
      }

      case 'log_activity': {
        await logAutomation(
          'WORKFLOW_ACTION',
          config.action || 'executed',
          config.entityType || 'WORKFLOW',
          context.entityId || runId,
          context.entityName || config.message || 'Workflow action',
          { ...context, runId }
        );
        result.message = `Activity logged`;
        break;
      }

      default:
        result.status = 'FAILED';
        result.message = `Unknown action type: ${type}`;
    }
  } catch (err) {
    result.status = 'FAILED';
    result.message = err.message;
    console.error(`[WorkflowEngine] Action ${type} failed:`, err);
  }

  return result;
}

/**
 * Simple template interpolation: replaces {{variable}} with context values.
 */
function interpolateTemplate(template, context) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] ?? `{{${key}}}`);
}

/**
 * Run a single workflow with optional trigger context.
 * Returns the WorkflowRun record.
 */
export async function runWorkflow(workflowId, context = {}) {
  const startedAt = Date.now();

  const workflow = await prisma.workflowDefinition.findUnique({
    where: { id: workflowId }
  });

  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  if (!workflow.isActive || workflow.isPaused) {
    throw new Error(`Workflow ${workflowId} is not active`);
  }

  let run;
  try {
    // Parse configs
    const conditions = JSON.parse(workflow.conditions || '[]');
    const actions = JSON.parse(workflow.actions || '[]');

    // Create run record
    run = await prisma.workflowRun.create({
      data: {
        workflowId: workflow.id,
        status: 'RUNNING',
        trigger: workflow.trigger,
        triggerData: JSON.stringify(context),
        startedAt: new Date()
      }
    });

    // Evaluate conditions
    const conditionsMet = evaluateConditions(conditions, context);
    if (!conditionsMet) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCESS',
          actions: JSON.stringify([]),
          completedAt: new Date(),
          durationMs: Date.now() - startedAt
        }
      });

      await prisma.workflowDefinition.update({
        where: { id: workflowId },
        data: {
          runCount: { increment: 1 },
          lastRunAt: new Date(),
          lastRunStatus: 'SUCCESS'
        }
      });

      return run;
    }

    // Execute actions
    const actionResults = [];
    for (const action of actions) {
      const result = await executeWorkflowAction(action, context, run.id);
      actionResults.push(result);
    }

    const allSucceeded = actionResults.every(r => r.status === 'SUCCESS');
    const durationMs = Date.now() - startedAt;

    // Update run record
    run = await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: allSucceeded ? 'SUCCESS' : 'FAILED',
        actions: JSON.stringify(actionResults),
        error: allSucceeded ? null : actionResults.filter(r => r.status === 'FAILED').map(r => r.message).join('; '),
        completedAt: new Date(),
        durationMs
      }
    });

    // Update workflow stats
    await prisma.workflowDefinition.update({
      where: { id: workflowId },
      data: {
        runCount: { increment: 1 },
        lastRunAt: new Date(),
        lastRunStatus: allSucceeded ? 'SUCCESS' : 'FAILED'
      }
    });

  } catch (err) {
    console.error(`[WorkflowEngine] Workflow ${workflowId} failed:`, err);

    if (run) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: err.message,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt
        }
      });
    }

    await prisma.workflowDefinition.update({
      where: { id: workflowId },
      data: {
        runCount: { increment: 1 },
        lastRunAt: new Date(),
        lastRunStatus: 'FAILED'
      }
    });

    throw err;
  }

  return run;
}

/**
 * Run all active schedule-type workflows whose cron expression matches now.
 */
export async function runScheduledWorkflows() {
  const now = new Date();
  console.log(`[WorkflowEngine] Checking scheduled workflows at ${now.toISOString()}`);

  try {
    const workflows = await prisma.workflowDefinition.findMany({
      where: {
        trigger: 'schedule',
        isActive: true,
        isPaused: false
      }
    });

    const failures = [];
    for (const wf of workflows) {
      try {
        const config = JSON.parse(wf.triggerConfig || '{}');
        if (config.cron) {
          // Simple cron minute/hour matching (full cron parser would be overkill)
          const cronParts = config.cron.split(/\s+/);
          const minute = cronParts[0];
          const hour = cronParts[1];
          const currentMinute = now.getMinutes();
          const currentHour = now.getHours();

          let shouldRun = false;
          if (minute === '*' || minute.split(',').includes(String(currentMinute))) {
            if (hour === '*' || hour.split(',').includes(String(currentHour))) {
              shouldRun = true;
            }
          }

          if (shouldRun) {
            console.log(`[WorkflowEngine] Running scheduled workflow: ${wf.name}`);
            await runWorkflow(wf.id, { triggeredAt: now.toISOString(), trigger: 'schedule' });
          }
        }
      } catch (wfErr) {
        console.error(`[WorkflowEngine] Error running workflow ${wf.id}:`, wfErr);
        failures.push({ workflowId: wf.id, error: wfErr.message });
      }
    }
    if (failures.length > 0) {
      const error = new Error(`Failed to run ${failures.length} scheduled workflow(s)`);
      error.failures = failures;
      throw error;
    }
    return { examined: workflows.length };
  } catch (err) {
    console.error('[WorkflowEngine] Scheduled workflow check failed:', err);
    throw err;
  }
}

/**
 * Trigger event-based workflows.
 * Called from route handlers when events fire (proposal_approved, contract_signed, etc.)
 */
export async function triggerEventWorkflows(event, context = {}) {
  console.log(`[WorkflowEngine] Event triggered: ${event}`);

  try {
    const workflows = await prisma.workflowDefinition.findMany({
      where: {
        trigger: event,
        isActive: true,
        isPaused: false
      }
    });

    const results = [];
    for (const wf of workflows) {
      try {
        const run = await runWorkflow(wf.id, { ...context, event, triggeredAt: new Date().toISOString() });
        results.push({ workflowId: wf.id, runId: run.id, status: 'SUCCESS' });
      } catch (wfErr) {
        results.push({ workflowId: wf.id, status: 'FAILED', error: wfErr.message });
      }
    }

    return results;
  } catch (err) {
    console.error(`[WorkflowEngine] Event trigger failed for ${event}:`, err);
    return [];
  }
}
