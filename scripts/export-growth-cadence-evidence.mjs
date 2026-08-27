#!/usr/bin/env node
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import { buildGrowthCadenceEvidence } from '../src/services/growthCadenceEvidence.service.js';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id')?.trim();
const firstWeek = option('--first-week');
const outputPath = option('--output');

if (!organizationId || !firstWeek || !outputPath || !process.argv.includes('--confirm')) {
  console.error('Usage: npm run export:growth-cadence-evidence -- --organization-id <id> --first-week <YYYY-MM-DD Monday> --output <new-growth-cadence.json> --confirm');
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error('Growth cadence export failed: database target is not configured');
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  let descriptor;
  let output;
  try {
    output = path.resolve(outputPath);
    const tasks = await prisma.task.findMany({
      where: {
        growthReviewKey: { startsWith: `growth-review:${organizationId}:` },
        deletedAt: null,
        project: { organizationId, deletedAt: null },
      },
      select: {
        id: true,
        growthReviewKey: true,
        status: true,
        assigneeId: true,
        dueDate: true,
        completedAt: true,
        properties: true,
      },
    });
    const evidence = buildGrowthCadenceEvidence({ organizationId, firstWeek, tasks });
    descriptor = fs.openSync(output, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    fs.chmodSync(output, 0o600);
    console.log('Growth cadence evidence exported from four completed, consecutive Hub reviews.');
  } catch (error) {
    if (descriptor !== undefined && output) {
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.rmSync(output, { force: true });
    }
    console.error(`Growth cadence export failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    await prisma.$disconnect();
  }
}
