import https from 'node:https';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGuardedLookup } from '../security/safe-fetch.js';

export const OPENSEO_MCP_URL = 'https://openseo.ashbi.ca/mcp';
const opaque = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const plain = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[<>]/.test(value) && [...value].every(char => char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0)));
export function isOpenSeoCredential(credential) {
  if (!credential || credential.projectId !== null || !credential.username || [...credential.username].some(char => char === ':' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(credential.url);
    return url.origin === 'https://openseo.ashbi.ca' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Fixed-origin, DNS-at-socket-connection guarded fetch for the real SDK. */
export function createOpenSeoFetch({ username, password, signal, lookup, request = https.request }) {
  let totalBytes = 0;
  const guardedLookup = createGuardedLookup({ allowLocalhost: false, lookup });
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  return async (url, init = {}) => {
    if (String(url) !== OPENSEO_MCP_URL || !['POST', 'GET', 'DELETE'].includes(init.method ?? 'GET')) throw new Error('Provider transport refused');
    const headers = new Headers(init.headers);
    headers.set('Authorization', authorization);
    return new Promise((resolve, reject) => {
      const req = request(new URL(OPENSEO_MCP_URL), { method: init.method ?? 'GET', headers: Object.fromEntries(headers), lookup: guardedLookup,
        signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }, res => {
        if (!Number.isInteger(res.statusCode) || res.statusCode < 200 || res.statusCode > 599) { res.resume(); req.destroy(); reject(new Error('Invalid provider response')); return; }
        if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); req.destroy(); reject(new Error('Provider redirect refused')); return; }
        const chunks = [];
        res.on('data', chunk => { totalBytes += chunk.length; if (totalBytes > 2 * 1024 * 1024) { req.destroy(new Error('Provider response limit')); return; } chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          try { resolve(new Response([204, 205].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })); }
          catch { reject(new Error('Invalid provider response')); }
        });
      });
      req.on('error', reject);
      req.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Provider upgrade refused')); });
      if (init.body) req.write(init.body);
      req.end();
    });
  };
}

/** No research/list-tools/generic caller-supplied tool names. One bounded page. */
export async function readOpenSeoReports({ projectId, username, password, fetchFactory = createOpenSeoFetch }) {
  if (!opaque(projectId) || typeof username !== 'string' || typeof password !== 'string' || !password || password.length > 8192) throw new Error('Provider credentials unavailable');
  const signal = AbortSignal.timeout(20000);
  const client = new Client({ name: 'ashbi-saved-reports', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(OPENSEO_MCP_URL), { fetch: fetchFactory({ username, password, signal }), reconnectionOptions: { maxRetries: 0 } });
  try {
    await client.connect(transport, { signal, timeout: 20000 });
    const page = await client.callTool({ name: 'list_reports', arguments: { projectId, limit: 20, offset: 0 } }, undefined, { signal, timeout: 20000 });
    const data = page.structuredContent;
    if (page.isError || !data || !Array.isArray(data.reports) || data.reports.length > 20 || !Number.isInteger(data.totalCount) || data.totalCount < data.reports.length || data.totalCount > 2147483647) throw new Error('Invalid provider report page');
    const ids = data.reports.map(row => row.id);
    if (ids.some(id => !opaque(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid provider identifiers');
    const reports = [];
    for (const id of ids) {
      const result = await client.callTool({ name: 'get_report', arguments: { projectId, reportId: id, includeHtml: false } }, undefined, { signal, timeout: 20000 });
      const report = result.structuredContent?.report;
      if (result.isError || !report || report.id !== id || report.projectId !== projectId || !plain(report.title, 200) || !plain(report.summary, 4000)) throw new Error('Invalid provider report');
      const editedAt = new Date(report.updatedAt);
      if (!z.string().datetime({ offset: true }).safeParse(report.updatedAt).success || !Number.isFinite(editedAt.getTime()) || editedAt.getTime() > Date.now()) throw new Error('Invalid provider edit time');
      reports.push({ providerReportId: id, title: report.title.trim(), summary: report.summary.trim(), providerEditedAt: editedAt });
    }
    // Even a zero count is only an observation of this changing page, never deletion authority.
    return { reports, partial: true, providerTotalCount: data.totalCount, outcome: reports.length ? 'OK' : 'EMPTY' };
  } finally { await client.close().catch(() => {}); }
}
