const baseUrl = (process.env.HEALTHCHECK_URL || 'https://hub.ashbi.ca').replace(/\/$/, '');
const expectedRevision = process.env.EXPECTED_REVISION;

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'User-Agent': 'ashbi-release-smoke/1.0' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const live = await readJson('/api/live');
// strict=1: the release is not verified until the worker heartbeat is fresh.
const ready = await readJson('/api/health?strict=1');

if (live.status !== 'ok') throw new Error('liveness did not report ok');
if (!ready.ready || ready.status !== 'ok') throw new Error('readiness did not report ok');
for (const dependency of ['database', 'redis', 'worker']) {
  if (ready.checks?.[dependency]?.status !== 'ok') throw new Error(`${dependency} readiness failed`);
}
if (!ready.revision || ready.revision === 'unknown') throw new Error('readiness omitted the exact revision');
// The image digest is detail-only (not public); deploy-vps-direct.sh verifies
// it on the host through /api/health/details before the release is recorded.
if (expectedRevision && ready.revision !== expectedRevision) {
  throw new Error(`revision mismatch: expected ${expectedRevision}, received ${ready.revision}`);
}
if (live.revision !== ready.revision) throw new Error('liveness/readiness revision mismatch');

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  revision: ready.revision,
  degraded: ready.degraded,
})}\n`);
