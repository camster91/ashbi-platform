// Gmail API routes — bidirectional email via Gmail OAuth

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import { validateBody, gmailDraftReplySchema, gmailSendSchema } from '../validators/schemas.js';
import { outboundSignal } from '../utils/outbound-timeouts.js';
import { aiErrorBody, isAiControlError } from '../ai/errors.js';
import { organizationNameFor } from '../utils/organization-name.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';

// ==================== TOKEN MANAGEMENT ====================

function getTokensPath() {
  return env.gmailTokensPath
    || path.resolve(__dirname, '../../config/google-tokens.json');
}

function loadTokens() {
  if (env.gmailTokensJson) {
    return JSON.parse(env.gmailTokensJson);
  }
  const raw = fs.readFileSync(getTokensPath(), 'utf-8');
  return JSON.parse(raw);
}

function saveTokens(tokens) {
  if (env.gmailTokensJson) return;
  fs.writeFileSync(getTokensPath(), JSON.stringify(tokens, null, 4), 'utf-8');
}

async function getGmailAccessToken() {
  const tokens = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (tokens.created_at || 0) + (tokens.expires_in || 3600);

  if (now >= expiresAt - 300) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      signal: outboundSignal('oauth'),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: tokens.client_id,
        client_secret: tokens.client_secret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Token refresh failed: ${resp.status} ${err}`);
    }
    const data = await resp.json();
    tokens.access_token = data.access_token;
    tokens.expires_in = data.expires_in;
    tokens.created_at = Math.floor(Date.now() / 1000);
    if (data.refresh_token) tokens.refresh_token = data.refresh_token;
    saveTokens(tokens);
  }

  return tokens.access_token;
}

// ==================== MIME BUILDER ====================

/**
 * One header value on one line: CR and LF (and other control characters) are
 * removed, so no caller-supplied value can start a header of its own.
 * @param {unknown} value
 */
export function headerValue(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}

/** RFC 2047 encoded-word for a subject that is not plain ASCII. */
export function encodeSubject(subject) {
  const clean = headerValue(subject);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/**
 * The raw message Gmail sends. Exactly one From (the connected mailbox when
 * known; Gmail fills it in otherwise), and every header value is one line.
 * The body is base64 so any text survives unchanged.
 */
export function buildMimeMessage({ from, to, subject, body, inReplyTo, references }) {
  const lines = [];
  const sender = headerValue(from);
  if (sender) lines.push(`From: ${sender}`);
  lines.push(
    `To: ${headerValue(to)}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  );
  const replyTo = headerValue(inReplyTo);
  if (replyTo) lines.push(`In-Reply-To: ${replyTo}`);
  const refs = headerValue(references);
  if (refs) lines.push(`References: ${refs}`);

  const encodedBody = Buffer.from(String(body ?? ''), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  lines.push('', encodedBody);
  return lines.join('\r\n');
}

/** The connected mailbox's address, or null when Gmail does not say. */
async function gmailMailboxAddress(token) {
  try {
    const resp = await fetch(`${GMAIL_API}/profile`, {
      signal: outboundSignal('api'),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const profile = await resp.json();
    return typeof profile?.emailAddress === 'string' && profile.emailAddress.includes('@') ? profile.emailAddress : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ==================== CONNECTION ====================

export const GMAIL_NOT_CONNECTED = 'GMAIL_NOT_CONNECTED';
const COPY_INSTEAD = 'Until then, copy your reply and send it from your own email.';
const NOT_CONNECTED_MESSAGES = {
  not_configured: "Gmail isn't set up on this deployment yet, so replies can't be sent from here. "
    + 'Whoever runs your Ashbi Hub deployment needs to choose which workspace owns the Gmail mailbox (GMAIL_SYNC_ORGANIZATION_ID) and connect it. '
    + COPY_INSTEAD,
  other_organization: "Gmail isn't connected for this workspace, so this reply can't be sent from here. "
    + 'The mailbox on this deployment belongs to another workspace. ' + COPY_INSTEAD,
  no_tokens: "Gmail isn't connected for this workspace, so this reply can't be sent from here. "
    + 'Whoever runs your Ashbi Hub deployment needs to connect the Gmail mailbox. ' + COPY_INSTEAD,
};
export const GMAIL_NOT_CONNECTED_MESSAGE = NOT_CONNECTED_MESSAGES.no_tokens;

/** What to tell a person for a `gmailConnectionFor` reason. */
export function gmailNotConnectedMessage(reason) {
  return NOT_CONNECTED_MESSAGES[reason] || GMAIL_NOT_CONNECTED_MESSAGE;
}

/**
 * Whether this workspace has a connected Gmail mailbox. Fails closed: the
 * mailbox is set up by the deployment (GMAIL_TOKENS_JSON / GMAIL_TOKENS_PATH)
 * and belongs to exactly one organization (GMAIL_SYNC_ORGANIZATION_ID).
 * Without that owner no organization is connected, as for /sync-now and
 * scripts/gmail-sync.js, and other organizations never use the mailbox.
 * @param {{ organizationId?: string } | null | undefined} user
 * @param {{ readTokens?: () => any }} [deps]
 */
export function gmailConnectionFor(user, { readTokens = loadTokens } = {}) {
  const owner = env.gmailSyncOrganizationId;
  if (!owner) return { connected: false, reason: 'not_configured' };
  if (user?.organizationId !== owner) return { connected: false, reason: 'other_organization' };
  try {
    const tokens = readTokens();
    if (!tokens?.refresh_token && !tokens?.access_token) return { connected: false, reason: 'no_tokens' };
  } catch {
    return { connected: false, reason: 'no_tokens' };
  }
  return { connected: true };
}

/** "Name\nOrganization" for the signature, skipping parts that are missing. */
export function replySignature(user, organizationName) {
  return [user?.name, organizationName].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}


export default async function gmailRoutes(fastify) {

  // ==================== POST /api/gmail/send ====================
  /**
   * Send an email via Gmail API
   * Body: { to, subject, body, threadId?, in_reply_to?, references? }
   * - threadId: Gmail thread ID to reply into (null or omitted: new thread)
   * - in_reply_to: Message-ID header of the email being replied to
   * Answers 409 GMAIL_NOT_CONNECTED when this workspace has no mailbox.
   */
  fastify.post('/send', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(gmailSendSchema),
  }, async (request, reply) => {
    const { to, subject, body, threadId, in_reply_to, references, hubThreadId } = request.body;

    if (!to || !subject || !body) {
      return reply.status(400).send({ error: 'Missing required fields: to, subject, body' });
    }

    const connection = gmailConnectionFor(request.user);
    if (!connection.connected) {
      return reply.status(409).send({ error: gmailNotConnectedMessage(connection.reason), code: GMAIL_NOT_CONNECTED, reason: connection.reason });
    }

    // The reply is filed on a hub thread only if this workspace can see it.
    if (hubThreadId) {
      const hubThread = await request.prisma.thread.findFirst({ where: { id: hubThreadId }, select: { id: true } });
      if (!hubThread) return reply.status(404).send({ error: 'Conversation not found. Reload the page and try again.' });
    }

    try {
      const token = await getGmailAccessToken();
      const mailbox = await gmailMailboxAddress(token);

      const mime = buildMimeMessage({
        from: mailbox,
        to,
        subject,
        body,
        inReplyTo: in_reply_to,
        references
      });

      const encoded = encodeBase64Url(mime);

      const payload = { raw: encoded };
      if (threadId) {
        payload.threadId = threadId;
      }

      const resp = await fetch(`${GMAIL_API}/messages/send`, {
        signal: outboundSignal('api'),
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const err = await resp.text();
        fastify.log.error(`Gmail send failed: ${resp.status} ${err}`);
        return reply.status(502).send({
          error: `Gmail refused the email (error ${resp.status}), so it was not sent. Check the address and try again; if it keeps failing, the Gmail connection may need to be renewed.`,
          code: 'GMAIL_SEND_FAILED',
        });
      }

      const data = await resp.json();

      // Log the sent email to Hub DB
      if (hubThreadId) {
        await request.prisma.message.create({
          data: {
            direction: 'OUTBOUND',
            // The mailbox the email went out from (the person who sent it is
            // the sender name).
            senderEmail: mailbox || request.user.email || 'gmail@hub.local',
            senderName: request.user.name || null,
            subject,
            bodyText: body,
            receivedAt: new Date(),
            threadId: hubThreadId,
            aiExtracted: JSON.stringify({
              gmailMessageId: data.id,
              gmailThreadId: data.threadId,
              source: 'gmail-send',
              sentAt: new Date().toISOString()
            })
          }
        });

        // Update thread status
        await request.prisma.thread.update({
          where: { id: hubThreadId },
          data: {
            status: 'AWAITING_RESPONSE',
            lastActivityAt: new Date()
          }
        });
      }

      return {
        success: true,
        messageId: data.id,
        threadId: data.threadId
      };
    } catch (err) {
      fastify.log.error({ errorName: err?.name }, 'Gmail send error');
      return reply.status(502).send({
        error: "The email couldn't be sent because Gmail didn't respond. Your draft is still here; try again in a minute.",
        code: 'GMAIL_SEND_FAILED',
      });
    }
  });

  // ==================== POST /api/gmail/draft-reply ====================
  /**
   * Generate an AI draft reply for a given thread
   * Body: { hubThreadId }
   */
  fastify.post('/draft-reply', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(gmailDraftReplySchema),
  }, async (request, reply) => {
    const { hubThreadId, responseId } = request.body;

    if (!hubThreadId) {
      return reply.status(400).send({ error: 'Missing hubThreadId' });
    }

    const thread = await request.prisma.thread.findUnique({
      where: { id: hubThreadId },
      include: {
        client: true,
        messages: {
          orderBy: { receivedAt: 'desc' },
          take: 3
        }
      }
    });

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const latestMessage = thread.messages[0];

    // An approved draft is sent as approved: no AI rewrite.
    let approved = null;
    if (responseId) {
      approved = await request.prisma.response.findFirst({
        where: { id: responseId, threadId: thread.id },
        select: { id: true, status: true, subject: true, body: true },
      });
      if (!approved) return reply.status(404).send({ error: 'Saved draft not found' });
      if (approved.status !== 'APPROVED') {
        return reply.status(409).send({ error: 'This draft is not approved yet', code: 'RESPONSE_NOT_APPROVED' });
      }
    }

    const signature = replySignature(request.user, await organizationNameFor(request));
    const conversation = thread.messages.reverse().map(m =>
      `${m.direction === 'INBOUND' ? 'From client' : 'From us'}: ${m.bodyText?.substring(0, 500)}`
    ).join('\n\n---\n\n');

    // Use AI to draft reply
    const { default: aiClient } = await import('../ai/client.js');

    const system = `You are an email assistant at an agency. Write professional, warm, and direct email replies on the sender's behalf.
Keep replies concise and action-oriented.${signature ? ` End the email with "Best," and then this signature, exactly:\n${signature}` : ' End the email with "Best,".'}`;

    const prompt = `Draft a professional reply to this email thread.

Client: ${thread.client?.name || 'Unknown'}
Subject: ${thread.subject}

Recent conversation:
${conversation}

Write a helpful, professional reply that addresses the client's needs. Be concise.`;

    let draftBody = approved?.body || '';
    let notice = null;
    if (!approved) {
      try {
        draftBody = await aiClient.chat({ system, prompt, temperature: 0.7 });
      } catch (err) {
        // Canned fallback is intentional; record why without any content, and
        // tell the person the draft is a template rather than an AI reply.
        fastify.log.warn({ errorCode: err?.code ?? err?.name ?? 'unknown' }, 'AI draft unavailable; using the template reply');
        draftBody = `Hi,\n\nThank you for your email regarding "${thread.subject}". I'll get back to you shortly.\n\nBest,${signature ? `\n${signature}` : ''}`;
        // AI control errors carry fixed, caller-safe messages; anything else
        // gets a fixed one.
        const reason = isAiControlError(err) ? aiErrorBody(err) : { error: 'AI could not write this reply.', code: 'AI_DRAFT_FAILED' };
        notice = {
          code: reason.code,
          message: `${reason.error} A short template reply was added instead; edit it before sending.`,
        };
      }
    }

    // Extract Gmail thread ID from messages
    let gmailThreadId = null;
    let lastMessageId = null;
    for (const msg of thread.messages) {
      let extracted = {};
      try { extracted = msg.aiExtracted ? JSON.parse(msg.aiExtracted) : {}; } catch { extracted = {}; }
      if (extracted.gmailThreadId) gmailThreadId = extracted.gmailThreadId;
      if (extracted.gmailMessageId) lastMessageId = extracted.gmailMessageId;
    }

    return {
      draft: draftBody,
      subject: approved?.subject || `Re: ${thread.subject}`,
      responseId: approved?.id ?? null,
      to: latestMessage?.senderEmail,
      gmailThreadId,
      lastMessageId,
      notice,
      gmail: gmailConnectionFor(request.user),
    };
  });

  // ==================== GET /api/gmail/status ====================
  /**
   * Check Gmail connection status
   */
  fastify.get('/status', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const connection = gmailConnectionFor(request.user);
    if (!connection.connected) {
      return { connected: false, code: GMAIL_NOT_CONNECTED, reason: connection.reason, error: gmailNotConnectedMessage(connection.reason) };
    }
    try {
      const token = await getGmailAccessToken();
      const resp = await fetch(`${GMAIL_API}/profile`, {
        signal: outboundSignal('api'),
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) {
        return { connected: false, error: `Gmail API returned ${resp.status}` };
      }
      const profile = await resp.json();
      return {
        connected: true,
        email: profile.emailAddress,
        messagesTotal: profile.messagesTotal,
        threadsTotal: profile.threadsTotal
      };
    } catch (err) {
      return { connected: false, error: 'Connection check failed' };
    }
  });

  // ==================== POST /api/gmail/sync-now ====================
  /**
   * Trigger a manual Gmail sync. The synced mailbox belongs to one
   * organization (GMAIL_SYNC_ORGANIZATION_ID), so only that organization's
   * admins may run it; unconfigured, it is refused.
   */
  fastify.post('/sync-now', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const organizationId = env.gmailSyncOrganizationId;
    if (!organizationId) {
      return reply.status(503).send({ error: 'Gmail sync is not configured' });
    }
    if (request.user?.organizationId !== organizationId) {
      return reply.status(403).send({ error: 'Gmail sync belongs to another organization' });
    }
    // SECURITY: run the sync script with execFile (no shell) instead of exec.
    // The previous shell string interpolated the resolved script path, so any
    // future change that let a caller influence the path or arguments would
    // have been a command-injection vector. execFile passes argv directly.
    const { execFile } = await import('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/gmail-sync.js');

    return new Promise((resolve) => {
      execFile(process.execPath, [scriptPath], {
        timeout: 120000,
        env: { ...process.env, GMAIL_SYNC_ORGANIZATION_ID: organizationId },
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: 'Command failed', output: stderr });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });
  });
}
