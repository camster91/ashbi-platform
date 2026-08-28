import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ensureSignedContractProject } from '../../services/signedContractProject.service.js';

function contract() {
  return {
    id: 'contract-1',
    title: 'Contract: Synthetic Website',
    status: 'SIGNED',
    clientId: 'client-1',
    client: { id: 'client-1', name: 'Synthetic Client', organizationId: 'org-1' },
    proposal: { id: 'proposal-1', title: 'Synthetic Website', total: 1000, projectId: null },
  };
}

function project() {
  return {
    id: 'project-1',
    name: 'Synthetic Website',
    clientId: 'client-1',
    organizationId: 'org-1',
    sourceContractId: 'contract-1',
  };
}

function transactional(delegates) {
  return { ...delegates, $transaction: callback => callback(delegates) };
}

test('a signed contract creates exactly one organization-bound project identity', async () => {
  let createData;
  const prisma = transactional({
    contract: { findFirst: async () => contract() },
    proposal: { updateMany: async () => ({ count: 1 }) },
    project: {
      findUnique: async () => null,
      create: async ({ data }) => { createData = data; return project(); },
    },
  });
  const result = await ensureSignedContractProject({ prisma, contractId: ' contract-1 ' });
  assert.equal(result.created, true);
  assert.equal(result.project.id, 'project-1');
  assert.equal(result.contract.proposal.projectId, 'project-1');
  assert.deepEqual(createData, {
    name: 'Synthetic Website',
    description: 'Auto-created from signed contract: Contract: Synthetic Website',
    status: 'STARTING_UP',
    health: 'ON_TRACK',
    clientId: 'client-1',
    organizationId: 'org-1',
    sourceContractId: 'contract-1',
  });
});

test('a replay reuses the contract project and performs no create', async () => {
  let creates = 0;
  const prisma = transactional({
    contract: { findFirst: async () => contract() },
    proposal: { updateMany: async () => ({ count: 1 }) },
    project: {
      findUnique: async () => project(),
      create: async () => { creates += 1; },
    },
  });
  const result = await ensureSignedContractProject({ prisma, contractId: 'contract-1' });
  assert.equal(result.created, false);
  assert.equal(creates, 0);
});

test('a simultaneous create reconciles through the unique contract identity', async () => {
  let reads = 0;
  const prisma = transactional({
    contract: { findFirst: async () => contract() },
    proposal: { updateMany: async () => ({ count: 1 }) },
    project: {
      findUnique: async () => { reads += 1; return reads === 1 ? null : project(); },
      create: async () => { const error = new Error('unique'); error.code = 'P2002'; throw error; },
    },
  });
  const result = await ensureSignedContractProject({ prisma, contractId: 'contract-1' });
  assert.equal(result.created, false);
  assert.equal(result.project.id, 'project-1');
});

test('unsigned and cross-bound project evidence fail closed', async () => {
  await assert.rejects(() => ensureSignedContractProject({
    prisma: transactional({ contract: { findFirst: async () => null } }),
    contractId: 'contract-1',
  }), /current signed contract/);

  const mismatched = { ...project(), organizationId: 'org-other' };
  await assert.rejects(() => ensureSignedContractProject({
    prisma: transactional({
      contract: { findFirst: async () => contract() },
      proposal: { updateMany: async () => ({ count: 1 }) },
      project: { findUnique: async () => mismatched },
    }),
    contractId: 'contract-1',
  }), /inconsistent client or organization/);
});

test('an existing proposal-project conflict is never overwritten', async () => {
  const value = contract();
  value.proposal.projectId = 'project-other';
  await assert.rejects(() => ensureSignedContractProject({
    prisma: transactional({
      contract: { findFirst: async () => value },
      project: { findUnique: async () => project() },
    }),
    contractId: value.id,
  }), /already bound to a different project/);
});

test('schema and migration enforce one project per signed contract', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const service = fs.readFileSync('src/services/signedContractProject.service.js', 'utf8');
  const automation = fs.readFileSync('src/services/automation.service.js', 'utf8');
  const migration = fs.readFileSync(
    'prisma/migrations/20260827020000_signed_contract_project_identity/migration.sql',
    'utf8',
  );
  assert.match(schema, /sourceContractId\s+String\?\s+@unique/);
  assert.match(schema, /sourceContract\s+Contract\?\s+@relation\("ContractProject"/);
  assert.match(migration, /CREATE UNIQUE INDEX "projects_sourceContractId_key"/);
  assert.match(migration, /REFERENCES "contracts"\("id"\)/);
  assert.match(service, /prisma\.\$transaction/);
  assert.match(automation, /if \(!created\)[\s\S]*side effects skipped[\s\S]*idempotent: true/);
});
