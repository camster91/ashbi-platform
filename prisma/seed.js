// Database seed script

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'cameron@ashbi.ca' },
    update: { hourlyRate: 50 },
    create: {
      email: 'cameron@ashbi.ca',
      name: 'Cameron',
      password: hashPassword('Ashbi2026!'),
      role: 'ADMIN',
      skills: JSON.stringify(['management', 'design', 'development']),
      capacity: 100,
      hourlyRate: 50
    }
  });
  console.log('Created admin:', admin.email);

  // Create team member
  const bianca = await prisma.user.upsert({
    where: { email: 'bianca@ashbi.ca' },
    update: { hourlyRate: 50 },
    create: {
      email: 'bianca@ashbi.ca',
      name: 'Bianca',
      password: hashPassword('Ashbi2026!'),
      role: 'TEAM',
      skills: JSON.stringify(['design', 'ui', 'branding']),
      capacity: 100,
      hourlyRate: 50
    }
  });
  console.log('Created team member:', bianca.email);

  // Create contractor: Numan
  const numan = await prisma.user.upsert({
    where: { email: 'numan@ashbi.ca' },
    update: {},
    create: {
      email: 'numan@ashbi.ca',
      name: 'Numan',
      password: hashPassword('Ashbi2026!'),
      role: 'TEAM',
      hourlyRate: null
    }
  });
  console.log('Created contractor:', numan.email);

  // Create contractor: Sandeep
  const sandeep = await prisma.user.upsert({
    where: { email: 'sandeep@ashbi.ca' },
    update: {},
    create: {
      email: 'sandeep@ashbi.ca',
      name: 'Sandeep',
      password: hashPassword('Ashbi2026!'),
      role: 'TEAM',
      hourlyRate: null
    }
  });
  console.log('Created contractor:', sandeep.email);

  // Create sample client
  const client = await prisma.client.upsert({
    where: { domain: 'acmecorp.com' },
    update: {},
    create: {
      name: 'Acme Corporation',
      domain: 'acmecorp.com',
      status: 'ACTIVE',
      communicationPrefs: JSON.stringify({
        preferredTone: 'professional',
        responseTime: 'standard'
      }),
      knowledgeBase: JSON.stringify([
        { type: 'note', content: 'Enterprise client, values quick responses' }
      ])
    }
  });
  console.log('Created client:', client.name);

  // Create contact for client
  const contact = await prisma.contact.upsert({
    where: {
      email_clientId: {
        email: 'john@acmecorp.com',
        clientId: client.id
      }
    },
    update: {},
    create: {
      email: 'john@acmecorp.com',
      name: 'John Smith',
      role: 'Project Manager',
      isPrimary: true,
      clientId: client.id
    }
  });
  console.log('Created contact:', contact.email);

  // Create sample project
  const project = await prisma.project.upsert({
    where: { id: 'sample-project-1' },
    update: {},
    create: {
      id: 'sample-project-1',
      name: 'Website Redesign',
      description: 'Complete redesign of Acme Corp marketing website',
      status: 'ACTIVE',
      health: 'ON_TRACK',
      healthScore: 85,
      aiSummary: 'Project is progressing well. Currently in design phase with positive client feedback.',
      defaultOwnerId: bianca.id,
      clientId: client.id
    }
  });
  console.log('Created project:', project.name);

  // ==================== AI CONTEXT ====================

  const aiContextDefaults = [
    {
      key: 'brand_voice',
      value: 'Professional but warm. Toronto agency. Expert in CPG/DTC. Never salesy. Direct and helpful.'
    },
    {
      key: 'services',
      value: 'Brand identity, packaging design, web design (Shopify/WooCommerce/WordPress), SEO, digital marketing, retainer support'
    },
    {
      key: 'pricing',
      value: 'Retainers: $999/20h, $1999/40h, $3999/80h/month. Projects: branding from $2500, web from $3500, packaging from $1500'
    },
    {
      key: 'icp',
      value: 'CPG/DTC brands, supplement companies, food/beverage, skincare, Shopify store owners, Toronto businesses'
    },
    {
      key: 'tone_examples',
      value: 'Short sentences. No fluff. Always offer next step. Sign off as Cameron.'
    }
  ];

  for (const ctx of aiContextDefaults) {
    await prisma.aiContext.upsert({
      where: { key: ctx.key },
      update: {},
      create: ctx
    });
  }
  console.log('Seeded AI context:', aiContextDefaults.length, 'entries');

  // ==================== UPWORK CONTRACTS ====================

  const upworkContracts = [
    {
      clientName: 'Henry Wong',
      projectName: 'WordPress + Elementor',
      contractType: 'FIXED',
      totalBudget: 1200,
      status: 'ACTIVE',
      currentMilestone: 'Milestone 2',
      milestoneAmount: 600,
      milestoneStatus: 'OVERDUE',
      lastMessageAt: new Date('2026-03-15'),
      notes: 'markup.io feedback pending'
    },
    {
      clientName: 'Alexander Heinz',
      projectName: 'Hotel Review Website',
      contractType: 'FIXED',
      totalBudget: 500,
      status: 'ACTIVE',
      currentMilestone: 'Milestone 1',
      milestoneAmount: 500,
      milestoneStatus: 'OVERDUE',
      lastMessageAt: new Date('2026-03-06'),
      notes: 'Milestone overdue since Mar 6'
    },
    {
      clientName: 'Martin Reed',
      projectName: 'WordPress myTurn',
      contractType: 'FIXED',
      totalBudget: 500,
      status: 'ACTIVE',
      currentMilestone: 'Milestone 2',
      milestoneAmount: 250,
      milestoneStatus: 'PENDING',
      lastMessageAt: new Date('2026-03-16'),
      notes: 'Milestone 2 active'
    },
    {
      clientName: 'Caroline Tudor',
      projectName: 'Jewell Nursing',
      contractType: 'HOURLY',
      totalBudget: 0,
      hourlyRate: 35,
      status: 'ACTIVE',
      lastMessageAt: new Date('2026-03-17'),
      notes: 'Hourly - active'
    },
    {
      clientName: 'John Hasenauer',
      projectName: 'Digital Direct',
      contractType: 'HOURLY',
      totalBudget: 0,
      hourlyRate: 35,
      status: 'ACTIVE',
      lastMessageAt: new Date('2026-03-17'),
      notes: 'Hourly - active'
    }
  ];

  for (const contract of upworkContracts) {
    const existing = await prisma.upworkContract.findFirst({
      where: { clientName: contract.clientName, projectName: contract.projectName }
    });
    if (!existing) {
      await prisma.upworkContract.create({ data: contract });
    }
  }
  console.log('Seeded Upwork contracts:', upworkContracts.length, 'entries');

  console.log('\nSeed completed successfully!');
  console.log('\nDefault login credentials:');
  console.log('  Admin: cameron@ashbi.ca / Ashbi2026!');
  console.log('  Team:  bianca@ashbi.ca / Ashbi2026!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
