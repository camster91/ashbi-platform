#!/usr/bin/env node
import {
  assessControlledJourneyPreflight,
  inspectControlledJourneyTarget,
} from '../src/services/controlledJourneyReadiness.service.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const input = {
  organizationId: option('--organization-id'),
  leadId: option('--lead-id'),
  publicSiteRevision: option('--public-revision'),
  hubRevision: option('--hub-revision'),
  attestedBy: option('--attested-by'),
  attestationReference: option('--attestation-reference'),
};

let report = assessControlledJourneyPreflight({ environment: process.env, input });
let prisma;
if (report.inspectable) {
  try {
    ({ rawPrisma: prisma } = await import('../src/config/db.js'));
    report = await inspectControlledJourneyTarget({ environment: process.env, input, prisma });
  } catch {
    report = {
      ready: false,
      inspected: true,
      inspectable: true,
      checks: [
        ...report.checks,
        { id: 'target-inspection', ok: false, message: 'The named sandbox database could not be inspected safely.' },
      ],
    };
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
