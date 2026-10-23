// Local-only proof, not a deployable identity service. See SPEC.md and #416.
// D1 API: https://developers.cloudflare.com/d1/worker-api/d1-database/
const json = (body, status = 200) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
} });
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw 400;
  // Count actual streamed bytes; Content-Length alone is caller-controlled.
  const reader = request.body?.getReader();
  if (!reader) throw 400;
  let size = 0; const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw 413; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw 400; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 400;
  return parsed;
}
const fields = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
async function handle(request, env) {
  const url = new URL(request.url);
  if (env.LOCAL_PROTOTYPE !== 'true' || !['localhost', '127.0.0.1'].includes(url.hostname)) return json({ error: 'Not found' }, 404);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);
  }
  const db = env.DB;
  if (url.pathname === '/api/session' && request.method === 'POST') {
    const input = await body(request);
    if (!fields(input, ['code']) || typeof input.code !== 'string' || input.code.length > 128) throw 400;
    // Atomic one-time redemption; fixture codes are random and expire quickly.
    const redeemed = await db.prepare('UPDATE login_codes SET consumed = 1 WHERE code_hash = ? AND consumed = 0 AND expires_at > ? RETURNING actor_id')
      .bind(await hash(input.code), Date.now()).first();
    if (!redeemed) return json({ error: 'Unauthorised' }, 401);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await hash(token), redeemed.actor_id, Date.now() + 15 * 60_000).run();
    return json({ token, expiresInSeconds: 900 }, 201);
  }
  const rawToken = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!rawToken) return json({ error: 'Unauthorised' }, 401);
  const tokenHash = await hash(rawToken);
  const actor = await db.prepare('SELECT a.* FROM sessions s JOIN actors a ON a.id = s.actor_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(tokenHash, Date.now()).first();
  if (!actor) return json({ error: 'Unauthorised' }, 401);
  if (url.pathname === '/api/session' && request.method === 'DELETE') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  const match = url.pathname.match(/^\/api\/notes(?:\/([a-f0-9-]{36}))?$/);
  if (!match) return json({ error: 'Not found' }, 404);
  const id = match[1];
  const visibility = actor.role === 'staff' ? '' : ' AND client_id = ? AND client_visible = 1';
  const scope = actor.role === 'staff' ? [actor.organization_id] : [actor.organization_id, actor.client_id];
  if (request.method === 'GET') {
    if (id) {
      const note = await db.prepare(`SELECT id, client_id AS clientId, text, revision FROM notes WHERE organization_id = ?${visibility} AND id = ?`)
        .bind(...scope, id).first();
      return note ? json(note) : json({ error: 'Not found' }, 404);
    }
    const result = await db.prepare(`SELECT id, client_id AS clientId, text, revision FROM notes WHERE organization_id = ?${visibility} ORDER BY id LIMIT 50`)
      .bind(...scope).all();
    return json({ items: result.results });
  }
  if (actor.role !== 'staff') return json({ error: 'Forbidden' }, 403);
  if (!id && request.method === 'POST') {
    const input = await body(request);
    if (!fields(input, ['clientId', 'text', 'clientVisible']) || !validText(input.text) || typeof input.clientId !== 'string' || input.clientId.length > 100 || typeof input.clientVisible !== 'boolean') throw 400;
    const exists = await db.prepare('SELECT id FROM clients WHERE id = ? AND organization_id = ?').bind(input.clientId, actor.organization_id).first();
    if (!exists) return json({ error: 'Not found' }, 404);
    const noteId = crypto.randomUUID();
    await db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, 0)')
      .bind(noteId, actor.organization_id, input.clientId, input.text.trim(), Number(input.clientVisible)).run();
    return json({ id: noteId, revision: 0 }, 201);
  }
  if (id && request.method === 'PATCH') {
    const input = await body(request);
    if (!fields(input, ['text', 'revision']) || !validText(input.text) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw 400;
    const changed = await db.prepare('UPDATE notes SET text = ?, revision = revision + 1 WHERE organization_id = ? AND id = ? AND revision = ? RETURNING id, revision')
      .bind(input.text.trim(), actor.organization_id, id, input.revision).first();
    if (changed) return json(changed);
    const exists = await db.prepare('SELECT id FROM notes WHERE organization_id = ? AND id = ?').bind(actor.organization_id, id).first();
    return json({ error: exists ? 'Revision conflict' : 'Not found' }, exists ? 409 : 404);
  }
  return json({ error: 'Method not allowed' }, 405);
}
export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      const status = error === 400 || error === 413 ? error : 500;
      return json({ error: status === 500 ? 'Request failed' : status === 413 ? 'Request too large' : 'Invalid request' }, status);
    }
  },
};
