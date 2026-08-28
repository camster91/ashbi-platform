#!/usr/bin/env node
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import { assessSandboxReadiness } from '../src/services/sandbox-readiness.service.js';
import {
  buildControlledJourneyEvidence,
  readControlledJourneySnapshot,
} from '../src/services/controlledJourneyEvidence.service.js';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id')?.trim();
const leadId = option('--lead-id')?.trim();
const publicSiteRevision = option('--public-revision')?.trim();
const hubRevision = option('--hub-revision')?.trim();
const attestedBy = option('--attested-by')?.trim();
const reference = option('--attestation-reference')?.trim();
const outputPath = option('--output');
const confirmed = process.argv.includes('--confirm');
const noCorrections = process.argv.includes('--attest-no-manual-db-corrections');

if (!organizationId || !leadId || !publicSiteRevision || !hubRevision || !attestedBy
  || !reference || !outputPath || !confirmed || !noCorrections) {
  console.error('Usage: npm run export:controlled-journey-evidence -- --organization-id <id> --lead-id <id> --public-revision <git-sha> --hub-revision <git-sha> --attested-by <name> --attestation-reference <reference> --output <new-controlled-journey.json> --attest-no-manual-db-corrections --confirm');
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error('Controlled journey export failed: database target is not configured');
  process.exitCode = 1;
} else {
  const readiness = assessSandboxReadiness(process.env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let descriptor;
  let output;
  try {
    if (!readiness.ready) {
      const failed = readiness.checks.filter(item => !item.ok).map(item => item.id).join(', ');
      throw new Error(`sandbox readiness failed: ${failed}`);
    }
    const snapshot = await readControlledJourneySnapshot({ prisma, organizationId, leadId });
    const evidence = buildControlledJourneyEvidence({
      organizationId,
      publicSiteRevision,
      hubRevision,
      snapshot,
      sandboxReadiness: readiness,
      attestation: { noManualDatabaseCorrections: true, attestedBy, reference },
    });
    output = path.resolve(outputPath);
    descriptor = fs.openSync(output, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    fs.chmodSync(output, 0o600);
    console.log('Controlled journey evidence exported from one reconciled sandbox inquiry-to-payment chain.');
  } catch (error) {
    if (descriptor !== undefined && output) {
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.rmSync(output, { force: true });
    }
    console.error(`Controlled journey export failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    await prisma.$disconnect();
  }
}
