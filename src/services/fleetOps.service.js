// Fleet ops orchestrator service (Plan 7).
//
// Hub-side fan-out: receive ONE admin request, HMAC-sign it per-site, POST to
// each target plugin endpoint concurrently, aggregate results, persist an
// audit row.
//
// Wire format (matches PR #17 / PR #219 contract on the plugin side):
//   POST {siteUrl}/wp-json/ashbi/v1/{endpoint}
//   Headers:
//     content-type: application/json
//     X-Ashbi-Timestamp: <unix seconds>
//     X-Ashbi-Signature: sha256=<hmac_sha256(secret, timestamp + raw_body)>
//   Body: includes `_timestamp` field matching the header (so the plugin's
//     verifyBackupHmac-style preHandler can recompute the signature from the
//     raw bytes it captured in preParsing).
//
// Pure-vs-DB split (mirrors PR #220's `aggregateFleetStatusPure` pattern):
//   - Pure helpers (no prisma): executeFanOutPure, buildPerSiteRequest,
//     aggregateFleetOpResults, dryRunPreview.
//   - DB-bound wrappers: resolveTargetSites, recordFleetOp,
//     completeFleetOp, listFleetOps, executeFleetOp.
//
// Why split: the pure helpers can be unit-tested with synthetic inputs;
// the DB-bound wrappers are exercised via the integration test that
// inlines its own route handlers against a stub prisma (the production
// route imports `prisma` at module load, so we can't monkey-patch it).

import prisma from '../config/db.js';
import env from '../config/env.js';
import { signRequest } from '../lib/hmac-client.js';

export const PER_SITE_TIMEOUT_MS = 10_000;

// -----------------------------------------------------------------------------
// Pure helpers (no prisma). Unit-testable.
// -----------------------------------------------------------------------------

/**
 * Build the per-site request envelope (headers + raw body bytes) for an
 * endpoint fan-out.
 *
 * Strips `targetSites`, `targetAll`, and `_timestamp` from the input payload
 * so the hub controls the timestamp and the plugin doesn't see hub-side
 * routing metadata.
 *
 * Returns: { url, method, headers, rawBody, parsedBody }
 *   - rawBody is JSON.stringify(parsedBody) — the EXACT bytes that will be
 *     sent to the plugin (and the EXACT bytes that must be hashed).
 */
export function buildPerSiteRequest({ siteUrl, endpoint, payload, secret, timestamp }) {
  const body = { ...(payload || {}) };
  delete body.targetSites;
  delete body.targetAll;
  delete body._timestamp;

  const ts = Number.isFinite(timestamp) ? Math.floor(timestamp) : Math.floor(Date.now() / 1000);
  const parsedBody = { ...body, _timestamp: ts };
  const rawBody = JSON.stringify(parsedBody);
  const sigHeaders = signRequest({
    method: 'POST',
    path: `/wp-json/ashbi/v1/${endpoint}`,
    body: rawBody,
    secret,
    timestamp: ts
  });

  return {
    url: `${siteUrl}/wp-json/ashbi/v1/${endpoint}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...sigHeaders
    },
    rawBody,
    parsedBody
  };
}

/**
 * Fan out ONE per-site request with timeout + structured error handling.
 * This is the I/O-bound primitive — `executeFanOutPure` calls it once per
 * site in `Promise.all`.
 *
 * Returns: { siteUrl, status: 'ok'|'error', output?, error?, elapsedMs? }
 */
export async function fanOutOneSite({
  siteUrl,
  endpoint,
  payload,
  secret,
  timestamp,
  fetchImpl,
  timeoutMs = PER_SITE_TIMEOUT_MS,
  dryRun = false
}) {
  const start = Date.now();
  const req = buildPerSiteRequest({ siteUrl, endpoint, payload, secret, timestamp });

  if (dryRun) {
    return {
      siteUrl,
      status: 'ok',
      output: {
        dryRun: true,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.parsedBody
      },
      elapsedMs: Date.now() - start
    };
  }

  const f = fetchImpl ?? globalThis.fetch;
  if (typeof f !== 'function') {
    return {
      siteUrl,
      status: 'error',
      error: 'fetch is not available in this runtime'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.rawBody,
      signal: controller.signal
    });
    let parsed = null;
    const text = await res.text();
    if (text) {
      try { parsed = JSON.parse(text); } catch { /* keep raw text in output */ parsed = text; }
    }
    if (res.ok) {
      return {
        siteUrl,
        status: 'ok',
        output: { httpStatus: res.status, body: parsed },
        elapsedMs: Date.now() - start
      };
    }
    return {
      siteUrl,
      status: 'error',
      error: `HTTP ${res.status}`,
      output: parsed,
      elapsedMs: Date.now() - start
    };
  } catch (err) {
    const isAbort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return {
      siteUrl,
      status: 'error',
      error: isAbort ? `timeout after ${timeoutMs}ms` : (err && err.message) || String(err),
      elapsedMs: Date.now() - start
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aggregate a results array into { succeeded, failed, results }.
 * Pure — given a results array, returns counts. Used by `executeFanOutPure`
 * and exposed for tests that want to assert on aggregation in isolation.
 */
export function aggregateFleetOpResults(results) {
  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    if (r && r.status === 'ok') succeeded += 1;
    else failed += 1;
  }
  return { succeeded, failed, results };
}

/**
 * Run the fan-out concurrently across all target sites. Pure-ish: takes the
 * site list + a fan-out impl, no DB. This is what the integration test
 * exercises directly with a mocked fetch.
 */
export async function executeFanOutPure({
  targetSites,
  endpoint,
  payload,
  secret,
  fetchImpl,
  timeoutMs = PER_SITE_TIMEOUT_MS,
  dryRun = false,
  // Optional clock injection for tests; defaults to Date.now.
  now = () => Date.now()
}) {
  const targetArr = Array.isArray(targetSites) ? targetSites : [];
  if (targetArr.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }
  const ts = Math.floor(now() / 1000);
  // Concurrent fan-out via Promise.all — NOT serial. Each site runs in
  // parallel and the result array preserves the order of `targetArr`.
  const results = await Promise.all(
    targetArr.map((site) =>
      fanOutOneSite({
        siteUrl: site.url,
        endpoint,
        payload,
        secret,
        timestamp: ts,
        fetchImpl,
        timeoutMs,
        dryRun
      })
    )
  );
  const { succeeded, failed } = aggregateFleetOpResults(results);
  return { total: targetArr.length, succeeded, failed, results };
}

// -----------------------------------------------------------------------------
// DB-bound wrappers. Used by the production route handlers.
// -----------------------------------------------------------------------------

/**
 * Resolve target sites from a fan-out request.
 * - targetAll=true: every site in wPSite (id + url + name only)
 * - targetSites=[id-or-url, ...]: filter to matching IDs or URLs in wPSite
 * - neither: returns [] (caller should reject before calling executeFleetOp)
 */
export async function resolveTargetSites({ targetAll, targetSites } = {}) {
  if (targetAll === true) {
    return prisma.wPSite.findMany({
      select: { id: true, url: true, name: true },
      orderBy: { createdAt: 'asc' }
    });
  }
  if (Array.isArray(targetSites) && targetSites.length > 0) {
    return prisma.wPSite.findMany({
      where: {
        OR: [
          { id: { in: targetSites } },
          { url: { in: targetSites } }
        ]
      },
      select: { id: true, url: true, name: true },
      orderBy: { createdAt: 'asc' }
    });
  }
  return [];
}

/**
 * Insert a new fleet-ops audit row before fan-out starts. Returns the new
 * row's id (cuid).
 */
export async function recordFleetOp({ opType, payload, targetCount, createdBy }) {
  const row = await prisma.wPFleetOp.create({
    data: {
      opType,
      payload,
      targetCount,
      createdBy
    }
  });
  return row.id;
}

/**
 * Mark an op as completed with the final counts. Idempotent: a second call
 * just overwrites.
 */
export async function completeFleetOp({ opId, successCount, failureCount }) {
  return prisma.wPFleetOp.update({
    where: { id: opId },
    data: {
      successCount,
      failureCount,
      completedAt: new Date()
    }
  });
}

/**
 * List recent fleet ops, newest first. Used by GET /api/wp-bridge/fleet/ops
 * for the WPSites "Fleet Ops history" tab.
 */
export async function listFleetOps({ limit = 50, opType } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const where = {};
  if (opType) where.opType = opType;
  return prisma.wPFleetOp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: safeLimit
  });
}

/**
 * High-level orchestrator: resolve targets → fan out concurrently → persist
 * audit row. This is what the route handlers call.
 *
 * Returns: { opId, total, succeeded, failed, results }
 */
export async function executeFleetOp({
  opType,
  payload,
  targetSites,
  endpoint,
  createdBy,
  fetchImpl,
  dryRun = false,
  timeoutMs = PER_SITE_TIMEOUT_MS
}) {
  const targetArr = Array.isArray(targetSites) ? targetSites : [];
  // Record the row up front so an empty target list still leaves an audit trail.
  const opId = await recordFleetOp({
    opType,
    payload,
    targetCount: targetArr.length,
    createdBy
  });

  const fan = await executeFanOutPure({
    targetSites: targetArr,
    endpoint,
    payload,
    secret: env.wpBridgeSecret,
    fetchImpl,
    timeoutMs,
    dryRun
  });

  await completeFleetOp({
    opId,
    successCount: fan.succeeded,
    failureCount: fan.failed
  });

  return {
    opId,
    total: fan.total,
    succeeded: fan.succeeded,
    failed: fan.failed,
    results: fan.results
  };
}
