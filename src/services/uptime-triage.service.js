import crypto from 'crypto';
import { z } from 'zod';
import { MiniMaxMonitoringProvider } from '../ai/providers/minimax-monitoring.js';
import { canonicalSiteUrl } from '../security/wp-bridge-auth.js';

const triageSchema = z.object({
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(1000),
  recommendedAction: z.enum(['CHECK_SITE', 'CHECK_CERTIFICATE', 'CHECK_HOST', 'WAIT_FOR_RECOVERY', 'REVIEW_MANUALLY']),
  humanActionRequired: z.boolean()
});

function trimmedString(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeStatus(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (value === 1 || ['1', 'UP', 'OK', 'SUCCESS'].includes(normalized)) return 'UP';
  if (value === 0 || ['0', 'DOWN', 'ERROR', 'FAIL'].includes(normalized)) return 'DOWN';
  if (value === 2 || ['2', 'PENDING'].includes(normalized)) return 'PENDING';
  if (value === 3 || ['3', 'MAINTENANCE'].includes(normalized)) return 'MAINTENANCE';
  return 'UNKNOWN';
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

const sensitiveKey = /(?:authorization|cookie|credential|secret|password|token|api[_-]?key)/i;

/** Redacts credential-like fields and bounds stored monitoring evidence. */
export function redactMonitoringPayload(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactMonitoringPayload(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value).slice(0, 2_000);

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [key, sensitiveKey.test(key) ? '[redacted]' : redactMonitoringPayload(item, depth + 1)])
  );
}

/**
 * Converts the documented Ashbi Uptime Kuma webhook payload into a safe,
 * bounded incident record. The provider never receives arbitrary raw payloads.
 */
export function normalizeUptimeKumaEvent(body) {
  const monitor = body?.monitor && typeof body.monitor === 'object' ? body.monitor : {};
  const heartbeat = body?.heartbeat && typeof body.heartbeat === 'object' ? body.heartbeat : {};
  const monitorName = trimmedString(body?.monitorName || monitor.name, 255);
  const suppliedUrl = trimmedString(body?.monitorUrl || monitor.url, 2048);
  if (!monitorName || !suppliedUrl) throw new Error('monitorName and monitorUrl are required');

  let monitorUrl;
  try {
    monitorUrl = canonicalSiteUrl(suppliedUrl);
    if (!monitorUrl.startsWith('https://')) throw new Error('not HTTPS');
  } catch {
    throw new Error('monitorUrl must be a valid HTTPS URL');
  }

  const status = normalizeStatus(body?.status ?? heartbeat.status);
  const message = trimmedString(body?.message ?? heartbeat.msg ?? heartbeat.message, 1000) || null;
  const pingCandidate = body?.ping ?? heartbeat.ping;
  const pingMs = Number.isFinite(Number(pingCandidate)) && Number(pingCandidate) >= 0
    ? Math.min(Math.round(Number(pingCandidate)), 300_000)
    : null;
  const emittedAt = normalizeTimestamp(body?.timestamp ?? body?.time ?? heartbeat.time);
  const suppliedEventId = trimmedString(body?.eventId, 255);
  const fingerprint = JSON.stringify({ monitorUrl, monitorName, status, message, pingMs, emittedAt: emittedAt.toISOString() });
  const externalEventId = suppliedEventId || crypto.createHash('sha256').update(fingerprint).digest('hex');

  return { externalEventId, monitorName, monitorUrl, status, message, pingMs, emittedAt };
}

function promptForIncident(incident) {
  return JSON.stringify({
    monitorName: incident.monitorName,
    monitorUrl: incident.monitorUrl,
    status: incident.status,
    message: incident.message,
    pingMs: incident.pingMs,
    emittedAt: incident.emittedAt instanceof Date ? incident.emittedAt.toISOString() : incident.emittedAt
  });
}

/**
 * Returns a narrow decision that can enrich an alert, never an operational command.
 */
export async function triageMonitoringIncident(incident, { provider = new MiniMaxMonitoringProvider(), timeoutMs = 10_000 } = {}) {
  if (!provider.isConfigured()) {
    return { status: 'SKIPPED', reason: 'MINIMAX_MONITORING_UNAVAILABLE' };
  }

  try {
    const result = await provider.chatJSON({
      system: `You triage website monitoring incidents for an agency. Return valid JSON only with: severity (CRITICAL|HIGH|MEDIUM|LOW|INFO), confidence (0..1), summary, recommendedAction (CHECK_SITE|CHECK_CERTIFICATE|CHECK_HOST|WAIT_FOR_RECOVERY|REVIEW_MANUALLY), humanActionRequired (boolean). You do not have authority to change systems, suppress alerts, contact clients, or issue commands. If evidence is incomplete, choose REVIEW_MANUALLY.`,
      prompt: promptForIncident(incident),
      temperature: 0.1,
      maxTokens: 350,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: 'COMPLETED', triage: triageSchema.parse(result), provider: provider.name, model: provider.model || null };
  } catch (error) {
    return { status: 'FAILED', reason: error.code || 'MINIMAX_MONITORING_TRIAGE_FAILED' };
  }
}
