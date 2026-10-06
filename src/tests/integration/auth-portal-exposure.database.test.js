// Through the real application factory and a real, fully migrated database:
//
// - API keys authenticate the AI bridge (the key lookup runs in onRequest,
//   before the tenancy middleware), the request is scoped to the key owner's
//   organization, scopes are enforced, and revoked, expired and unknown keys
//   are refused;
// - the Google Calendar OAuth callback is reachable without a session cookie
//   (the provider redirect carries none under SameSite=Strict) and is
//   authenticated by its signed, browser-bound state instead;
// - the client-facing project views never expose the internal health rating,
//   AI summary or pinned notes; the client task board has a column for every
//   task status; and the portal Documents tab lists only files shared with
//   the client (internal screen recordings stay hidden).
//
// Needs a disposable database in both DATABASE_URL (read by
// src/config/db.js) and TENANT_INTEGRATION_DATABASE_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const sameDatabase = databaseUrl && process.env.DATABASE_URL === databaseUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.JWT_SECRET = JWT_SECRET;
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'integration-test-credentials-key';
// env.js reads these at import: the callback answers 503 when OAuth is not configured.
process.env.GOOGLE_CALENDAR_CLIENT_ID ||= 'integration-google-client';
process.env.GOOGLE_CALENDAR_CLIENT_SECRET ||= ['integration', randomUUID()].join(':');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const PDF = Buffer.from('%PDF-1.4\n% auth-portal-exposure fixture\n');
// Generated per run: a fixture, never a stored credential.
const fixturePassword = () => ['fixture', randomUUID()].join(':');
const apiKeyValue = () => `ashbi_${randomBytes(32).toString('hex')}`;
const hashKey = (key) => createHash('sha256').update(key).digest('hex');

async function multipartBody(name, type, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

test('API keys, the Google Calendar callback and the client-facing portal views', {
  skip: !sameDatabase && 'TENANT_INTEGRATION_DATABASE_URL (equal to DATABASE_URL) is not configured',
  timeout: 120_000,
}, async () => {
  const { buildApp } = await import('../../index.js');
  const { rawPrisma: prisma } = await import('../../config/db.js');
  const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');
  const { signUserSession } = await import('../../auth/session.js');
  const { oauthStateCookieName, signOAuthState, verifyOAuthState } = await import('../../auth/oauth-state.js');
  const { TASK_STATUS_VALUES } = await import('../../validators/schemas.js');

  const suffix = randomUUID().slice(0, 12);
  const orgA = `authfix-a-${suffix}`;
  const orgB = `authfix-b-${suffix}`;
  const writtenFiles = [];
  const app = await buildApp({ initializeRuntime: false, jwtSecret: JWT_SECRET });
  await app.ready();

  try {
    await prisma.organization.createMany({ data: [
      { id: orgA, name: 'Authfix A', slug: orgA },
      { id: orgB, name: 'Authfix B', slug: orgB },
    ] });
    const mkUser = (organizationId, key, role, extra = {}) => prisma.user.create({
      data: { organizationId, email: `${key}-${suffix}@example.com`, name: key, password: fixturePassword(), role, ...extra },
    });
    const admin = await mkUser(orgA, 'admin', 'ADMIN');
    let team = await mkUser(orgA, 'team', 'TEAM');
    const adminB = await mkUser(orgB, 'admin-b', 'ADMIN');
    const client = await prisma.client.create({ data: { organizationId: orgA, name: 'Authfix client' } });
    const contact = await prisma.contact.create({ data: { clientId: client.id, name: 'Casey Client', email: `casey-${suffix}@example.com` } });
    const clientUser = await prisma.user.create({ data: {
      organizationId: orgA, clientId: client.id, email: contact.email, name: contact.name, password: fixturePassword(), role: 'CLIENT',
    } });
    const viewToken = `authfix-view-${randomUUID()}`;
    const project = await prisma.project.create({ data: {
      organizationId: orgA, clientId: client.id, name: 'Authfix site', viewToken,
      health: 'AT_RISK', aiSummary: 'INTERNAL: client is slow to pay, push for deposit',
    } });
    const clientB = await prisma.client.create({ data: { organizationId: orgB, name: 'Other tenant client' } });
    const projectB = await prisma.project.create({ data: { organizationId: orgB, clientId: clientB.id, name: 'Other tenant site' } });
    await prisma.note.create({ data: {
      projectId: project.id, authorId: admin.id, title: 'Margin notes', content: 'INTERNAL: pinned staff note', isPinned: true,
    } });

    const inject = (method, url, { cookies, headers, payload } = {}) => app.inject({ method, url, cookies, headers, payload });
    const staffCookies = (user) => ({ token: signUserSession(app.jwt, user) });
    const clientCookies = { token: signUserSession(app.jwt, clientUser, { contactId: contact.id }) };

    // ── 1. API keys on the AI bridge ─────────────────────────────────────────
    const keys = {};
    const mkKey = async (name, scopes, extra = {}) => {
      const raw = apiKeyValue();
      await prisma.apiKey.create({ data: { name, key: hashKey(raw), userId: admin.id, scopes, expiresAt: new Date(Date.now() + 86_400_000), ...extra } });
      keys[name] = raw;
      return raw;
    };
    await mkKey('read', ['ai_bridge:read']);
    await mkKey('actions', ['ai_bridge:actions']);
    await mkKey('revoked', ['ai_bridge:read', 'ai_bridge:actions'], { isActive: false, revokedAt: new Date() });
    await mkKey('expired', ['ai_bridge:read'], { expiresAt: new Date(Date.now() - 1_000) });
    const withKey = (key) => ({ 'x-api-key': key });

    const capabilities = await inject('GET', '/api/ai-bridge/capabilities', { headers: withKey(keys.read) });
    assert.equal(capabilities.statusCode, 200, capabilities.body);
    assert.equal(capabilities.json().organizationId, orgA, 'the request runs as the key owner');
    assert.deepEqual(capabilities.json().grantedScopes, ['ai_bridge:read']);
    const bearer = await inject('GET', '/api/ai-bridge/capabilities', { headers: { authorization: `Bearer ${keys.read}` } });
    assert.equal(bearer.statusCode, 200, bearer.body);
    assert.ok((await prisma.apiKey.findUnique({ where: { key: hashKey(keys.read) } })).lastUsedAt, 'lastUsedAt is recorded');

    // Scopes: a read-only key cannot prepare actions; an actions key cannot chat.
    const prepare = (key, projectId) => inject('POST', '/api/ai-bridge/v1/actions/prepare', {
      headers: withKey(key),
      payload: { action: 'create_task', idempotencyKey: `authfix-${randomUUID()}`, input: { projectId, title: 'Draft homepage copy' } },
    });
    const readOnlyPrepare = await prepare(keys.read, project.id);
    assert.equal(readOnlyPrepare.statusCode, 403, readOnlyPrepare.body);
    assert.equal(readOnlyPrepare.json().code, 'INSUFFICIENT_SCOPE');
    const actionsChat = await inject('POST', '/api/ai-bridge/v1/chat/completions', {
      headers: withKey(keys.actions), payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(actionsChat.statusCode, 403, actionsChat.body);
    assert.equal(actionsChat.json().code, 'INSUFFICIENT_SCOPE');

    // Tenant scoping: the key owner's organization only.
    const ownPrepare = await prepare(keys.actions, project.id);
    assert.equal(ownPrepare.statusCode, 201, ownPrepare.body);
    const prepared = await prisma.aiBridgeAction.findUnique({ where: { id: ownPrepare.json().action.id } });
    assert.equal(prepared.organizationId, orgA);
    assert.equal(prepared.userId, admin.id);
    const crossTenant = await prepare(keys.actions, projectB.id);
    assert.equal(crossTenant.statusCode, 404, `another organization's project is not found: ${crossTenant.body}`);

    for (const [label, headers] of [
      ['revoked', withKey(keys.revoked)],
      ['expired', withKey(keys.expired)],
      ['unknown', withKey(apiKeyValue())],
      ['missing', {}],
    ]) {
      const refused = await inject('GET', '/api/ai-bridge/capabilities', { headers });
      assert.equal(refused.statusCode, 401, `${label} key: ${refused.body}`);
    }
    const revokedPrepare = await prepare(keys.revoked, project.id);
    assert.equal(revokedPrepare.statusCode, 401, revokedPrepare.body);

    // ── 2. Google Calendar OAuth callback without a session cookie ───────────
    const callbackUrl = (state) => `/api/google-calendar/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`;
    const forged = await inject('GET', callbackUrl('forged.state.value'));
    assert.equal(forged.statusCode, 401, `the tenant guard no longer answers 403 first: ${forged.body}`);
    assert.equal(forged.json().code, 'GOOGLE_CALENDAR_OAUTH_STATE_INVALID');
    const state = signOAuthState('google_calendar_oauth', { organizationId: orgA, userId: admin.id });
    const unbound = await inject('GET', callbackUrl(state));
    assert.equal(unbound.statusCode, 401, 'a valid state without the browser binding cookie is refused');
    const expired = signOAuthState('google_calendar_oauth', { organizationId: orgA, userId: admin.id }, { nowMs: Date.now() - 3_600_000 });
    const expiredResponse = await inject('GET', callbackUrl(expired), {
      cookies: { [oauthStateCookieName('google_calendar_oauth')]: verifyOAuthState('google_calendar_oauth', expired, { nowMs: Date.now() - 3_600_000 }).nonce },
    });
    assert.equal(expiredResponse.statusCode, 401, 'an expired state is refused');
    assert.equal(await prisma.googleCalendarConnection.count({ where: { organizationId: { in: [orgA, orgB] } } }), 0);

    // ── 5 + 7. The public project link: no notes, health or AI summary ───────
    const publicView = await inject('GET', `/api/portal/${viewToken}`);
    assert.equal(publicView.statusCode, 200, publicView.body);
    const publicBody = publicView.json();
    assert.equal(publicBody.name, 'Authfix site');
    for (const field of ['health', 'aiSummary', 'pinnedNotes', 'notes']) assert.equal(field in publicBody, false, `public view has no ${field}`);
    assert.doesNotMatch(publicView.body, /INTERNAL/);

    const cancelledToken = `authfix-cancelled-${randomUUID()}`;
    await prisma.project.create({ data: { organizationId: orgA, clientId: client.id, name: 'Cancelled site', viewToken: cancelledToken, status: 'CANCELLED' } });
    assert.equal((await inject('GET', `/api/portal/${cancelledToken}`)).statusCode, 404, 'a cancelled project is not served');

    // ── Reset password: a token is consumed exactly once ─────────────────────
    const resetToken = randomBytes(32).toString('hex');
    await prisma.user.update({ where: { id: team.id }, data: {
      resetToken: createHash('sha256').update(resetToken).digest('hex'), resetTokenExpiresAt: new Date(Date.now() + 3_600_000),
    } });
    const resetWith = (newPassword) => inject('POST', '/api/auth/reset-password', { payload: { token: resetToken, newPassword } });
    const passwords = [`Fixture-${randomUUID()}-A1!`, `Fixture-${randomUUID()}-B2!`];
    const resets = await Promise.all(passwords.map(resetWith));
    assert.deepEqual(resets.map((response) => response.statusCode).sort(), [200, 400], `exactly one concurrent reset succeeds: ${resets.map((r) => r.body).join(' ')}`);
    const { verifyPassword } = await import('../../auth/password.js');
    const stored = await prisma.user.findUnique({ where: { id: team.id } });
    const winner = passwords[resets.findIndex((response) => response.statusCode === 200)];
    assert.equal(await verifyPassword(winner, stored.password), true, 'the successful request set the password');
    assert.equal(stored.resetToken, null);
    assert.equal((await resetWith(`Fixture-${randomUUID()}-C3!`)).statusCode, 400, 'the link cannot be reused');
    team = stored; // the reset revoked the old sessions (sessionVersion)

    // ── 7. The signed-in client portal: no health or AI summary ──────────────
    const list = await inject('GET', '/api/client-portal/projects', { cookies: clientCookies });
    assert.equal(list.statusCode, 200, list.body);
    const detail = await inject('GET', `/api/client-portal/projects/${project.id}`, { cookies: clientCookies });
    assert.equal(detail.statusCode, 200, detail.body);
    for (const body of [list.json()[0], detail.json()]) {
      assert.equal('health' in body, false);
      assert.equal('aiSummary' in body, false);
    }
    assert.doesNotMatch(list.body + detail.body, /INTERNAL/);

    // ── 6. Every task status reaches a column; client-safe fields only ───────
    for (const status of TASK_STATUS_VALUES) {
      await prisma.task.create({ data: {
        projectId: project.id, title: `Task ${status}`, status, description: 'INTERNAL task notes', assigneeId: team.id,
      } });
    }
    const board = await inject('GET', `/api/client-portal/projects/${project.id}/tasks`, { cookies: clientCookies });
    assert.equal(board.statusCode, 200, board.body);
    const { tasks, columns } = board.json();
    assert.equal(tasks.length, TASK_STATUS_VALUES.length);
    const onBoard = Object.values(columns).flat();
    assert.equal(onBoard.length, TASK_STATUS_VALUES.length, 'every task appears in exactly one column');
    assert.deepEqual(columns.WAITING_CLIENT.map((task) => task.status), ['WAITING_CLIENT']);
    for (const task of tasks) {
      assert.equal('description' in task, false);
      assert.equal('assigneeId' in task, false);
      assert.deepEqual(task.assignee, { name: 'team' });
    }
    assert.doesNotMatch(board.body, /INTERNAL/);

    // ── 8. Documents: only files shared with the client ──────────────────────
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const storeStaffFile = async (originalName, mimeType, extra = {}) => {
      const filename = `authfix-${randomUUID()}${path.extname(originalName)}`;
      await fs.writeFile(path.join(UPLOAD_DIR, filename), PDF);
      writtenFiles.push(filename);
      return prisma.attachment.create({ data: {
        organizationId: orgA, filename, originalName, mimeType, size: PDF.length, path: `/uploads/${filename}`,
        entityType: 'PROJECT', entityId: project.id, uploadedById: team.id, ...extra,
      } });
    };
    // A staff screen recording, uploaded the way ProjectMedia does (PROJECT).
    const recording = await storeStaffFile('screen-recording.webm', 'video/webm');
    const deliverable = await storeStaffFile('deliverable.pdf', 'application/pdf');
    const reviewed = await storeStaffFile('homepage.pdf', 'application/pdf');
    await prisma.reviewSession.create({ data: {
      organizationId: orgA, projectId: project.id, attachmentId: reviewed.id, title: 'Homepage', sharedWithClient: true, createdById: admin.id,
    } });
    const internalReview = await storeStaffFile('internal-review.pdf', 'application/pdf');
    await prisma.reviewSession.create({ data: {
      organizationId: orgA, projectId: project.id, attachmentId: internalReview.id, title: 'Internal', createdById: admin.id,
    } });

    const documentNames = async () => {
      const response = await inject('GET', `/api/client-portal/projects/${project.id}/documents`, { cookies: clientCookies });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().map((doc) => doc.originalName).sort();
    };
    // A shared file later moved to quarantine is neither listed nor served.
    const quarantined = await prisma.attachment.create({ data: {
      organizationId: orgA, filename: `authfix-q-${suffix}.pdf`, originalName: 'quarantined.pdf', mimeType: 'application/pdf', size: 1,
      path: `/uploads/quarantine/authfix-q-${suffix}.pdf`, entityType: 'PROJECT', entityId: project.id, uploadedById: team.id, clientVisible: true,
    } });
    assert.deepEqual(await documentNames(), ['homepage.pdf'], 'only the file shared through a client review');
    assert.equal((await inject('GET', `/api/client-portal/documents/${quarantined.id}/download`, { cookies: clientCookies })).statusCode, 404);
    const listed = await inject('GET', `/api/client-portal/projects/${project.id}/documents`, { cookies: clientCookies });
    assert.deepEqual(listed.json()[0].uploadedBy, { name: 'team' }, 'the uploader name only, never the account id');
    const hiddenDownload = await inject('GET', `/api/client-portal/documents/${recording.id}/download`, { cookies: clientCookies });
    assert.equal(hiddenDownload.statusCode, 404, 'an internal recording cannot be downloaded by id');

    // A client upload is visible to the client.
    const upload = await multipartBody('brief.pdf', 'application/pdf', PDF);
    const uploaded = await inject('POST', `/api/client-portal/projects/${project.id}/upload`, {
      cookies: clientCookies, headers: { 'content-type': upload.contentType }, payload: upload.payload,
    });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const uploadedRow = await prisma.attachment.findUnique({ where: { id: uploaded.json().id } });
    writtenFiles.push(uploadedRow.filename);
    assert.equal(uploadedRow.clientVisible, true);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'homepage.pdf']);

    // Staff share a deliverable: the uploader or an admin, never a client session.
    const share = (cookies, id, clientVisible) => inject('PATCH', `/api/attachments/${id}/client-visibility`, { cookies, payload: { clientVisible } });
    assert.equal((await share(clientCookies, deliverable.id, true)).statusCode, 403, 'a client session cannot reach the staff API');
    const otherStaff = await share(staffCookies(admin), recording.id, 'yes');
    assert.equal(otherStaff.statusCode, 400, 'the body is validated');
    const crossTenantShare = await share(staffCookies(adminB), deliverable.id, true);
    assert.equal(crossTenantShare.statusCode, 404, 'another organization cannot share the file');
    const shared = await share(staffCookies(team), deliverable.id, true);
    assert.equal(shared.statusCode, 200, shared.body);
    assert.equal(shared.json().clientVisible, true);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'deliverable.pdf', 'homepage.pdf']);
    const sharedDownload = await inject('GET', `/api/client-portal/documents/${deliverable.id}/download`, { cookies: clientCookies });
    assert.equal(sharedDownload.statusCode, 200, sharedDownload.body);
    const audit = await prisma.auditEvent.findFirst({ where: { organizationId: orgA, action: 'attachment.client_visibility_changed', entityId: deliverable.id } });
    assert.deepEqual(
      { projectId: audit.metadata.projectId, fromVisible: audit.metadata.fromVisible, toVisible: audit.metadata.toVisible },
      { projectId: project.id, fromVisible: false, toVisible: true },
    );
    const unshared = await share(staffCookies(admin), deliverable.id, false);
    assert.equal(unshared.statusCode, 200, unshared.body);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'homepage.pdf']);
    // The staff list carries the flag the Files toggle reads.
    const staffList = await inject('GET', `/api/attachments?entityType=PROJECT&entityId=${project.id}`, { cookies: staffCookies(team) });
    assert.equal(staffList.statusCode, 200, staffList.body);
    assert.equal(staffList.json().find((row) => row.id === recording.id).clientVisible, false, 'recordings stay internal');

    // ── 9. Bulk share after the deploy that hid staff files ──────────────────
    const bulk = (cookies, projectId, payload) => inject('PATCH', `/api/projects/${projectId}/attachments/client-visibility`, { cookies, payload });
    const other = await mkUser(orgA, 'other-staff', 'TEAM');
    const otherProject = await prisma.project.create({ data: { organizationId: orgA, clientId: client.id, name: 'Other project' } });
    const elsewhere = await prisma.attachment.create({ data: {
      organizationId: orgA, filename: `authfix-elsewhere-${suffix}.pdf`, originalName: 'elsewhere.pdf', mimeType: 'application/pdf', size: 1,
      path: `/uploads/authfix-elsewhere-${suffix}.pdf`, entityType: 'PROJECT', entityId: otherProject.id, uploadedById: team.id,
    } });
    const foreign = await prisma.attachment.create({ data: {
      organizationId: orgB, filename: `authfix-foreign-${suffix}.pdf`, originalName: 'foreign.pdf', mimeType: 'application/pdf', size: 1,
      path: `/uploads/authfix-foreign-${suffix}.pdf`, entityType: 'PROJECT', entityId: projectB.id, uploadedById: adminB.id,
    } });
    assert.equal((await bulk(clientCookies, project.id, { clientVisible: true })).statusCode, 403, 'a client session cannot reach the staff API');
    assert.equal((await bulk(staffCookies(adminB), project.id, { clientVisible: true })).statusCode, 404, 'another organization cannot see the project');
    assert.equal((await bulk(staffCookies(team), project.id, { clientVisible: 'yes' })).statusCode, 400, 'the body is validated');
    const refusedIds = await bulk(staffCookies(team), project.id, { clientVisible: true, attachmentIds: [elsewhere.id, foreign.id] });
    assert.equal(refusedIds.statusCode, 200, refusedIds.body);
    assert.deepEqual(refusedIds.json(), {
      changed: 0, changedIds: [], unchanged: 0,
      skipped: [{ id: elsewhere.id, reason: 'not_found' }, { id: foreign.id, reason: 'not_found' }],
    });
    for (const row of [elsewhere, foreign]) {
      assert.equal((await prisma.attachment.findUnique({ where: { id: row.id } })).clientVisible, false, 'files outside the project are never changed');
    }
    // Staff who neither uploaded the files nor are admins change nothing.
    const notMine = await bulk(staffCookies(other), project.id, { clientVisible: true });
    assert.equal(notMine.statusCode, 200, notMine.body);
    assert.equal(notMine.json().changed, 0);
    assert.deepEqual(notMine.json().skipped.map((skip) => skip.reason), ['not_permitted', 'not_permitted', 'not_permitted', 'not_permitted']);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'homepage.pdf']);

    const bulkShared = await bulk(staffCookies(team), project.id, { clientVisible: true });
    assert.equal(bulkShared.statusCode, 200, bulkShared.body);
    const sharedIds = [recording.id, deliverable.id, reviewed.id, internalReview.id];
    assert.deepEqual([...bulkShared.json().changedIds].sort(), [...sharedIds].sort());
    assert.equal(bulkShared.json().unchanged, 2, 'the client upload and the already shared file');
    assert.deepEqual(bulkShared.json().skipped, []);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'deliverable.pdf', 'homepage.pdf', 'internal-review.pdf', 'screen-recording.webm'],
      'bulk share lists the files in the portal (a quarantined file stays out)');
    const bulkAudit = await prisma.auditEvent.findMany({ where: { organizationId: orgA, action: 'attachment.client_visibility_changed', entityId: { in: sharedIds } } });
    const sharedAudit = bulkAudit.filter((event) => event.metadata.bulk === true);
    assert.deepEqual(sharedAudit.map((event) => event.entityId).sort(), [...sharedIds].sort(), 'one audit event per changed file');
    for (const event of sharedAudit) {
      assert.deepEqual({ ...event.metadata }, { projectId: project.id, fromVisible: false, toVisible: true, bulk: true });
      assert.equal(event.actorUserId, team.id);
    }

    // Undo: the inverse value with exactly the changed ids.
    const undone = await bulk(staffCookies(team), project.id, { clientVisible: false, attachmentIds: bulkShared.json().changedIds });
    assert.equal(undone.statusCode, 200, undone.body);
    assert.equal(undone.json().changed, 4);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'homepage.pdf'], 'undo restores the portal list');

    // An admin hides everything staff shared; the client's own upload stays.
    const hidden = await bulk(staffCookies(admin), project.id, { clientVisible: false });
    assert.equal(hidden.statusCode, 200, hidden.body);
    assert.deepEqual(hidden.json().changedIds, [quarantined.id]);
    assert.deepEqual(hidden.json().skipped, [{ id: uploadedRow.id, reason: 'client_upload' }]);
    assert.deepEqual(await documentNames(), ['brief.pdf', 'homepage.pdf'], 'the client upload and the review-shared file stay');
    // The staff list says which files the client sees through a shared review.
    const reviewFlags = await inject('GET', `/api/attachments?entityType=PROJECT&entityId=${project.id}`, { cookies: staffCookies(team) });
    assert.equal(reviewFlags.statusCode, 200, reviewFlags.body);
    const flagged = Object.fromEntries(reviewFlags.json().map((row) => [row.originalName, row.sharedViaReview]));
    assert.equal(flagged['homepage.pdf'], true, 'in a review shared with the client');
    assert.equal(flagged['internal-review.pdf'], false, 'in an internal review only');
    assert.equal(flagged['deliverable.pdf'], false);
    assert.equal(reviewFlags.json().find((row) => row.id === uploadedRow.id).uploadedBy.role, 'CLIENT');
  } finally {
    await app.close();
    for (const name of writtenFiles) await fs.rm(path.join(UPLOAD_DIR, name), { force: true });
    const orgs = [orgA, orgB];
    await prisma.reviewSession.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.attachment.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.apiKey.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await prisma.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await prisma.note.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await prisma.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(prisma, { ids: orgs })) {
      await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    }
    await prisma.$disconnect();
  }
});

test('migration 20261001170000 backfills project files with client-upload evidence as visible', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { readFileSync } = await import('node:fs');
  const { default: prismaPkg } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const migration = readFileSync(new URL('../../../prisma/migrations/20261001170000_attachment_client_visible/migration.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT)\s*;/m, 'no explicit transaction control');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "clientVisible"/, 'the column add is idempotent');
  const backfill = migration.slice(migration.indexOf('UPDATE "attachments"')).trim().replace(/;\s*$/, '');

  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const ROLLBACK = new Error('rollback');
  const suffix = randomUUID().slice(0, 8);
  try {
    await raw.$transaction(async (tx) => {
      const org = `backfill-${suffix}`;
      await tx.organization.create({ data: { id: org, name: org, slug: org } });
      const user = (key, role) => tx.user.create({ data: { organizationId: org, email: `${key}-${suffix}@example.com`, name: key, password: fixturePassword(), role } });
      const staff = await user('staff', 'TEAM');
      const portal = await user('client', 'CLIENT');
      // Before 51b40ff a portal upload was attributed to whichever user had
      // the contact's email, here a non-CLIENT account.
      const legacy = await user('Legacy-Contact', 'TEAM');
      const clientA = await tx.client.create({ data: { organizationId: org, name: 'Client A' } });
      const clientB = await tx.client.create({ data: { organizationId: org, name: 'Client B' } });
      await tx.contact.create({ data: { clientId: clientA.id, name: 'Legacy', email: `legacy-contact-${suffix}@EXAMPLE.com` } });
      const projectA = await tx.project.create({ data: { organizationId: org, clientId: clientA.id, name: 'A' } });
      const projectB = await tx.project.create({ data: { organizationId: org, clientId: clientB.id, name: 'B' } });
      const row = (uploadedById, entityType, name, entityId = projectA.id) => tx.attachment.create({ data: {
        organizationId: org, filename: name, originalName: name, mimeType: 'application/pdf', size: 1, path: `/uploads/${name}`,
        entityType, entityId, uploadedById,
      } });
      const uploadActivity = (attachment, userId) => tx.activity.create({ data: {
        type: 'FILE_UPLOADED', action: 'uploaded', entityType: 'ATTACHMENT', entityId: attachment.id, entityName: attachment.originalName, projectId: projectA.id, userId,
      } });
      const clientFile = await row(portal.id, 'PROJECT', 'client.pdf');
      const staffFile = await row(staff.id, 'PROJECT', 'staff.pdf');
      const recording = await row(staff.id, 'PROJECT', 'screen-recording.webm');
      const clientChat = await row(portal.id, 'CHAT', 'chat.pdf');
      const legacyUpload = await row(legacy.id, 'PROJECT', 'legacy.pdf');
      const legacyOtherProject = await row(legacy.id, 'PROJECT', 'legacy-other.pdf', projectB.id);
      const clientActivity = await row(staff.id, 'PROJECT', 'via-activity.pdf');
      await uploadActivity(clientActivity, portal.id);
      const staffActivity = await row(staff.id, 'PROJECT', 'staff-activity.pdf');
      await uploadActivity(staffActivity, staff.id);

      // Twice: the backfill is idempotent.
      await tx.$executeRawUnsafe(backfill);
      await tx.$executeRawUnsafe(backfill);
      const visible = async (id) => (await tx.attachment.findUnique({ where: { id } })).clientVisible;
      assert.equal(await visible(clientFile.id), true, 'a CLIENT-uploaded project file stays visible');
      assert.equal(await visible(legacyUpload.id), true, 'an upload by the user holding a contact email of the project client stays visible');
      assert.equal(await visible(clientActivity.id), true, 'a file whose FILE_UPLOADED activity was by a CLIENT stays visible');
      assert.equal(await visible(staffFile.id), false, 'a staff file starts hidden');
      assert.equal(await visible(recording.id), false, 'a staff screen recording starts hidden');
      assert.equal(await visible(staffActivity.id), false, 'a staff FILE_UPLOADED activity is no evidence');
      assert.equal(await visible(legacyOtherProject.id), false, 'a contact email of another client is no evidence');
      assert.equal(await visible(clientChat.id), false, 'only PROJECT files are portal documents');
      throw ROLLBACK;
    }).catch((error) => { if (error !== ROLLBACK) throw error; });
  } finally {
    await raw.$disconnect();
  }
});
