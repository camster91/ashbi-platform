/**
 * Bonsai → Agency Hub sample seed (ESM JS)
 *
 * Usage:
 *   node prisma/bonsai-seed.js
 *
 * Loads prisma/bonsai-seed.local.json when that gitignored file exists.
 * Otherwise it loads the fictional roster in prisma/bonsai-sample-data.js.
 * Do not commit a real client book. Git history still has the old export;
 * this script does not rewrite history.
 *
 * Order: Clients → Retainers → Invoices → Revenue Snapshots
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { bonsaiInvoiceAmount } from './bonsai-invoice-amount.js';
import { sampleBonsaiSeed } from './bonsai-sample-data.js';

const prisma = new PrismaClient();
const localSeedPath = resolve(dirname(fileURLToPath(import.meta.url)), 'bonsai-seed.local.json');

function asDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value) return new Date(value);
  return undefined;
}

function loadSeedData() {
  if (!existsSync(localSeedPath)) {
    console.log('Loading synthetic sample clients (not a real client book).');
    return sampleBonsaiSeed;
  }

  console.log('Loading prisma/bonsai-seed.local.json. Keep that file untracked.');
  const parsed = JSON.parse(readFileSync(localSeedPath, 'utf8'));
  for (const key of ['clients', 'retainers', 'invoices', 'revenue']) {
    if (!Array.isArray(parsed[key])) {
      throw new Error(`prisma/bonsai-seed.local.json is missing a ${key} array`);
    }
  }
  return parsed;
}

async function main() {
  console.log('🚀 Starting Bonsai → Hub migration seed...');
  const { clients: clientsData, retainers: retainerData, invoices: invoicesData, revenue: revenueData } = loadSeedData();

  // ============================================================
  // STEP 1: Seed Clients
  // ============================================================
  console.log('\n📋 Seeding clients...');

  const clientIdMap = {};

  for (const c of clientsData) {
    const client = await prisma.client.upsert({
      where: {
        domain: `bonsai-${c.bonsaiId}.legacy`,
      },
      update: {
        communicationPrefs: JSON.stringify({
          tier: c.tier,
          serviceType: c.serviceType,
          contactPerson: c.contactPerson,
          country: c.country,
          totalRevenueUsd: c.totalRevenueUsd || 0,
          totalRevenueCad: c.totalRevenueCad || 0,
          bonsaiClientId: c.bonsaiId,
          relationshipStatus: c.status,
        }),
      },
      create: {
        name: c.name,
        domain: `bonsai-${c.bonsaiId}.legacy`,
        status: c.status === 'ARCHIVED' ? 'CHURN' : c.status === 'LEAD' ? 'PAUSED' : 'ACTIVE',
        communicationPrefs: JSON.stringify({
          tier: c.tier,
          serviceType: c.serviceType,
          contactPerson: c.contactPerson,
          country: c.country,
          totalRevenueUsd: c.totalRevenueUsd || 0,
          totalRevenueCad: c.totalRevenueCad || 0,
          bonsaiClientId: c.bonsaiId,
          relationshipStatus: c.status,
        }),
        knowledgeBase: JSON.stringify(
          [c.notes ? { type: 'note', content: c.notes } : null].filter(Boolean)
        ),
      },
    });

    clientIdMap[c.bonsaiId] = client.id;

    if (c.email) {
      await prisma.contact.upsert({
        where: { email_clientId: { email: c.email, clientId: client.id } },
        update: {},
        create: {
          email: c.email,
          name: c.contactPerson || c.name,
          isPrimary: true,
          clientId: client.id,
        },
      });
    }
  }

  console.log(`✅ Seeded ${clientsData.length} clients`);

  // ============================================================
  // STEP 2: Seed Retainer Plans
  // ============================================================
  console.log('\n💳 Seeding retainer plans...');

  for (const r of retainerData) {
    const clientId = clientIdMap[r.bonsaiClientId];
    if (!clientId) {
      console.warn(`⚠️ Client not found for bonsai ID: ${r.bonsaiClientId}`);
      continue;
    }

    const startDate = asDate(r.startDate);
    await prisma.retainerPlan.upsert({
      where: { clientId },
      update: {},
      create: {
        clientId,
        tier: String(r.monthlyUsd || 0),
        hoursPerMonth: Math.round((r.monthlyUsd || 0) / 50) || 10,
        billingCycleStart: startDate,
      },
    });
  }

  console.log(`✅ Seeded ${retainerData.length} retainer plans`);

  // ============================================================
  // STEP 3: Seed Invoices
  // ============================================================
  console.log('\n🧾 Seeding invoices...');

  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!adminUser) {
    console.error('❌ No admin user found. Create a user first.');
    throw new Error('Admin user required for invoice seeding');
  }

  let invoiceCount = 0;
  for (const inv of invoicesData) {
    const clientId = clientIdMap[inv.bonsaiClientId];
    if (!clientId) {
      console.warn(`⚠️ Invoice ${inv.number}: client bonsai ID ${inv.bonsaiClientId} not found`);
      continue;
    }

    const issueDate = asDate(inv.issueDate);
    const dueDate = asDate(inv.dueDate);
    const paidAt = asDate(inv.paidDate) || null;
    const sentAt = inv.status !== 'DRAFT' ? issueDate : null;

    try {
      // Stored in the source currency (the column defaults to CAD otherwise).
      const { currency, amount } = bonsaiInvoiceAmount(inv);
      // Invoice numbers are unique per organization (not globally), so match
      // on the client's invoices before creating.
      const existing = await prisma.invoice.findFirst({ where: { invoiceNumber: inv.number, clientId } });
      if (existing) { invoiceCount++; continue; }
      await prisma.invoice.create({
        data: {
          invoiceNumber: inv.number,
          status: inv.status,
          issueDate,
          dueDate: dueDate || undefined,
          subtotal: amount,
          tax: 0,
          total: amount,
          currency,
          taxRate: 0,
          taxType: 'NONE',
          notes: inv.notes || null,
          paymentMethod: inv.method || null,
          paidAt,
          sentAt,
          clientId,
          createdById: adminUser.id,
          isRecurring: false,
        },
      });
      invoiceCount++;
    } catch (e) {
      console.warn(`⚠️ Invoice ${inv.number} error:`, e.message);
    }
  }

  console.log(`✅ Seeded ${invoiceCount} invoices`);

  // ============================================================
  // STEP 4: Seed Revenue Snapshots
  // ============================================================
  console.log('\n📊 Seeding revenue snapshots...');

  let snapshotCount = 0;
  for (const r of revenueData) {
    try {
      // Use createMany-style with findFirst to avoid null clientId composite key issue
      const existing = await prisma.revenueSnapshot.findFirst({
        where: { month: r.month, clientId: null },
      });
      if (!existing) {
        await prisma.revenueSnapshot.create({
          data: {
            month: r.month,
            revenueUsd: r.revenueUsd,
            revenueUsdEquiv: r.revenueUsd,
            mrr: r.mrr,
            arr: r.mrr * 12,
            retainerRevenue: r.mrr,
            projectRevenue: Math.max(0, r.revenueUsd - r.mrr),
            exchangeRateUsedCadUsd: 0.80,
          },
        });
        snapshotCount++;
      } else {
        console.log(`  ↩️  Snapshot ${r.month} already exists, skipping`);
      }
    } catch (e) {
      console.warn(`⚠️ Revenue snapshot ${r.month} error:`, e.message);
    }
  }

  console.log(`✅ Seeded ${snapshotCount} revenue snapshots`);

  console.log('\n🎉 Migration seed complete!');
  console.log(`
Summary:
  ✅ Clients: ${clientsData.length}
  ✅ Retainers: ${retainerData.length}
  ✅ Invoices: ${invoiceCount}
  ✅ Revenue snapshots: ${snapshotCount}
  `);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
