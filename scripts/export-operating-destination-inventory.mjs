#!/usr/bin/env node
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import { assessMigrationSandboxTarget } from '../src/services/migrationSandboxTarget.service.js';
import { buildOperatingDestinationInventory } from '../src/services/operatingDestinationInventory.service.js';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id')?.trim();
const capturedAt = option('--captured-at') ?? new Date().toISOString();
const outputPath = option('--output');

if (!organizationId || !outputPath) {
  console.error('Usage: npm run export:operating-destination-inventory -- --organization-id <sandbox-id> --output <new-inventory.json> [--captured-at <ISO>]');
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error('Operating destination inventory export failed: database target is not configured.');
  process.exitCode = 1;
} else {
  const sandbox = assessMigrationSandboxTarget({
    environment: process.env,
    organizationId,
    requireMutationAuthorization: false,
  });
  if (!sandbox.ready) {
    console.error('Operating destination inventory export failed: the selected target is not the bound migration sandbox.');
    process.exitCode = 1;
  } else {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    let descriptor;
    let output;
    try {
      output = path.resolve(outputPath);
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });
      if (!organization) throw new Error('The bound sandbox organization does not exist.');
      const [clients, projects, taskRows, sourceRecords] = await Promise.all([
        prisma.client.findMany({
          where: { organizationId, deletedAt: null },
          select: { id: true, organizationId: true },
        }),
        prisma.project.findMany({
          where: { organizationId, deletedAt: null },
          select: { id: true, organizationId: true, clientId: true, name: true, status: true },
        }),
        prisma.task.findMany({
          where: { deletedAt: null, project: { organizationId, deletedAt: null } },
          select: { id: true, projectId: true, title: true, status: true },
        }),
        prisma.operatingSourceRecord.findMany({
          where: { organizationId },
          select: {
            organizationId: true, sourceSystem: true, entityType: true, sourceId: true,
            destinationId: true, outcome: true, sourceFingerprint: true,
            decisionCandidateId: true, decisionFingerprint: true,
          },
        }),
      ]);
      const tasks = taskRows.map(row => ({ ...row, organizationId }));
      const inventory = buildOperatingDestinationInventory({
        organizationId,
        capturedAt,
        clients,
        projects,
        tasks,
        sourceRecords,
      });
      descriptor = fs.openSync(output, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
      fs.chmodSync(output, 0o600);
      console.log(`Operating destination inventory exported: ${inventory.summary.clients} clients, ${inventory.summary.projects} projects, ${inventory.summary.tasks} tasks, ${inventory.summary.sourceRecords} source identities.`);
    } catch (error) {
      if (descriptor !== undefined && output) {
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.rmSync(output, { force: true });
      }
      console.error(`Operating destination inventory export failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      await prisma.$disconnect();
    }
  }
}
