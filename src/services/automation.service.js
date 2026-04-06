// Workflow Automations Engine
// Handles trigger-action automations for invoices, proposals, and contracts

import { prisma } from '../index.js';
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
                <p>Invoice <strong>${invoice.invoiceNumber}</strong>${invoice.title ? ` (${invoice.title})` : ''} for <strong>$${invoice.total.toFixed(2)}</strong> was due on <strong>${new Date(invoice.dueDate).toLocaleDateString()}</strong> and is now <strong>${daysOverdue} days overdue</strong>.</p>
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
                  <p>This is a friendly reminder that invoice <strong>${invoice.invoiceNumber}</strong>${invoice.title ? ` (${invoice.title})` : ''} for <strong>$${invoice.total.toFixed(2)}</strong> was due on <strong>${new Date(invoice.dueDate).toLocaleDateString()}</strong>.</p>
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
