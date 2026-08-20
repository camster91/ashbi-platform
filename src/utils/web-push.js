// Web Push Notifications (VAPID)
//
// Key source priority (highest wins):
//   1. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars (production / Coolify)
//   2. Persistent key file (VAPID_KEYS_PATH, /app/config in production)
//   3. webpush.generateVAPIDKeys() — last resort, persisted to disk so
//      the same key survives restarts.
//
// Pre-fix drift: code only checked step 2, while .env.example declared
// step 1. Deployments that set env vars would still hit step 2/3 and
// either generate a new ephemeral key per container restart (breaking
// push subscriptions across redeploys) or fail when the file wasn't
// writable. This commit unifies on the env-var-first pattern that
// .env.example already documented.
import webpush from 'web-push';
import prisma from '../config/db.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_KEYS_PATH = env.vapidKeysPath
  || (env.isProduction
    ? '/app/config/.vapid-keys.json'
    : path.join(__dirname, '../../.vapid-keys.json'));

let vapidKeys = null;

function tryLoadFromEnv() {
  const pub = env.vapidPublicKey;
  const priv = env.vapidPrivateKey;
  if (pub && priv) return { publicKey: pub, privateKey: priv, source: 'env' };
  return null;
}

function tryLoadFromFile() {
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf8'));
      if (parsed?.publicKey && parsed?.privateKey) return { ...parsed, source: 'file' };
    }
  } catch (e) {
    logger.warn({ path: VAPID_KEYS_PATH, err: e }, 'VAPID: could not read key file');
  }
  return null;
}

export function initVapid() {
  // 1. Env vars (production path)
  vapidKeys = tryLoadFromEnv()
    || (vapidKeys = tryLoadFromFile())
    || null;

  // 3. Generate + persist as last resort
  if (!vapidKeys) {
    const generated = webpush.generateVAPIDKeys();
    vapidKeys = { ...generated, source: 'generated' };
    try {
      fs.mkdirSync(path.dirname(VAPID_KEYS_PATH), { recursive: true });
      fs.writeFileSync(
        VAPID_KEYS_PATH,
        JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey }, null, 2),
        { mode: 0o600 }
      );
      logger.info({ path: VAPID_KEYS_PATH }, 'VAPID: generated new keys and persisted');
    } catch (e) {
      logger.warn({ err: e }, 'VAPID: could not persist generated keys — subscription IDs will rotate on every restart');
    }
  } else {
    logger.info({ source: vapidKeys.source, path: VAPID_KEYS_PATH }, 'VAPID: loaded existing keys');
  }

  webpush.setVapidDetails(
    'mailto:cameron@ashbi.ca',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  logger.info({ publicKeyPrefix: vapidKeys.publicKey.slice(0, 20) }, 'Web Push initialized');
  return vapidKeys;
}

export function getVapidPublicKey() {
  if (!vapidKeys) initVapid();
  return vapidKeys.publicKey;
}

// Send push to a specific subscription
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    // 410 Gone or 404 = subscription expired, remove it
    if (err.statusCode === 410 || err.statusCode === 404) {
      try {
        await prisma.pushSubscription.deleteMany({
          where: { endpoint: subscription.endpoint }
        });
      } catch {}
    }
    return false;
  }
}

// Send push to all subscriptions for a user
export async function sendPushToUser(userId, payload) {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId }
  });

  const results = await Promise.allSettled(
    subs.map(sub => {
      const subData = {
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys)
      };
      return sendPush(subData, payload);
    })
  );

  return results.filter(r => r.status === 'fulfilled' && r.value).length;
}

// Send push to all subscriptions (broadcast)
export async function sendPushToAll(payload) {
  const subs = await prisma.pushSubscription.findMany();

  const results = await Promise.allSettled(
    subs.map(sub => {
      const subData = {
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys)
      };
      return sendPush(subData, payload);
    })
  );

  return results.filter(r => r.status === 'fulfilled' && r.value).length;
}
