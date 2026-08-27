#!/usr/bin/env node
import bcrypt from 'bcrypt';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { bootstrapSandboxWorkspace } from '../src/services/sandbox-workspace.service.js';

const { PrismaClient } = prismaPkg;
const confirm = process.argv.includes('--confirm');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const report = await bootstrapSandboxWorkspace({
    prisma,
    environment: process.env,
    confirm,
    hashPassword: (value) => bcrypt.hash(value, 12),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ready && (!confirm || report.confirmed) ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
