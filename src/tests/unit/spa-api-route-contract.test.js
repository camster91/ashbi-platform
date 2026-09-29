import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectRouteInventory } from '../helpers/route-inventory.js';

// SPA ↔ server route contract.
//
// Every endpoint the SPA's API client (web/src/lib/api.js) calls must be a
// route the built application registers. The QA audit found project time
// entries, timesheets and milestones calling paths that did not exist (404 in
// production), and a "delete time entry" button that hit a different model's
// route. This test parses every `request(...)` call and every
// `${API_BASE}/...` URL in api.js, normalizes template parameters, and matches
// method + path against the real route inventory.

const API_CLIENT = new URL('../../../web/src/lib/api.js', import.meta.url);

// Calls that intentionally do not match a registered route. Each entry needs a
// reason; an entry that no longer matches any unmatched call fails the test so
// the list cannot go stale.
/** @type {Record<string, string>} */
const ALLOWLIST = {
  // `${data.action}` is 'approve' or 'decline'; both
  // POST /api/portal/proposal/:viewToken/approve|decline are registered.
  'POST /portal/proposal/:param/:param': 'action segment is approve|decline, both registered',
  // Invoice/proposal/contract/Stripe paths are owned by a separate remediation
  // track; these known mismatches are reported there, not fixed here.
  'POST /proposals/generate': 'proposal track: no AI proposal generation route is registered',
  'POST /proposals/:param/pdf': 'proposal track: PDFs are served by GET /api/proposal-builder/:id/pdf',
  'POST /proposals-ai/generate': 'proposal track: no proposals-ai route is registered (used by Proposals.jsx)',
  'POST /sales/proposal/generate': 'proposal track: no sales route is registered (used by Proposals.jsx)',
};

/**
 * Read one JavaScript string or template literal starting at `start`.
 * Returns the literal's raw parts (template quasis) and expression sources.
 *
 * @param {string} src
 * @param {number} start index of the opening quote/backtick
 * @returns {{ end: number, kind: 'string' | 'template', quasis: string[], expressions: string[] }}
 */
function readLiteral(src, start) {
  const quote = src[start];
  if (quote !== '`') {
    let i = start + 1;
    let value = '';
    while (src[i] !== quote) {
      if (src[i] === '\\') { value += src[i + 1]; i += 2; continue; }
      value += src[i];
      i += 1;
    }
    return { end: i + 1, kind: 'string', quasis: [value], expressions: [] };
  }
  const quasis = [''];
  const expressions = [];
  let i = start + 1;
  while (src[i] !== '`') {
    if (src[i] === '\\') { quasis[quasis.length - 1] += src[i + 1]; i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      const exprStart = i + 2;
      const exprEnd = skipBalanced(src, exprStart, '}');
      expressions.push(src.slice(exprStart, exprEnd));
      quasis.push('');
      i = exprEnd + 1;
      continue;
    }
    quasis[quasis.length - 1] += src[i];
    i += 1;
  }
  return { end: i + 1, kind: 'template', quasis, expressions };
}

/**
 * Advance from `i` to the index of the unmatched closing character `close`,
 * skipping nested brackets and string/template literals.
 *
 * @param {string} src
 * @param {number} i
 * @param {string} close
 */
function skipBalanced(src, i, close) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [close];
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\'' || ch === '"' || ch === '`') { i = readLiteral(src, i).end; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
    i += 1;
  }
  throw new Error(`Unbalanced source near index ${i}`);
}

/**
 * Split the top-level, comma-separated arguments of a call whose "(" is at
 * `open`.
 *
 * @param {string} src
 * @param {number} open
 */
function callArguments(src, open) {
  const close = skipBalanced(src, open + 1, ')');
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = open + 1; i < close; i += 1) {
    const ch = src[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const { end } = readLiteral(src, i);
      current += src.slice(i, end);
      i = end - 1;
      continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Top-level string/template literals of an expression (e.g. both arms of a
 * ternary), each converted into a normalized path.
 *
 * @param {string} expression
 */
function literalPaths(expression) {
  const concatenated = concatenationLiteral(expression);
  if (concatenated) return [normalizeLiteral(concatenated)];
  const paths = [];
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const literal = readLiteral(expression, i);
      paths.push(normalizeLiteral(literal));
      i = literal.end - 1;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      i = skipBalanced(expression, i + 1, { '(': ')', '[': ']', '{': '}' }[ch]);
    }
  }
  return paths;
}

/**
 * `'/a/' + id + '/b'` → the equivalent template literal parts, or null when
 * the expression is not a top-level string concatenation.
 *
 * @param {string} expression
 */
function concatenationLiteral(expression) {
  const parts = [];
  let current = '';
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const { end } = readLiteral(expression, i);
      current += expression.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      const end = skipBalanced(expression, i + 1, { '(': ')', '[': ']', '{': '}' }[ch]);
      current += expression.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '?') return null; // a ternary, handled by the caller
    if (ch === '+') { parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  parts.push(current.trim());
  if (parts.length < 2 || !/^['"`]/.test(parts[0])) return null;
  const quasis = [''];
  const expressions = [];
  for (const part of parts) {
    const quote = part[0];
    const literal = (quote === '\'' || quote === '"' || quote === '`') ? readLiteral(part, 0) : null;
    if (literal && literal.end === part.length) {
      quasis[quasis.length - 1] += literal.quasis[0];
      for (let j = 1; j < literal.quasis.length; j += 1) {
        expressions.push(literal.expressions[j - 1]);
        quasis.push(literal.quasis[j]);
      }
    } else {
      expressions.push(part);
      quasis.push('');
    }
  }
  return { quasis, expressions };
}

/**
 * Turn a literal into a path pattern: a `${expr}` that fills a whole path
 * segment becomes `:param`; a trailing `${expr}` glued onto a segment is a
 * query-string suffix and is dropped; the query string is removed.
 *
 * @param {{ quasis: string[], expressions: string[] }} literal
 */
function normalizeLiteral({ quasis, expressions }) {
  let path = '';
  for (let index = 0; index < quasis.length; index += 1) {
    const quasi = quasis[index];
    const queryAt = quasi.indexOf('?');
    if (queryAt !== -1) { path += quasi.slice(0, queryAt); break; }
    path += quasi;
    if (index >= expressions.length) break;
    const expression = expressions[index].trim();
    const next = quasis[index + 1] ?? '';
    if (expression === 'API_BASE') continue;
    const fillsSegment = path.endsWith('/') && (next === '' || next.startsWith('/') || next.startsWith('?'));
    if (fillsSegment) { path += ':param'; continue; }
    if (next === '' && index === expressions.length - 1) break; // query-string suffix
    path += '*';
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** @param {string} args */
function methodOf(args) {
  const match = /method:\s*'([A-Z]+)'/.exec(args ?? '');
  return match ? match[1] : 'GET';
}

/**
 * Every (method, path) the API client calls, with the api.js line number.
 *
 * @param {string} src
 */
export function extractSpaCalls(src) {
  const calls = [];
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const requestCall = /(?<![\w.$])request\(/g;
  for (const match of src.matchAll(requestCall)) {
    const open = match.index + match[0].length - 1;
    const before = src.slice(Math.max(0, match.index - 20), match.index);
    if (/function\s+$/.test(before)) continue; // the helper's own definition
    const lineStart = src.lastIndexOf('\n', match.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, match.index))) continue; // comment
    const [endpoint, options] = callArguments(src, open);
    if (endpoint === 'endpoint') continue; // the helper's internal retry
    const paths = literalPaths(endpoint);
    if (paths.length === 0) {
      calls.push({ method: methodOf(options), path: null, source: endpoint, line: lineOf(match.index) });
      continue;
    }
    for (const path of paths) calls.push({ method: methodOf(options), path, line: lineOf(match.index) });
  }
  // `${API_BASE}/...` URLs used by raw fetch() uploads and by links/iframes.
  const apiBaseTemplate = /`\$\{API_BASE\}/g;
  for (const match of src.matchAll(apiBaseTemplate)) {
    const literal = readLiteral(src, match.index);
    const path = normalizeLiteral(literal);
    if (path === '' || path.startsWith(':')) continue; // `${API_BASE}${endpoint}` in request()
    const tail = src.slice(literal.end, literal.end + 200);
    const fetchOptions = /^\s*,\s*\{([^}]*)\}/.exec(tail);
    calls.push({ method: fetchOptions ? methodOf(fetchOptions[1]) : 'GET', path, line: lineOf(match.index) });
  }
  // `const url = \`${API_BASE}/x\`; fetch(url, { method })` — method follows.
  for (const call of calls) {
    if (call.method !== 'GET') continue;
    const lineText = src.split('\n')[call.line - 1];
    if (!/const url = `\$\{API_BASE\}/.test(lineText)) continue;
    const following = src.split('\n').slice(call.line, call.line + 4).join('\n');
    call.method = methodOf(following);
  }
  return calls;
}

/**
 * @param {string} spaPath normalized SPA path, relative to /api
 * @param {string} routeUrl registered route URL, relative to /api
 */
export function pathMatches(spaPath, routeUrl) {
  const spa = spaPath.split('/').filter(Boolean);
  const route = routeUrl.split('/').filter(Boolean);
  for (let i = 0; i < spa.length; i += 1) {
    const routeSegment = route[i];
    if (routeSegment === undefined) return false;
    if (routeSegment === '*') return true;
    // A runtime value only fills a route parameter; it is never assumed to
    // equal a literal segment (that would hide calls to the wrong route).
    if (spa[i] === ':param') {
      if (!routeSegment.startsWith(':')) return false;
      continue;
    }
    if (routeSegment.startsWith(':')) continue;
    if (spa[i].includes('*')) {
      const pattern = new RegExp(`^${spa[i].split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
      if (!pattern.test(routeSegment)) return false;
      continue;
    }
    if (spa[i] !== routeSegment) return false;
  }
  return spa.length === route.length || route[spa.length] === '*';
}

test('the API client parser understands templates, ternaries, queries and raw fetch URLs', () => {
  const sample = [
    "a: () => request('/auth/login', { method: 'POST', body: {} }),",
    'b: (id) => request(`/projects/${id}/time-entries`),',
    'c: (p) => { const query = new URLSearchParams(p).toString(); return request(`/inbox${query ? `?${query}` : \'\'}`); },',
    "d: (x) => request(x ? '/on' : '/off', { method: 'POST' }),",
    'e: (a, b) => request(`/attachments?entityType=${a}&entityId=${b}`),',
    'f: () => fetch(`${API_BASE}/attachments`, { method: \'POST\', body: form }),',
    'g: (t) => `${API_BASE}/portal/review/${encodeURIComponent(t)}/file`,',
    'h: (id) => request(`/tasks/${id}/`, { method: \'DELETE\' }),',
    "i: (id) => request('/notifications/' + id + '/read', { method: 'PATCH' }),",
    "j: (p) => request('/notifications?' + new URLSearchParams(p).toString()),",
  ].join('\n');
  assert.deepEqual(extractSpaCalls(sample).map(({ method, path }) => `${method} ${path}`), [
    'POST /auth/login',
    'GET /projects/:param/time-entries',
    'GET /inbox',
    'POST /on',
    'POST /off',
    'GET /attachments',
    'DELETE /tasks/:param',
    'PATCH /notifications/:param/read',
    'GET /notifications',
    'POST /attachments',
    'GET /portal/review/:param/file',
  ]);
  assert.equal(pathMatches('/projects/:param/time-entries', '/projects/:projectId/time-entries'), true);
  assert.equal(pathMatches('/projects/:param/time-entries', '/time/projects/:projectId/time-entries'), false);
  assert.equal(pathMatches('/attachments/uploads/:param', '/attachments/uploads/*'), true);
  // A runtime value never stands in for a literal segment.
  assert.equal(pathMatches('/tasks/:param/comments', '/tasks/kanban/:projectId'), false);
});

test('every endpoint the SPA API client calls is a registered route', async () => {
  const source = fs.readFileSync(API_CLIENT, 'utf8');
  const calls = extractSpaCalls(source);
  assert.ok(calls.length > 300, `expected to parse the whole API client, parsed ${calls.length} calls`);

  const inventory = await collectRouteInventory();
  const routes = inventory
    .filter((route) => route.url.startsWith('/api/'))
    .map((route) => ({ method: route.method, url: route.url.slice('/api'.length) }));

  const unmatched = [];
  const allowlisted = new Set();
  for (const call of calls) {
    const key = `${call.method} ${call.path ?? call.source}`;
    if (call.path === null) {
      if (ALLOWLIST[key]) { allowlisted.add(key); continue; }
      unmatched.push(`api.js:${call.line} ${call.method} <dynamic ${call.source}>`);
      continue;
    }
    const hit = routes.some((route) => (route.method === call.method || (call.method === 'GET' && route.method === 'HEAD'))
      && pathMatches(call.path, route.url));
    if (hit) continue;
    if (ALLOWLIST[key]) { allowlisted.add(key); continue; }
    unmatched.push(`api.js:${call.line} ${key}`);
  }

  assert.deepEqual(unmatched, [], `SPA calls with no registered route:\n${unmatched.join('\n')}`);
  const stale = Object.keys(ALLOWLIST).filter((key) => !allowlisted.has(key));
  assert.deepEqual(stale, [], 'allowlisted calls that now match a route (remove them)');
});
