// Gmail API routes — bidirectional email via Gmail OAuth

import prisma from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';

// ==================== TOKEN MANAGEMENT ====================

function getTokensPath() {
  return process.env.GMAIL_TOKENS_PATH
    || path.resolve(__dirname, '../../config/google-tokens.json');
}

function loadTokens() {
  if (process.env.GMAIL_TOKENS_JSON) {
    return JSON.parse(process.env.GMAIL_TOKENS_JSON);
  }
  const raw = fs.readFileSync(getTokensPath(), 'utf-8');
  return JSON.parse(raw);
}

function saveTokens(tokens) {
  if (process.env.GMAIL_TOKENS_JSON) return;
  fs.writeFileSync(getTokensPath(), JSON.stringify(tokens, null, 4), 'utf-8');
}

async function getGmailAccessToken() {
  const tokens = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (tokens.created_at || 0) + (tokens.expires_in || 3600);

  if (now >= expiresAt - 300) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
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

function buildMimeMessage({ from, to, subject, body, threadId, inReplyTo, references }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    lines.push(`References: ${references}`);
  }

  lines.push('', body);
  return lines.join('\r\n');
}

function encodeBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export default async function gmailRoutes(fastify) {

  // ==================== POST /api/gmail/send ====================
  /**
   * Send an email via Gmail API
   * Body: { to, subject, body, threadId?, in_reply_to?, references? }
   * - threadId: Gmail thread ID to reply into
   * - in_reply_to: Message-ID header of the email being replied to
   */
  fastify.post('/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { to, subject, body, threadId, in_reply_to, references, hubThreadId } = request.body;

    if (!to || !subject || !body) {
      return reply.status(400).send({ error: 'Missing required fields: to, subject, body' });
    }

    try {
      const token = await getGmailAccessToken();

      const mime = buildMimeMessage({
        from: 'cameron@ashbi.ca',
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
        return reply.status(502).send({ error: `Gmail API error: ${resp.status}` });
      }

      const data = await resp.json();

      // Log the sent email to Hub DB
      if (hubThreadId) {
        await prisma.message.create({
          data: {
            direction: 'OUTBOUND',
            senderEmail: 'cameron@ashbi.ca',
            senderName: 'Cameron',
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
        await prisma.thread.update({
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
      fastify.log.error('Gmail send error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== POST /api/gmail/draft-reply ====================
  /**
   * Generate an AI draft reply for a given thread
   * Body: { hubThreadId }
   */
  fastify.post('/draft-reply', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { hubThreadId } = request.body;

    if (!hubThreadId) {
      return reply.status(400).send({ error: 'Missing hubThreadId' });
    }

    const thread = await prisma.thread.findUnique({
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
    const conversation = thread.messages.reverse().map(m =>
      `${m.direction === 'INBOUND' ? 'From client' : 'From us'}: ${m.bodyText?.substring(0, 500)}`
    ).join('\n\n---\n\n');

    // Use AI to draft reply
    const { default: aiClient } = await import('../ai/client.js');

    const system = `You are Cameron's email assistant at Ashbi Design, a Toronto-based CPG/DTC branding agency. 
Write professional, warm, and direct email replies on Cameron's behalf.
Keep replies concise and action-oriented. Sign off as "Cameron | Ashbi Design".`;

    const prompt = `Draft a professional reply to this email thread.

Client: ${thread.client?.name || 'Unknown'}
Subject: ${thread.subject}

Recent conversation:
${conversation}

Write a helpful, professional reply that addresses the client's needs. Be concise.`;

    let draftBody = '';
    try {
      draftBody = await aiClient.chat({ system, prompt, temperature: 0.7 });
    } catch (err) {
      fastify.log.error('AI draft error:', err);
      draftBody = `Hi,\n\nThank you for your email regarding "${thread.subject}". I'll get back to you shortly.\n\nBest,\nCameron | Ashbi Design`;
    }

    // Extract Gmail thread ID from messages
    let gmailThreadId = null;
    let lastMessageId = null;
    for (const msg of thread.messages) {
      const extracted = msg.aiExtracted ? JSON.parse(msg.aiExtracted) : {};
      if (extracted.gmailThreadId) gmailThreadId = extracted.gmailThreadId;
      if (extracted.gmailMessageId) lastMessageId = extracted.gmailMessageId;
    }

    return {
      draft: draftBody,
      subject: `Re: ${thread.subject}`,
      to: latestMessage?.senderEmail,
      gmailThreadId,
      lastMessageId
    };
  });

  // ==================== GET /api/gmail/status ====================
  /**
   * Check Gmail connection status
   */
  fastify.get('/status', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const token = await getGmailAccessToken();
      const resp = await fetch(`${GMAIL_API}/profile`, {
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
      return { connected: false, error: err.message };
    }
  });

  // ==================== POST /api/gmail/sync-now ====================
  /**
   * Trigger a manual Gmail sync
   */
  fastify.post('/sync-now', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { exec } = await import('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/gmail-sync.js');
    
    return new Promise((resolve) => {
      const child = exec(`node ${scriptPath}`, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: error.message, output: stderr });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });
  });
}
