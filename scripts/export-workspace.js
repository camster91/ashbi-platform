#!/usr/bin/env node

/**
 * Produce a portable, tenant-scoped workspace export for migration/recovery.
 * It deliberately excludes credentials, sessions, raw email, and payment data.
 * Usage: node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildWorkspaceExportManifest } from '../src/services/workspace-export-integrity.service.js';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id') || process.env.EXPORT_ORGANIZATION_ID;
const output = option('--output');
if (!organizationId || !output || !process.argv.includes('--confirm')) {
  console.error('Usage: node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm');
  process.exit(2);
}

const target = path.resolve(output);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  try { await fs.access(target); throw new Error(`Refusing to overwrite existing file: ${target}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } });
  if (!organization) throw new Error(`Organization not found: ${organizationId}`);

  const clients = await prisma.client.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, bonsaiClientId: true, name: true, email: true, domain: true, status: true, contactPerson: true, phone: true, address: true, city: true, provinceState: true, postalCode: true, country: true, serviceType: true, createdAt: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });
  const contacts = await prisma.contact.findMany({ where: { client: { organizationId, deletedAt: null } }, select: { id: true, clientId: true, email: true, name: true, role: true, isPrimary: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } });
  const projects = await prisma.project.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, bonsaiProjectId: true, clientId: true, name: true, description: true, status: true, health: true, healthScore: true, budget: true, hourlyBudget: true, serviceType: true, startDate: true, endDate: true, completedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const projectIds = projects.map(({ id }) => id);
  const [tasks, notes, milestones, timeEntries, expenses] = await Promise.all([
    prisma.task.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, parentId: true, assigneeId: true, title: true, description: true, content: true, status: true, priority: true, category: true, tags: true, properties: true, estimatedTime: true, dueDate: true, startDate: true, completedAt: true, position: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.note.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, parentId: true, title: true, content: true, type: true, isPinned: true, tags: true, isTemplate: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.milestone.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, projectId: true, name: true, description: true, dueDate: true, status: true, completedAt: true, color: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.timeEntry.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, userId: true, taskId: true, description: true, duration: true, date: true, billable: true, hourlyRate: true, source: true, invoiced: true, createdAt: true, updatedAt: true }, orderBy: { date: 'asc' } }),
    prisma.expense.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, organizationId: true, clientId: true, projectId: true, description: true, amount: true, currency: true, category: true, date: true, billable: true, invoiced: true, createdAt: true, updatedAt: true }, orderBy: { date: 'asc' } }),
  ]);
  const userIds = [...new Set([
    ...timeEntries.map(({ userId }) => userId),
    ...tasks.map(({ assigneeId }) => assigneeId).filter(Boolean),
  ])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const payload = { format: 'ashbi-workspace-export', version: 3, exportedAt: new Date().toISOString(), organization, records: { clients, contacts, projects, tasks, notes, milestones, users, timeEntries, expenses } };
  payload.manifest = buildWorkspaceExportManifest(payload.records, { version: 3 });
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await fs.chmod(target, 0o600);
  console.log(JSON.stringify({ output: target, bytes: Buffer.byteLength(serialized), sha256: crypto.createHash('sha256').update(serialized).digest('hex'), manifest: payload.manifest }, null, 2));
}

main().catch((error) => { console.error(`Export failed: ${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
