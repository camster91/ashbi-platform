import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import aiClient from '../../ai/client.js';
import { runTenantJob } from '../../jobs/tenant-iteration.js';
import { processEmailPipeline } from '../../services/pipeline.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// The inbound email pipeline against a real PostgreSQL schema (built with
// `prisma migrate deploy`): the same delivery key processed again (a BullMQ
// retry, a replay, a concurrent run) yields exactly one thread and message,
// or one unmatched email, and the steps that already committed (assignment
// notification, AI tasks, draft response) are not repeated. The AI provider
// is replaced by a deterministic fake, as in the unit tests.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('a retried inbound email delivery never duplicates its thread, message, unmatched email or step writes', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async (t) => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    org: `mail-org-${suffix}`, client: `mail-client-${suffix}`, project: `mail-project-${suffix}`,
    admin: `mail-admin-${suffix}`,
  };
  const failSequence = `inbound_email_fail_${suffix.replaceAll('-', '_')}`;
  const failFunction = `${failSequence}_fn`;
  const failTrigger = `${failSequence}_trg`;

  // Deterministic AI: the parse step's match is set per scenario; every
  // call is counted by kind so a resumed run can prove it skipped a step.
  const calls = { parse: 0, analyze: 0, replan: 0, draft: 0 };
  let match = 'high';
  let badAnalysisOnce = false;
  let parseBarrier = null;
  // Per-call match outcomes (consumed in order), falling back to `match`.
  const matchQueue = [];
  const originalChatJSON = aiClient.chatJSON;
  aiClient.chatJSON = async ({ system, prompt }) => {
    if (/analyze client messages/.test(system)) {
      calls.analyze += 1;
      if (badAnalysisOnce) {
        badAnalysisOnce = false;
        // Not a string: the analysis write throws after the thread exists.
        return { intent: { invalid: true }, sentiment: 'neutral', urgency: 'CRITICAL', urgencyReason: 'x' };
      }
      return { intent: 'request', sentiment: 'neutral', urgency: 'CRITICAL', urgencyReason: 'Deadline', summary: 'Needs help' };
    }
    if (/dynamic project plans/.test(system)) {
      calls.replan += 1;
      const subject = /Subject: (.*)/.exec(prompt)?.[1] ?? 'email';
      return {
        projectSummary: 'Summary', overallHealth: 'NEEDS_ATTENTION', healthScore: 70, risks: [],
        plan: { immediate: [{ task: `Follow up: ${subject}`, reason: 'Client asked', estimatedTime: '1h', blockedBy: null }] },
      };
    }
    if (/draft client response/.test(system)) {
      calls.draft += 1;
      return { options: [{ subject: 'Re: hello', body: 'On it', tone: 'professional' }] };
    }
    calls.parse += 1;
    if (parseBarrier) await parseBarrier();
    const outcome = matchQueue.length ? matchQueue.shift() : match;
    const confidence = outcome === 'high' ? 0.95 : 0.1;
    return {
      matchedClient: { id: ids.client, name: 'Mail client', confidence, matchReason: 'Known domain' },
      matchedProject: outcome === 'high' ? { id: ids.project, name: 'Mail project' } : null,
      isSpamOrIrrelevant: { likely: false },
    };
  };
  t.after(() => { aiClient.chatJSON = originalChatJSON; });

  const email = (key, subject) => ({
    inboundDeliveryKey: key,
    senderEmail: 'someone@client.example',
    senderName: 'Someone',
    subject,
    bodyText: `Body of ${subject}`,
    receivedAt: new Date('2026-09-30T10:00:00.000Z'),
  });
  const run = (data) => runTenantJob(raw, ids.org, () => processEmailPipeline(data), raw);
  const resetCalls = () => { for (const kind of Object.keys(calls)) calls[kind] = 0; };
  async function writesFor(key) {
    const threads = await raw.thread.findMany({ where: { inboundDeliveryKey: key }, include: { messages: true, responses: true } });
    const threadIds = threads.map((thread) => thread.id);
    const notifications = (await raw.notification.findMany({ where: { userId: ids.admin } }))
      .filter((row) => threadIds.some((id) => JSON.stringify(row.data).includes(id)));
    return {
      threads,
      messages: threads.flatMap((thread) => thread.messages),
      responses: threads.flatMap((thread) => thread.responses),
      notifications,
      unmatched: await raw.unmatchedEmail.findMany({ where: { inboundDeliveryKey: key } }),
    };
  }
  const tasksFor = (subject) => raw.task.count({ where: { projectId: ids.project, title: `Follow up: ${subject}` } });

  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Mail tenant', slug: `mail-${suffix}` } });
    await raw.client.create({ data: { id: ids.client, name: 'Mail client', organizationId: ids.org } });
    await raw.project.create({ data: { id: ids.project, name: 'Mail project', clientId: ids.client, organizationId: ids.org } });
    await raw.user.create({ data: {
      id: ids.admin, name: 'Admin', role: 'ADMIN', organizationId: ids.org, email: `${ids.admin}@example.com`, password: 'x',
    } });

    // 1. The same delivery twice: one thread, one message, and the second
    // run resumes the completed thread without calling the AI again.
    const keyA = `email-webhook-a-${suffix}`;
    const first = await run(email(keyA, `A ${suffix}`));
    assert.equal(first.matched, true);
    assert.ok(first.threadId);
    assert.equal(first.draftGenerated, true);
    assert.deepEqual(calls, { parse: 1, analyze: 1, replan: 1, draft: 1 });
    resetCalls();
    const second = await run(email(keyA, `A ${suffix}`));
    assert.equal(second.threadId, first.threadId);
    assert.equal(second.matched, true);
    assert.equal(second.analysis.urgency, 'CRITICAL');
    assert.equal(second.assignment.userId, ids.admin);
    assert.equal(second.draftGenerated, true);
    assert.deepEqual(calls, { parse: 0, analyze: 0, replan: 0, draft: 0 }, 'a completed delivery is not reprocessed');
    let writes = await writesFor(keyA);
    assert.equal(writes.threads.length, 1);
    assert.equal(writes.threads[0].inboundPipelineStage, 'COMPLETED');
    assert.equal(writes.threads[0].assignedToId, ids.admin);
    assert.equal(writes.messages.length, 1);
    assert.equal(writes.notifications.length, 1);
    assert.equal(writes.responses.length, 1);
    assert.equal(await tasksFor(`A ${suffix}`), 1);

    // 2. A step fails after the thread was created: the retry resumes that
    // thread instead of creating another one.
    const keyB = `email-webhook-b-${suffix}`;
    resetCalls();
    badAnalysisOnce = true;
    await assert.rejects(run(email(keyB, `B ${suffix}`)));
    writes = await writesFor(keyB);
    assert.equal(writes.threads.length, 1, 'the failed attempt created the thread');
    assert.equal(writes.threads[0].inboundPipelineStage, 'CREATED');
    const retriedB = await run(email(keyB, `B ${suffix}`));
    assert.equal(retriedB.threadId, writes.threads[0].id);
    assert.equal(calls.parse, 1, 'the retry does not re-match the email');
    writes = await writesFor(keyB);
    assert.equal(writes.threads.length, 1);
    assert.equal(writes.messages.length, 1);
    assert.equal(writes.notifications.length, 1);
    assert.equal(writes.responses.length, 1);
    assert.equal(writes.threads[0].inboundPipelineStage, 'COMPLETED');
    assert.equal(await tasksFor(`B ${suffix}`), 1);

    // 3. The last step fails after the assignment notification and the AI
    // tasks committed (a database trigger refuses the COMPLETED marker
    // twice): the retry only drafts, so nothing is written twice.
    const keyC = `email-webhook-c-${suffix}`;
    await raw.$executeRawUnsafe(`CREATE SEQUENCE "${failSequence}"`);
    await raw.$executeRawUnsafe(`
      CREATE FUNCTION "${failFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."inboundDeliveryKey" = '${keyC}' AND NEW."inboundPipelineStage" = 'COMPLETED'
          AND nextval('"${failSequence}"') <= 2 THEN
          RAISE EXCEPTION 'simulated failure while completing the email pipeline';
        END IF;
        RETURN NEW;
      END $$`);
    await raw.$executeRawUnsafe(`
      CREATE TRIGGER "${failTrigger}" BEFORE UPDATE ON "threads"
      FOR EACH ROW EXECUTE FUNCTION "${failFunction}"()`);
    resetCalls();
    await assert.rejects(run(email(keyC, `C ${suffix}`)), /simulated failure/);
    writes = await writesFor(keyC);
    assert.equal(writes.threads.length, 1);
    assert.equal(writes.threads[0].inboundPipelineStage, 'REPLANNED');
    assert.equal(writes.notifications.length, 1);
    assert.equal(writes.responses.length, 0, 'the draft rolled back with its marker');
    assert.equal(await tasksFor(`C ${suffix}`), 1);
    resetCalls();
    const retriedC = await run(email(keyC, `C ${suffix}`));
    assert.equal(retriedC.threadId, writes.threads[0].id);
    assert.equal(retriedC.draftGenerated, true);
    assert.deepEqual(calls, { parse: 0, analyze: 0, replan: 0, draft: 1 }, 'only the unfinished step runs again');
    writes = await writesFor(keyC);
    assert.equal(writes.threads.length, 1);
    assert.equal(writes.messages.length, 1);
    assert.equal(writes.notifications.length, 1);
    assert.equal(writes.responses.length, 1);
    assert.equal(writes.threads[0].inboundPipelineStage, 'COMPLETED');
    assert.equal(await tasksFor(`C ${suffix}`), 1);

    // 4. Two concurrent runs of one delivery both miss the lookup and race to
    // create: the unique key admits one thread (the loser hits P2002 and
    // resumes it), and each step's writes commit once.
    const keyD = `email-webhook-d-${suffix}`;
    let arrived = 0;
    let release;
    const bothArrived = new Promise((resolve) => { release = resolve; });
    parseBarrier = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await bothArrived;
    };
    resetCalls();
    const [left, right] = await Promise.all([run(email(keyD, `D ${suffix}`)), run(email(keyD, `D ${suffix}`))]);
    parseBarrier = null;
    assert.equal(calls.parse, 2, 'both runs raced past the lookup');
    assert.equal(left.threadId, right.threadId);
    writes = await writesFor(keyD);
    assert.equal(writes.threads.length, 1);
    assert.equal(writes.messages.length, 1);
    assert.equal(writes.notifications.length, 1);
    assert.equal(writes.responses.length, 1);
    assert.equal(await tasksFor(`D ${suffix}`), 1);

    // 5. An unmatched delivery twice: one unmatched email, and the retry
    // returns it even though the AI would now match the email to a client.
    const keyE = `mailgun:<e-${suffix}@mail.example>`;
    match = 'low';
    resetCalls();
    const unmatched = await run(email(keyE, `E ${suffix}`));
    assert.equal(unmatched.matched, false);
    assert.equal(unmatched.needsTriage, true);
    match = 'high';
    const unmatchedAgain = await run(email(keyE, `E ${suffix}`));
    assert.deepEqual(unmatchedAgain, unmatched);
    assert.equal(calls.parse, 1);
    writes = await writesFor(keyE);
    assert.equal(writes.unmatched.length, 1);
    assert.equal(writes.unmatched[0].organizationId, ids.org);
    assert.equal(writes.threads.length, 0);

    // 6. Two concurrent runs of one delivery that DISAGREE on the match (one
    // above the threshold, one below): the per-table unique indexes cannot
    // see each other, so without the delivery lock one run would create a
    // thread and the other an unmatched email. Exactly one record exists
    // across both tables, and both runs report it.
    const keyF = `mailgun:<f-${suffix}@mail.example>`;
    let arrivedF = 0;
    let releaseF;
    const bothArrivedF = new Promise((resolve) => { releaseF = resolve; });
    parseBarrier = async () => {
      arrivedF += 1;
      if (arrivedF === 2) releaseF();
      await bothArrivedF;
    };
    matchQueue.push('high', 'low');
    resetCalls();
    const [one, two] = await Promise.all([run(email(keyF, `F ${suffix}`)), run(email(keyF, `F ${suffix}`))]);
    parseBarrier = null;
    assert.equal(calls.parse, 2, 'both runs raced past the lookup and disagreed');
    writes = await writesFor(keyF);
    assert.equal(writes.threads.length + writes.unmatched.length, 1, 'one record across threads and unmatched emails');
    assert.equal(one.matched, two.matched, 'both runs report the same outcome');
    if (writes.threads.length) assert.equal(one.threadId, two.threadId);
  } finally {
    await raw.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failTrigger}" ON "threads"`);
    await raw.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failFunction}"()`);
    await raw.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${failSequence}"`);
    await raw.notification.deleteMany({ where: { userId: ids.admin } });
    await raw.task.deleteMany({ where: { projectId: ids.project } });
    await raw.thread.deleteMany({ where: { clientId: ids.client } });
    await raw.unmatchedEmail.deleteMany({ where: { organizationId: ids.org } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.user.deleteMany({ where: { id: ids.admin } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
