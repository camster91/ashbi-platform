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

    // Action 2: Create notification for admin
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
async function executeAction(action, context, runId) {
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
      const result = await executeAction(action, context, run.id);
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
      }
    }
  } catch (err) {
    console.error('[WorkflowEngine] Scheduled workflow check failed:', err);
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
