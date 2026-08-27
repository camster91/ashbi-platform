#!/usr/bin/env node
import {
  assessPublicIntakeEnvironment,
  inspectPublicIntakeTarget,
} from '../src/services/public-intake-readiness.service.js';

const environmentReport = assessPublicIntakeEnvironment(process.env);
let report = { ...environmentReport, inspected: false };
let prisma;

if (environmentReport.ready) {
  try {
    ({ rawPrisma: prisma } = await import('../src/config/db.js'));
    report = await inspectPublicIntakeTarget({ environment: process.env, prisma });
  } catch {
    report = {
      ready: false,
      inspected: true,
      checks: [
        ...environmentReport.checks,
        {
          id: 'target-inspection',
          ok: false,
          message: 'The target database could not be inspected safely.',
        },
      ],
    };
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
