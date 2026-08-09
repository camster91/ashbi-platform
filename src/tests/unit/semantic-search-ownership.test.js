import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertEmbeddingClientOwnership,
  deleteEmbeddings,
  rebuildClientBrain,
} from '../../services/embedding.service.js';

const routes = readFileSync(new URL('../../routes/semantic-search.routes.js', import.meta.url), 'utf8');

test('embedding ownership fails closed before provider or raw database work', async () => {
  let lookups = 0;
  const prismaClient = {
    client: {
      async findFirst() {
        lookups += 1;
        return null;
      },
    },
  };

  await assert.rejects(
    assertEmbeddingClientOwnership('client-other-tenant', prismaClient),
    (error) => error.statusCode === 404 && /not available/i.test(error.message),
  );
  assert.equal(lookups, 1);
});

test('a failed rebuild preserves old embeddings and cleans up newly staged rows', async () => {
  const deleteCalls = [];
  const prismaClient = {
    client: {
      async findFirst() { return { id: 'client-a', organizationId: 'org-a' }; },
      async findUnique() {
        return {
          id: 'client-a',
          organizationId: 'org-a',
          knowledgeBase: ['keep this'],
          projects: [{
            id: 'project-a',
            name: 'Project A',
            aiSummary: 'provider fails here',
            threads: [],
          }],
          proposals: [],
          invoices: [],
        };
      },
    },
    clientEmbedding: {
      async findMany() { return [{ id: 'old-1' }, { id: 'old-2' }]; },
      async deleteMany(args) { deleteCalls.push(args); return { count: 1 }; },
    },
    async $executeRaw() { return 1; },
  };

  await assert.rejects(
    rebuildClientBrain('client-a', {
      prismaClient,
      async generateEmbedding(content) {
        if (content.includes('provider fails')) throw new Error('provider unavailable');
        return [0.25];
      },
    }),
    /provider unavailable/,
  );

  assert.equal(deleteCalls.length, 1);
  const cleanedIds = deleteCalls[0].where.id.in;
  assert.equal(cleanedIds.length, 1);
  assert.ok(!cleanedIds.includes('old-1'));
  assert.ok(!cleanedIds.includes('old-2'));
});

test('a successful rebuild limits provider concurrency and removes old rows only after staging', async () => {
  let active = 0;
  let maximumActive = 0;
  const events = [];
  const projects = Array.from({ length: 5 }, (_, index) => ({
    id: `project-${index}`,
    name: `Project ${index}`,
    aiSummary: `Summary ${index}`,
    threads: [],
  }));
  const prismaClient = {
    client: {
      async findFirst() { return { id: 'client-a', organizationId: 'org-a' }; },
      async findUnique() {
        return {
          id: 'client-a',
          organizationId: 'org-a',
          knowledgeBase: ['Knowledge'],
          projects,
          proposals: [],
          invoices: [],
        };
      },
    },
    clientEmbedding: {
      async findMany() { return [{ id: 'old-1' }]; },
      async deleteMany(args) { events.push({ type: 'delete', args }); return { count: 1 }; },
    },
    async $executeRaw() { events.push({ type: 'insert' }); return 1; },
  };

  const result = await rebuildClientBrain('client-a', {
    prismaClient,
    async generateEmbedding() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return [0.25];
    },
  });

  assert.equal(result.embeddingsCreated, 6);
  assert.equal(result.embeddingsReplaced, 1);
  assert.ok(maximumActive <= 4);
  assert.equal(events.filter((event) => event.type === 'insert').length, 6);
  assert.equal(events.at(-1).type, 'delete');
  assert.deepEqual(events.at(-1).args.where.id.in, ['old-1']);
});

test('embedding deletion requires tenant ownership and scopes its SQL through clients', async () => {
  let statement;
  const prismaClient = {
    async $executeRaw(strings, ...values) {
      statement = { sql: strings.join('?'), values };
      return 1;
    },
  };

  await assert.rejects(
    deleteEmbeddings('NOTE', 'source-1', undefined, prismaClient),
    /organizationId is required/i,
  );

  const count = await deleteEmbeddings('NOTE', 'source-1', 'org-a', prismaClient);
  assert.equal(count, 1);
  assert.match(statement.sql, /USING\s+clients/i);
  assert.match(statement.sql, /organizationId/);
  assert.deepEqual(statement.values, ['NOTE', 'source-1', 'org-a']);
});

test('semantic-search mutations pass request tenancy and validate delete params, not a body', () => {
  assert.match(routes, /storeEmbedding\([\s\S]*request\.prisma/);
  assert.match(routes, /rebuildClientBrain\(clientId,\s*\{\s*prismaClient:\s*request\.prisma/);
  assert.match(routes, /deleteEmbeddings\(source,\s*sourceId,\s*request\.organizationId,\s*request\.prisma\)/);
  assert.match(routes, /validateParams\(semanticSearchDeleteParamsSchema\)/);
  assert.match(routes, /validateParams\(semanticSearchClientParamsSchema\)/);
  assert.match(routes, /validateQuery\(semanticSearchQuerySchema\)/);
  assert.doesNotMatch(routes, /delete\('\/embeddings[\s\S]{0,220}validateBody\(semanticSearchEmbedSchema\)/);
});
