// Web Push Notifications (VAPID)
import webpush from 'web-push';
import { prisma } from '../index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_KEYS_PATH = path.join(__dirname, '../../.vapid-keys.json');

let vapidKeys = null;

export function initVapid() {
  // Try loading existing keys
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load VAPID keys, generating new ones');
  }

  // Generate if missing
  if (!vapidKeys) {
    vapidKeys = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
      console.log('Generated new VAPID keys');
    } catch (e) {
      console.warn('Could not persist VAPID keys:', e.message);
    }
  }

  webpush.setVapidDetails(
    'mailto:cameron@ashbi.ca',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  console.log('Web Push initialized with VAPID public key:', vapidKeys.publicKey.slice(0, 20) + '...');
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
