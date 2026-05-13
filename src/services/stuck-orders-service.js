// Stuck Orders Service
// Iterates all WooCommerce store sites via SSH, finds orders in wc-pending/wc-processing/wc-on-hold
// that are >24h old, returns aggregated results, and provides resolution actions.
//
// SSH connection to Hostinger monitoring server:
//   ssh -p 65002 u633679196@88.223.82.6
// Then WP CLI queries per store domain.
//
// Stores are sourced from HOSTINGER_INFLUENCER_STORES env var (comma-separated domains).
// Each store's WP path on the server: ~/domains/{domain}/public_html

import { Client as SSHClient } from 'ssh2';
import { Readable } from 'stream';
import env from '../config/env.js';

const HOSTINGER_HOST = '88.223.82.6';
const HOSTINGER_PORT = 65002;
const HOSTINGER_USER = 'u633679196';

// ─────────────────────────────────────────────
// Query builders — each status gets its own age threshold
// ─────────────────────────────────────────────

/** WP CLI query for stuck orders >24h in wc-pending / wc-processing / wc-on-hold */
function stuckOrdersQuery() {
  // Returns ID, post_date, _order_total (amount), _billing_email
  return [
    'wp', 'post', 'list',
    '--post_type=shop_order',
    '--post_status=wc-pending,wc-processing,wc-on-hold',
    '--date_query_after=24 hours ago',
    '--fields=ID,post_date,post_status',
    '--format=json'
  ].join(' ');
}

/** WP CLI command to get full order details for a stuck order */
function orderDetailsQuery(orderId) {
  return [
    'wp', 'post', 'get', orderId,
    '--field=ID',
    '--format=json'
  ].join(' ');
}

/** WP CLI command to get order meta (amount, email, date) via eval */
function orderMetaQuery(orderId) {
  return [
    'wp', 'eval',
    `echo json_encode([
      'id' => ${orderId},
      'total' => get_post_meta(${orderId}, '_order_total', true),
      'email' => get_post_meta(${orderId}, '_billing_email', true),
      'date_created' => get_post_meta(${orderId}, '_date_created', true),
      'status' => get_post_status(${orderId})
    ]);`
  ].join(' ');
}

/** WP CLI command to update order status */
function updateOrderStatusCmd(orderId, newStatus) {
  return [
    'wp', 'post', 'update', orderId,
    `--post_status=${newStatus}`
  ].join(' ');
}

// ─────────────────────────────────────────────
// SSH exec helper
// ─────────────────────────────────────────────

function execSSH(command) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data) => { stdout += data; });
        stream.on('close', () => {
          conn.end();
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
        stream.stderr.on('data', (data) => { stderr += data; });
      });
    });
    conn.on('error', reject);
    // Use SSH agent or password from env
    const connectConfig = {
      host: HOSTINGER_HOST,
      port: HOSTINGER_PORT,
      username: HOSTINGER_USER,
      // Try SSH agent first, then key file
      ...(process.env.HOSTINGER_SSH_KEY ? { privateKey: require('fs').readFileSync(process.env.HOSTINGER_SSH_KEY) } : {}),
      ...(process.env.HOSTINGER_SSH_PASSPHRASE ? { passphrase: process.env.HOSTINGER_SSH_PASSPHRASE } : {}),
    };
    conn.connect(connectConfig);
  });
}

// ─────────────────────────────────────────────
// Store list
// ─────────────────────────────────────────────

function getStoreDomains() {
  const envStores = process.env.HOSTINGER_INFLUENCER_STORES || '';
  if (!envStores.trim()) return [];
  return envStores.split(',').map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────
// Age helpers
// ─────────────────────────────────────────────

function ageInHours(postDateStr) {
  if (!postDateStr) return null;
  const postDate = new Date(postDateStr);
  const now = new Date();
  return Math.round((now - postDate) / (1000 * 60 * 60) * 10) / 10;
}

// ─────────────────────────────────────────────
// Core: get stuck orders for ONE store
// ─────────────────────────────────────────────

async function getStuckOrdersForStore(domain) {
  const wpPath = `domains/${domain}/public_html`;
  const cmd = `cd ~/${wpPath} && ${stuckOrdersQuery()}`;

  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execSSH(cmd));
  } catch (err) {
    return {
      storeDomain: domain,
      storeName: domain,
      storeId: domain,
      orders: [],
      error: `SSH error: ${err.message}`,
      checkedAt: new Date().toISOString()
    };
  }

  if (!stdout) {
    return {
      storeDomain: domain,
      storeName: domain,
      storeId: domain,
      orders: [],
      checkedAt: new Date().toISOString()
    };
  }

  let rawOrders;
  try {
    rawOrders = JSON.parse(stdout);
  } catch {
    return {
      storeDomain: domain,
      storeName: domain,
      storeId: domain,
      orders: [],
      error: `Parse error: ${stdout.substring(0, 200)}`,
      checkedAt: new Date().toISOString()
    };
  }

  // For each raw order, fetch full meta details
  const enrichedOrders = await Promise.allSettled(
    rawOrders.map(raw => enrichOrder(domain, raw))
  );

  return {
    storeDomain: domain,
    storeName: domain,
    storeId: domain,
    orders: enrichedOrders
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(o => o.age_in_hours !== null),
    checkedAt: new Date().toISOString()
  };
}

async function enrichOrder(domain, raw) {
  const wpPath = `domains/${domain}/public_html`;
  const orderId = raw.ID;

  // Use a combined WP eval to get all meta in one shot
  const metaCmd = `cd ~/${wpPath} && wp eval 'echo json_encode([
    "id" => ${orderId},
    "total" => get_post_meta(${orderId}, "_order_total", true),
    "email" => get_post_meta(${orderId}, "_billing_email", true),
    "date_created_gmt" => get_post_meta(${orderId}, "_date_created", true),
    "status" => get_post_status(${orderId})
  ]);'`;

  let meta = { id: orderId, total: null, email: null, date_created_gmt: null, status: raw.post_status };
  try {
    const { stdout: metaOut } = await execSSH(metaCmd);
    if (metaOut) {
      const parsed = JSON.parse(metaOut);
      meta = { ...meta, ...parsed };
    }
  } catch {
    // Fall back to raw data
  }

  const age_hours = ageInHours(raw.post_date);
  const statusSlug = meta.status || raw.post_status;

  return {
    order_id: orderId,
    store_domain: domain,
    store_id: domain,
    status: statusSlug,
    status_label: statusLabel(statusSlug),
    amount: parseFloat(meta.total) || null,
    customer_email: meta.email || null,
    date_created_gmt: raw.post_date,
    age_in_hours: age_hours,
    // Severity flags based on age
    severity: deriveSeverity(statusSlug, age_hours),
  };
}

function statusLabel(slug) {
  const labels = {
    'wc-pending': 'Pending Payment',
    'wc-processing': 'Processing',
    'wc-on-hold': 'On Hold',
    'wc-completed': 'Completed',
    'wc-cancelled': 'Cancelled',
    'wc-refunded': 'Refunded',
    'wc-failed': 'Failed',
  };
  return labels[slug] || slug;
}

function deriveSeverity(status, age_hours) {
  if (age_hours === null) return 'unknown';
  if (status === 'wc-on-hold' && age_hours > 72) return 'critical';
  if (status === 'wc-processing' && age_hours > 168) return 'critical'; // >7 days
  if (status === 'wc-pending' && age_hours > 336) return 'critical';    // >14 days
  if (status === 'wc-on-hold' && age_hours > 24) return 'warning';
  if (status === 'wc-pending' && age_hours > 48) return 'warning';
  if (status === 'wc-processing' && age_hours > 72) return 'warning';
  return 'normal';
}

// ─────────────────────────────────────────────
// Main public API
// ─────────────────────────────────────────────

/**
 * Scan all configured WooCommerce stores for stuck orders (>24h old).
 * Returns aggregated results across all stores.
 */
export async function scanAllStores() {
  const domains = getStoreDomains();

  if (domains.length === 0) {
    return {
      summary: { total_stores: 0, total_stuck_orders: 0, critical_count: 0, warning_count: 0 },
      stores: [],
      errors: ['No stores configured. Set HOSTINGER_INFLUENCER_STORES env var.'],
      scannedAt: new Date().toISOString()
    };
  }

  const results = await Promise.allSettled(
    domains.map(domain => getStuckOrdersForStore(domain))
  );

  const stores = results.map(r =>
    r.status === 'fulfilled' ? r.value : { storeDomain: 'unknown', orders: [], error: r.reason?.message }
  );

  const totalStuck = stores.reduce((sum, s) => sum + (s.orders?.length || 0), 0);
  const criticalCount = stores.reduce((sum, s) =>
    sum + (s.orders?.filter(o => o.severity === 'critical').length || 0), 0);
  const warningCount = stores.reduce((sum, s) =>
    sum + (s.orders?.filter(o => o.severity === 'warning').length || 0), 0);

  return {
    summary: {
      total_stores: domains.length,
      stores_with_orders: stores.filter(s => (s.orders?.length || 0) > 0).length,
      total_stuck_orders: totalStuck,
      critical_count: criticalCount,
      warning_count: warningCount,
    },
    stores,
    scannedAt: new Date().toISOString()
  };
}

/**
 * Get stuck orders for a specific store.
 */
export async function getStuckOrdersForStoreExport(domain) {
  return getStuckOrdersForStore(domain);
}

/**
 * Resolve (update / cancel / complete) a specific stuck order.
 *
 * @param {string} storeId  - store domain
 * @param {number} orderId - WooCommerce order ID
 * @param {string} action   - 'complete' | 'cancel' | 'on-hold' | 'processing' | 'pending'
 */
export async function resolveOrder(storeId, orderId, action) {
  const validActions = ['complete', 'cancel', 'on-hold', 'processing', 'pending'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action. Must be one of: ${validActions.join(', ')}`);
  }

  const statusMap = {
    complete: 'wc-completed',
    cancel: 'wc-cancelled',
    'on-hold': 'wc-on-hold',
    processing: 'wc-processing',
    pending: 'wc-pending',
  };

  const newStatus = statusMap[action];
  const wpPath = `domains/${storeId}/public_html`;
  const cmd = `cd ~/${wpPath} && ${updateOrderStatusCmd(orderId, newStatus)}`;

  let result;
  try {
    result = await execSSH(cmd);
  } catch (err) {
    throw new Error(`Failed to update order ${orderId} on ${storeId}: ${err.message}`);
  }

  if (result.stderr && result.stderr.includes('Error')) {
    throw new Error(`WP CLI error: ${result.stderr}`);
  }

  return {
    success: true,
    order_id: orderId,
    store_id: storeId,
    action,
    new_status: newStatus,
    resolvedAt: new Date().toISOString(),
    output: result.stdout
  };
}

/**
 * Bulk resolve all stuck orders of a given severity for a store.
 *
 * @param {string} storeId   - store domain
 * @param {string} severity  - 'critical' | 'warning' | 'all'
 * @param {string} action   - 'complete' | 'cancel'
 */
export async function bulkResolveStoreOrders(storeId, severity = 'all', action = 'cancel') {
  const storeResult = await getStuckOrdersForStore(storeId);
  const orders = storeResult.orders || [];

  const toResolve = orders.filter(o => {
    if (severity === 'all') return true;
    return o.severity === severity;
  });

  if (toResolve.length === 0) {
    return {
      store_id: storeId,
      action,
      resolved: 0,
      orders: [],
      message: `No ${severity} stuck orders found for ${storeId}`,
      resolvedAt: new Date().toISOString()
    };
  }

  const results = await Promise.allSettled(
    toResolve.map(o => resolveOrder(storeId, o.order_id, action))
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failed = results
    .filter(r => r.status === 'rejected')
    .map(r => ({ order_id: 'unknown', error: r.reason?.message }));

  return {
    store_id: storeId,
    action,
    severity,
    total_found: toResolve.length,
    resolved: succeeded.length,
    failed: failed.length,
    results: succeeded,
    errors: failed,
    resolvedAt: new Date().toISOString()
  };
}
