#!/usr/bin/env node

/**
 * Gmail -> Hub Sync
 *
 * Pulls emails from the last 48hrs from the connected Gmail inbox,
 * matches senders to Hub clients/contacts, stores via Prisma,
 * and applies local keyword triage tags.
 * A bounded rolling scan is partial stored history, not a full mailbox mirror.
 *
 * The mailbox belongs to one organization: GMAIL_SYNC_ORGANIZATION_ID (an
 * existing Organization id) is required, and senders are matched only
 * against that organization's clients (src/services/gmail-sync-matcher.js).
 * Without it the sync refuses to run.
 *
 * Usage: GMAIL_SYNC_ORGANIZATION_ID=<org id> node scripts/gmail-sync.js
 * Cron (every 30min 8am-10pm ET): use docker exec cron
 * Cron overnight: the same bounded rolling INBOX scan at 5am UTC
 */

// Prisma 7 ESM + driver adapter setup.
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestGmailMessage } from '../src/services/gmail-ingest.service.js';
import { scanGmailInbox } from '../src/services/gmail-sync-scan.js';
import { outboundSignal } from '../src/utils/outbound-timeouts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ==================== CONFIG ====================

const TOKENS_PATH = process.env.GMAIL_TOKENS_PATH
  || path.resolve(__dirname, '../config/google-tokens.json')
  || path.resolve(__dirname, '../../../.openclaw/workspace/memory/google-tokens.json');

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const HOURS_LOOKBACK = parseInt(process.env.GMAIL_LOOKBACK_HOURS || '48');
// The organization that owns the synced mailbox; resolved and checked in main().
const ORGANIZATION_ID = (process.env.GMAIL_SYNC_ORGANIZATION_ID || '').trim();

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
      throw new Error('GMAIL_SYNC_TOKEN_REFRESH_FAILED');
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
    signal: outboundSignal('api'),
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    throw new Error('GMAIL_SYNC_PROVIDER_REQUEST_FAILED');
  }
  return resp.json();
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
// matchSenderToClient(prisma, ORGANIZATION_ID, senderEmail) from
// src/services/gmail-sync-matcher.js: confined to the mailbox's organization.

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

// ==================== MAIN ====================

async function main() {
  if (!ORGANIZATION_ID) throw new Error('GMAIL_SYNC_ORGANIZATION_REQUIRED');
  if (!Number.isInteger(HOURS_LOOKBACK) || HOURS_LOOKBACK < 1 || HOURS_LOOKBACK > 168) throw new Error('GMAIL_SYNC_LOOKBACK_INVALID');
  const organization = await prisma.organization.findUnique({ where: { id: ORGANIZATION_ID }, select: { id: true } });
  if (!organization) throw new Error('GMAIL_SYNC_ORGANIZATION_UNAVAILABLE');
  const token = await getAccessToken();
  // Identity comes from the current authenticated provider, never a configured
  // address, sender header, alias, token contents, or deployment organization.
  const profile = await gmailFetch('/profile', token);
  const mailbox = typeof profile.emailAddress === 'string' ? profile.emailAddress.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox) || mailbox.length > 255) throw new Error('GMAIL_SYNC_MAILBOX_UNAVAILABLE');
  const after = Math.floor((Date.now() - HOURS_LOOKBACK * 3600000) / 1000);
  const query = `in:inbox after:${after}`;
  const result = await scanGmailInbox({
    query, lookbackHours: HOURS_LOOKBACK,
    fetchPage: ({ query, pageToken, maxResults }) => {
      const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
      if (pageToken) params.set('pageToken', pageToken);
      return gmailFetch(`/messages?${params}`, token);
    },
    processMessage: async providerMessageId => {
      const detail = await getMessageDetail(providerMessageId, token);
      if (detail.id !== providerMessageId) throw new Error('GMAIL_SYNC_MESSAGE_ID_CHANGED');
      const headers = detail.payload?.headers || [];
      const { email: senderEmail, name: senderName } = parseEmailAddress(extractHeader(headers, 'From'));
      const subject = extractHeader(headers, 'Subject') || '(no subject)';
      const body = extractBody(detail.payload || {});
      const upworkInfo = detectUpwork(senderEmail, subject, body + (detail.snippet || ''));
      if (senderEmail.toLowerCase().split('@')[1] === 'ashbi.ca' && !upworkInfo) return { skipped: true };
      const receivedAt = new Date(Number(detail.internalDate));
      return ingestGmailMessage(prisma, {
        organizationId: ORGANIZATION_ID, mailbox, providerMessageId, providerThreadId: detail.threadId,
        senderEmail, senderName: senderName?.substring(0, 255) || null, subject: subject.substring(0, 1000),
        bodyText: body.substring(0, 50000), receivedAt,
        tags: triageEmail({ from: senderEmail, subject, body, isUpwork: !!upworkInfo }), upwork: !!upworkInfo,
      });
    },
  });
  console.log(`GMAIL_SYNC_SUMMARY ${JSON.stringify(result)}`);
}

main().catch(() => {
  // Provider responses can contain mailbox content or OAuth details. Keep
  // both cron logs and the admin child-process response free of that content.
  console.error('[gmail-sync] Sync failed; scan incomplete.');
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
