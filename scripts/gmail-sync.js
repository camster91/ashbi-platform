#!/usr/bin/env node

/**
 * Gmail -> Hub Sync
 *
 * Pulls emails from the last 48hrs from cameron@ashbi.ca inbox,
 * matches senders to Hub clients/contacts, stores via Prisma,
 * and applies AI triage tags.
 *
 * Usage: node scripts/gmail-sync.js
 * Cron (every 30min 8am-10pm ET): use docker exec cron
 * Cron overnight: full sync at 5am UTC
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// ==================== CONFIG ====================

const TOKENS_PATH = process.env.GMAIL_TOKENS_PATH
  || path.resolve(__dirname, '../config/google-tokens.json')
  || path.resolve(__dirname, '../../../.openclaw/workspace/memory/google-tokens.json');

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const HOURS_LOOKBACK = parseInt(process.env.GMAIL_LOOKBACK_HOURS || '48');

// ==================== TOKEN MANAGEMENT ====================

function loadTokens() {
  // Try env first (for VPS deployment)
  if (process.env.GMAIL_TOKENS_JSON) {
    return JSON.parse(process.env.GMAIL_TOKENS_JSON);
  }
  const raw = fs.readFileSync(TOKENS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveTokens(tokens) {
  if (process.env.GMAIL_TOKENS_JSON) {
    // Can't persist to env; log warning but continue
    console.log('[gmail-sync] Warning: running with GMAIL_TOKENS_JSON env var — token refresh not persisted');
    return;
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 4), 'utf-8');
}

async function getAccessToken() {
  const tokens = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (tokens.created_at || 0) + (tokens.expires_in || 3600);

  // Refresh if within 5 minutes of expiry
  if (now >= expiresAt - 300) {
    console.log('[gmail-sync] Refreshing access token...');
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
    if (data.refresh_token) {
      tokens.refresh_token = data.refresh_token;
    }
    saveTokens(tokens);
    console.log('[gmail-sync] Token refreshed successfully');
  }

  return tokens.access_token;
}

// ==================== GMAIL API ====================

async function gmailFetch(endpoint, token) {
  const resp = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail API error: ${resp.status} ${err}`);
  }
  return resp.json();
}

async function listRecentMessages(token) {
  const after = Math.floor((Date.now() - HOURS_LOOKBACK * 60 * 60 * 1000) / 1000);
  const query = `in:inbox after:${after}`;
  const data = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=200`,
    token
  );
  return data.messages || [];
}

async function getMessageDetail(messageId, token) {
  return gmailFetch(`/messages/${messageId}?format=full`, token);
}

function extractHeader(headers, name) {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function extractBody(payload) {
  // Try plain text first
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart - search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    // Fallback to HTML
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const result = extractBody(part);
        if (result) return result;
      }
    }
  }

  // Fallback: body.data on root
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  return '';
}

function parseEmailAddress(raw) {
  if (!raw) return { email: '', name: '' };
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  }
  return { email: raw.trim(), name: raw.split('@')[0] };
}

// ==================== UPWORK DETECTION ====================

function detectUpwork(fromEmail, subject, body) {
  const upworkSenders = [
    'no-reply@upwork.com',
    'notification@upwork.com',
    'donotreply@upwork.com',
    'noreply@upwork.com',
    '@upwork.com'
  ];
  const isUpworkSender = upworkSenders.some(s => fromEmail.toLowerCase().includes(s));
  
  if (!isUpworkSender) return null;

  // Extract Upwork message URL from email body
  const urlPatterns = [
    /https:\/\/www\.upwork\.com\/ab\/messages\/rooms\/[^\s"<>]+/i,
    /https:\/\/www\.upwork\.com\/messages\/rooms\/[^\s"<>]+/i,
    /https:\/\/www\.upwork\.com\/freelance-jobs\/[^\s"<>]+/i,
    /https:\/\/www\.upwork\.com\/contracts\/[^\s"<>]+/i,
  ];

  let upworkUrl = null;
  for (const pattern of urlPatterns) {
    const match = body.match(pattern);
    if (match) {
      upworkUrl = match[0];
      break;
    }
  }

  // Extract sender name from Upwork email subject/body
  // "You have a new message from John D." pattern
  let clientName = null;
  const nameMatch = subject?.match(/message from (.+?)(?:\s*$|\s+on\s)/i) 
    || body.match(/message from ([A-Za-z]+ [A-Za-z.]+)/i);
  if (nameMatch) clientName = nameMatch[1].trim();

  return { isUpwork: true, upworkUrl, clientName };
}

// ==================== CLIENT MATCHING ====================

async function matchSenderToClient(senderEmail) {
  const domain = senderEmail.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  // Skip common email providers
  const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com'];
  const isFreeProvider = freeProviders.includes(domain);

  // Try exact contact email match
  const contact = await prisma.contact.findFirst({
    where: { email: { equals: senderEmail, mode: 'insensitive' } },
    include: { client: true }
  });
  if (contact) return { client: contact.client, contact, confidence: 1.0 };

  // Try domain match (skip free email providers)
  if (!isFreeProvider) {
    const client = await prisma.client.findFirst({
      where: { domain: { equals: domain, mode: 'insensitive' } }
    });
    if (client) return { client, contact: null, confidence: 0.9 };
  }

  // Try fuzzy domain match
  if (!isFreeProvider) {
    const clients = await prisma.client.findMany({
      where: { domain: { not: null } }
    });
    for (const c of clients) {
      if (c.domain && (domain.includes(c.domain.toLowerCase()) || c.domain.toLowerCase().includes(domain))) {
        return { client: c, contact: null, confidence: 0.7 };
      }
    }
  }

  return null;
}

// ==================== AI TRIAGE ====================

function triageEmail({ from, subject, body, isUpwork }) {
  const tags = [];

  const bodyLower = (body || '').toLowerCase();
  const subjectLower = (subject || '').toLowerCase();
  const combined = `${subjectLower} ${bodyLower}`;

  // Upwork tag
  if (isUpwork) {
    tags.push('upwork');
    tags.push('needs-reply');
    return tags;
  }

  // Automated detection
  const automatedPatterns = [
    'noreply', 'no-reply', 'donotreply', 'unsubscribe',
    'automated message', 'auto-reply', 'out of office',
    'notification@', 'alerts@', 'mailer-daemon'
  ];
  if (automatedPatterns.some(p => from.toLowerCase().includes(p) || combined.includes(p))) {
    tags.push('automated');
    return tags;
  }

  // Urgent detection
  const urgentPatterns = [
    'urgent', 'asap', 'immediately', 'emergency', 'critical',
    'down', 'broken', 'not working', 'deadline today'
  ];
  if (urgentPatterns.some(p => combined.includes(p))) {
    tags.push('urgent');
  }

  // Needs reply detection (questions, requests)
  const replyPatterns = [
    '?', 'can you', 'could you', 'would you', 'please',
    'let me know', 'get back to', 'thoughts on', 'feedback',
    'what do you think', 'when can', 'update on', 'status of'
  ];
  if (replyPatterns.some(p => combined.includes(p))) {
    tags.push('needs-reply');
  }

  // Lead detection (new business inquiries)
  const leadPatterns = [
    'interested in', 'looking for', 'need a website', 'need help with',
    'quote', 'pricing', 'budget', 'proposal', 'hire',
    'found you on', 'referred by', 'saw your work'
  ];
  if (leadPatterns.some(p => combined.includes(p))) {
    tags.push('lead');
  }

  if (tags.length === 0) {
    tags.push('needs-reply');
  }

  return tags;
}

// ==================== DEDUPLICATE ====================

async function isDuplicate(senderEmail, subject, gmailMessageId) {
  // Check by gmail message ID in aiExtracted JSON
  const existing = await prisma.message.findFirst({
    where: {
      senderEmail,
      aiExtracted: {
        contains: gmailMessageId
      }
    }
  });
  return !!existing;
}

// ==================== STORE IN HUB ====================

async function storeInHub(email, clientMatch, tags, upworkInfo) {
  const { from, subject, body, threadId: gmailThreadId, gmailMessageId, date, senderEmail, senderName } = email;

  // Deduplicate
  if (await isDuplicate(senderEmail, subject, gmailMessageId)) {
    return { skipped: true, reason: 'duplicate' };
  }

  // Skip outbound emails from ourselves
  if (senderEmail.toLowerCase().includes('@ashbi.ca') && !upworkInfo?.isUpwork) {
    return { skipped: true, reason: 'own email' };
  }

  const aiExtractedData = {
    gmailThreadId,
    gmailMessageId,
    tags,
    source: 'gmail-sync',
    syncedAt: new Date().toISOString(),
    ...(upworkInfo?.upworkUrl ? { upworkUrl: upworkInfo.upworkUrl } : {})
  };

  // For Upwork messages: find or create thread under "Upwork" virtual client or match by contract
  if (upworkInfo?.isUpwork) {
    // Find existing Upwork triage item with same thread
    const existingTriage = await prisma.emailTriageItem.findFirst({
      where: {
        senderEmail,
        status: 'PENDING'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!existingTriage) {
      await prisma.emailTriageItem.create({
        data: {
          subject: subject || '(Upwork message)',
          senderEmail,
          senderName: upworkInfo.clientName || senderName,
          bodyText: body?.substring(0, 50000) || '',
          tags: JSON.stringify(tags),
          status: 'PENDING',
          aiSummary: `Upwork message${upworkInfo.clientName ? ` from ${upworkInfo.clientName}` : ''}${upworkInfo.upworkUrl ? ` | URL: ${upworkInfo.upworkUrl}` : ''}`
        }
      });
    }
    return { stored: true, triage: true, tags, upwork: true };
  }

  // If we matched a client, create/find a thread
  if (clientMatch) {
    tags = [...tags, 'client'];

    // Clean subject for matching (remove Re:, Fwd:, etc.)
    const cleanSubject = subject?.replace(/^(Re|Fwd|Fw):\s*/i, '').trim() || '';

    // Find existing open thread for this client with similar subject
    let thread = null;
    if (gmailThreadId) {
      // Match by gmail thread ID stored in messages
      const existingMsg = await prisma.message.findFirst({
        where: {
          aiExtracted: { contains: gmailThreadId },
          thread: { clientId: clientMatch.client.id }
        },
        include: { thread: true }
      });
      if (existingMsg) thread = existingMsg.thread;
    }

    if (!thread) {
      thread = await prisma.thread.findFirst({
        where: {
          clientId: clientMatch.client.id,
          status: { not: 'RESOLVED' },
          subject: { contains: cleanSubject.substring(0, 50) }
        },
        orderBy: { lastActivityAt: 'desc' }
      });
    }

    if (!thread) {
      thread = await prisma.thread.create({
        data: {
          subject: subject || '(no subject)',
          status: 'OPEN',
          priority: tags.includes('urgent') ? 'HIGH' : 'NORMAL',
          clientId: clientMatch.client.id,
          matchConfidence: clientMatch.confidence,
          matchReason: `Gmail sync - matched by ${clientMatch.contact ? 'contact email' : 'domain'}`,
          needsTriage: tags.includes('lead') || clientMatch.confidence < 0.85
        }
      });
    }

    // Add message to thread
    await prisma.message.create({
      data: {
        direction: 'INBOUND',
        senderEmail,
        senderName,
        subject,
        bodyText: body?.substring(0, 50000) || '',
        receivedAt: new Date(date),
        threadId: thread.id,
        aiExtracted: JSON.stringify(aiExtractedData)
      }
    });

    // Update thread activity
    await prisma.thread.update({
      where: { id: thread.id },
      data: {
        lastActivityAt: new Date(),
        ...(tags.includes('urgent') ? { priority: 'HIGH' } : {})
      }
    });

    return { stored: true, threadId: thread.id, clientName: clientMatch.client.name };
  }

  // No client match - store as EmailTriageItem for review
  await prisma.emailTriageItem.create({
    data: {
      subject: subject || '(no subject)',
      senderEmail,
      senderName,
      bodyText: body?.substring(0, 50000) || '',
      tags: JSON.stringify(tags),
      status: 'PENDING',
      aiSummary: `Gmail sync: ${tags.join(', ')}`
    }
  });

  return { stored: true, triage: true, tags };
}

// ==================== MAIN ====================

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`\n[gmail-sync] ===== Starting at ${timestamp} =====`);
  console.log(`[gmail-sync] Looking back ${HOURS_LOOKBACK} hours`);

  const token = await getAccessToken();
  const messageList = await listRecentMessages(token);

  console.log(`[gmail-sync] Found ${messageList.length} messages in last ${HOURS_LOOKBACK}h`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const msg of messageList) {
    try {
      const detail = await getMessageDetail(msg.id, token);
      const headers = detail.payload?.headers || [];

      const fromRaw = extractHeader(headers, 'From');
      const { email: senderEmail, name: senderName } = parseEmailAddress(fromRaw);
      const subject = extractHeader(headers, 'Subject') || '(no subject)';
      const date = extractHeader(headers, 'Date') || new Date().toISOString();
      const messageId = extractHeader(headers, 'Message-ID') || msg.id;
      const body = extractBody(detail.payload);
      const snippet = detail.snippet || '';

      // Detect Upwork
      const upworkInfo = detectUpwork(senderEmail, subject, body + snippet);

      // Skip our own non-upwork emails
      if (senderEmail.toLowerCase().includes('@ashbi.ca') && !upworkInfo) {
        skipped++;
        continue;
      }

      // Match sender to client (skip for Upwork)
      const clientMatch = upworkInfo ? null : await matchSenderToClient(senderEmail);

      // Triage
      let tags = triageEmail({ from: senderEmail, subject, body, isUpwork: !!upworkInfo });

      // Store
      const result = await storeInHub(
        { from: fromRaw, subject, body, threadId: detail.threadId, gmailMessageId: msg.id, date, senderEmail, senderName, snippet },
        clientMatch,
        tags,
        upworkInfo
      );

      if (result.skipped) {
        skipped++;
      } else {
        synced++;
        let dest = `→ triage [${result.tags?.join(', ')}]`;
        if (result.clientName) dest = `→ ${result.clientName} (thread ${result.threadId})`;
        if (result.upwork) dest = `→ Upwork inbox`;
        console.log(`[gmail-sync] ${senderEmail}: ${subject.substring(0, 60)} ${dest}`);
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      errors++;
      console.error(`[gmail-sync] Error processing message ${msg.id}:`, err.message);
    }
  }

  console.log(`[gmail-sync] Done: ${synced} synced, ${skipped} skipped, ${errors} errors`);
}

main()
  .catch((err) => {
    console.error('[gmail-sync] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
