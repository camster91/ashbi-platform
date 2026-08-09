import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new IORedis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
});

try {
  await redis.connect();
  const raw = await redis.get('ashbi:workers:heartbeat');
  if (!raw) throw new Error('worker heartbeat is missing');
  const heartbeat = JSON.parse(raw);
  const ageMs = Date.now() - Date.parse(heartbeat.timestamp);
  if (!Number.isFinite(ageMs) || ageMs > 45_000) {
    throw new Error(`worker heartbeat is stale (${ageMs}ms)`);
  }
  if (process.env.APP_REVISION && heartbeat.revision !== process.env.APP_REVISION) {
    throw new Error(`worker revision mismatch (${heartbeat.revision})`);
  }
  process.stdout.write(`${JSON.stringify({ ...heartbeat, ageMs })}\n`);
} catch (error) {
  process.stderr.write(`worker unhealthy: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
