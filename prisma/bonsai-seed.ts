/**
 * Bonsai → Agency Hub Migration Seed Script
 * 
 * Usage:
 *   npx ts-node prisma/bonsai-seed.ts
 *   OR: npx prisma db seed (if configured in package.json)
 * 
 * Order: Clients → Projects → Retainers → Invoices → Revenue Snapshots
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Bonsai → Hub migration seed...');

  // ============================================================
  // STEP 1: Seed Clients
  // ============================================================
  console.log('\n📋 Seeding clients...');

  const clientsData = [
    // Tier 1 — High Value
    { bonsaiId: '1', name: 'Specialty Rice', contactPerson: 'Jeff', email: 'jeff@tempo-sales.com', country: 'US', tier: 'T1', serviceType: 'retainer_monthly', totalRevenueUsd: 27417, status: 'ACTIVE' },
    { bonsaiId: '2', name: 'Influencer Link', contactPerson: 'Macy Schuchart', email: 'contact@influencerslink.com', country: 'US', tier: 'T1', serviceType: 'subscription_monthly', totalRevenueUsd: 19000, status: 'ACTIVE' },
    { bonsaiId: '3', name: 'Sloane Taylor (Mom Water)', contactPerson: 'Sloane Taylor', email: 'sloane@drinkmomwater.com', country: 'US', tier: 'T1', serviceType: 'subscription_monthly', totalRevenueUsd: 17514, status: 'ACTIVE' },
    { bonsaiId: '4', name: 'Marin', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'retainer_monthly', totalRevenueUsd: 16116, status: 'ACTIVE' },
    { bonsaiId: '5', name: 'Dr. John Maggirias', contactPerson: 'Dr. John Maggirias', email: 'drjohn@dentacloud.ai', country: 'CA', tier: 'T1', serviceType: 'project_multi', totalRevenueCad: 20430, status: 'ACTIVE' },
    { bonsaiId: '6', name: 'Keepers Commercial Cleaning', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'marketing_seo', totalRevenueUsd: 14651, city: 'Mesa', provinceState: 'Arizona', address: '2260 E University Drive', postalCode: '85213', status: 'ARCHIVED' },
    { bonsaiId: '7', name: 'Semira Nikou (BetterSour)', contactPerson: 'Semira Nikou', email: 'semira@bettersour.com', country: 'CA', tier: 'T1', serviceType: 'ecommerce_web', totalRevenueUsd: 13393, status: 'ACTIVE' },
    { bonsaiId: '8', name: 'Pierce Freelon (Coco Fro + Nnenna)', contactPerson: 'Pierce Freelon', email: 'pfreelon@gmail.com', country: 'US', tier: 'T1', serviceType: 'branding_web', totalRevenueUsd: 12415, status: 'ACTIVE' },
    { bonsaiId: '9', name: 'LaTanya Miles', contactPerson: 'LaTanya Miles', email: '', country: 'US', tier: 'T1', serviceType: 'retainer_monthly', totalRevenueUsd: 6287, status: 'ACTIVE' },
    { bonsaiId: '10', name: 'The Down There Doc', contactPerson: 'Marcy Crouch', email: 'marcy@thedowntheredoc.com', country: 'US', tier: 'T1', serviceType: 'maintenance_wordpress', totalRevenueUsd: 6587, status: 'ACTIVE' },
    { bonsaiId: '11', name: 'Diamond (Sofie Brand)', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'branding_illustration', totalRevenueUsd: 6577, status: 'ACTIVE' },
    { bonsaiId: '12', name: 'Lorette Mathe (Shongoni Skin)', contactPerson: 'Lorette Mathe', email: '', country: 'US', tier: 'T1', serviceType: 'branding_web', totalRevenueUsd: 5457, status: 'ACTIVE' },
    { bonsaiId: '13', name: 'Club Kalm', contactPerson: 'Kam Ordonez', email: 'kamila@kalmwellness.co', country: 'US', tier: 'T1', serviceType: 'branding_subscription', totalRevenueUsd: 4987, status: 'ACTIVE' },
    { bonsaiId: '14', name: 'Edelman', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'adobe_content', totalRevenueUsd: 4630, status: 'ACTIVE' },
    { bonsaiId: '15', name: 'Kumail', contactPerson: '', email: '', country: 'CA', tier: 'T1', serviceType: 'project_web', totalRevenueCad: 4155, status: 'ACTIVE' },
    { bonsaiId: '16', name: 'Macy / Ancient Bliss', contactPerson: 'Macy Schuchart', email: '', country: 'US', tier: 'T1', serviceType: 'ecommerce_shopify', totalRevenueUsd: 4125, status: 'ACTIVE' },
    { bonsaiId: '17', name: 'Bold Egg Naturals', contactPerson: '', email: '', country: 'CA', tier: 'T1', serviceType: 'branding_production', totalRevenueCad: 4497, status: 'ACTIVE', notes: 'Significant draft invoices ($1,650 + $1,700 CAD). Unbilled time (~10 hrs).' },
    { bonsaiId: '18', name: 'Jerel (TalentWoo)', contactPerson: 'Jerel', email: '', country: 'US', tier: 'T1', serviceType: 'marketing_web', totalRevenueUsd: 4128, status: 'ACTIVE' },
    { bonsaiId: '19', name: 'Mark Roberts (Mortgage Brain)', contactPerson: 'Mark Roberts', email: '', country: 'CA', tier: 'T1', serviceType: 'web_design', totalRevenueCad: 4080, status: 'ACTIVE' },
    { bonsaiId: '20', name: 'Skin Care Brand', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'branding_multi', totalRevenueUsd: 3609, status: 'ACTIVE' },
    { bonsaiId: '21', name: "Shiv's Hummus", contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'web_branding', totalRevenueUsd: 3753, status: 'ACTIVE' },
    // Tier 2
    { bonsaiId: '22', name: 'Tyson Hepburn', contactPerson: 'Tyson Hepburn', email: '', country: 'US', tier: 'T2', serviceType: 'web_wordpress_hosting', totalRevenueUsd: 2300, status: 'ACTIVE' },
    { bonsaiId: '23', name: 'Derek Stonier (Splashtown)', contactPerson: 'Derek Stonier', email: '', country: 'US', tier: 'T2', serviceType: 'hosting_ads_redesign', totalRevenueUsd: 2100, status: 'ACTIVE' },
    { bonsaiId: '24', name: 'Marina White', contactPerson: 'Marina White', email: '', country: 'US', tier: 'T2', serviceType: 'health_fitness_web', totalRevenueUsd: 1950, status: 'ACTIVE' },
    { bonsaiId: '25', name: 'Verified Party (POOFshots)', contactPerson: '', email: 'poof@verified.com', country: 'US', tier: 'T2', serviceType: 'web_design_dev', totalRevenueUsd: 2400, status: 'ACTIVE' },
    { bonsaiId: '26', name: "Chef Tanya's Kitchen", contactPerson: 'Chef Tanya', email: '', country: 'US', tier: 'T2', serviceType: 'web_design', totalRevenueUsd: 1850, status: 'ACTIVE' },
    { bonsaiId: '27', name: 'Dana Gillfillan (Vasonoxol)', contactPerson: 'Dana Gillfillan', email: 'amgethealthy@gmail.com', country: 'US', tier: 'T2', serviceType: 'shopify_redesign', totalRevenueUsd: 2800, status: 'ACTIVE' },
    { bonsaiId: '28', name: 'Jen Rozek (Lille Nord)', contactPerson: 'Jen Rozek', email: '', country: 'US', tier: 'T2', serviceType: 'web_design', totalRevenueUsd: 1200, status: 'ACTIVE' },
    { bonsaiId: '29', name: 'Efuru (Flourishing Films)', contactPerson: 'Efuru', email: '', country: 'US', tier: 'T2', serviceType: 'web_design', totalRevenueUsd: 1500, status: 'ACTIVE' },
    { bonsaiId: '30', name: 'Parents Canada', contactPerson: 'Shardae Lang', email: 'shardae@parentscanada.com', country: 'US', tier: 'T2', serviceType: 'web_dev_marketing', totalRevenueUsd: 3200, status: 'ACTIVE' },
    { bonsaiId: '31', name: 'Kris Lekaj (Prime Cleaning NYC)', contactPerson: 'Kris Lekaj', email: '', country: 'US', tier: 'T2', serviceType: 'web_design', totalRevenueUsd: 1400, status: 'ACTIVE' },
    { bonsaiId: '32', name: 'Rebecca Rivard (Total ETO)', contactPerson: 'Rebecca Rivard', email: 'rebecca.rivard@totaleto.com', country: 'US', tier: 'T2', serviceType: 'web_design', totalRevenueUsd: 2100, status: 'ACTIVE' },
    { bonsaiId: '33', name: 'Meerkat Marketing', contactPerson: 'Kyle Turk', email: 'kturk@meerkatmarketing.ca', country: 'CA', tier: 'T2', serviceType: 'digital_services', totalRevenueUsd: 2500, status: 'ACTIVE' },
    { bonsaiId: '34', name: 'Garry Bradamore (PooPrints Canada)', contactPerson: 'Garry Bradamore', email: '', country: 'CA', tier: 'T2', serviceType: 'seo_optimization', totalRevenueCad: 1800, status: 'ACTIVE' },
    { bonsaiId: '35', name: "S'noods", contactPerson: 'Lauryn Bodden', email: 'lauryn@eatsnoods.com', country: 'US', tier: 'T2', serviceType: 'web_branding', totalRevenueUsd: 2300, status: 'ACTIVE' },
    { bonsaiId: '36', name: 'Ludmila Esmail', contactPerson: 'Ludmila Esmail', email: '', country: 'CA', tier: 'T2', serviceType: 'web_design', totalRevenueCad: 1600, status: 'ACTIVE' },
    // Tier 3
    { bonsaiId: '37', name: 'Brittney Helene Hair', contactPerson: 'Brittney Helene Hair', email: '', country: 'CA', tier: 'T3', serviceType: 'hosting_maintenance', totalRevenueUsd: 580, totalRevenueCad: 850, status: 'ACTIVE' },
    { bonsaiId: '38', name: 'Deon Smith', contactPerson: 'Deon Smith', email: '', country: 'US', tier: 'T3', serviceType: 'hosting_updates', totalRevenueUsd: 320, status: 'ACTIVE' },
    { bonsaiId: '39', name: 'HTY JERKY / FUSION', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: 'design_dev', totalRevenueUsd: 750, status: 'ACTIVE', notes: 'Outstanding $500 USD (Invoice 1479).' },
    { bonsaiId: '40', name: 'Hey Rachel Stevens', contactPerson: 'Rachel Stevens', email: '', country: 'US', tier: 'T3', serviceType: 'landing_page', totalRevenueUsd: 680, status: 'ACTIVE' },
    { bonsaiId: '41', name: 'Tempo Brands', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: 'brand_support', totalRevenueUsd: 540, status: 'ACTIVE' },
    { bonsaiId: '42', name: 'Japan Gold', contactPerson: 'Scott Silverman', email: 'scott@japangoldusa.com', country: 'US', tier: 'T3', serviceType: 'packaging', totalRevenueUsd: 900, status: 'ACTIVE' },
    { bonsaiId: '43', name: 'Almond Brothers (Walt\'s Pretzels)', contactPerson: 'Steve Godber', email: 'steve@almondbrothers.com', country: 'US', tier: 'T3', serviceType: 'packaging_redesign', totalRevenueUsd: 850, status: 'ACTIVE', notes: 'Unbilled time: 10 hrs @ $50 = $500 exposure.' },
    { bonsaiId: '44', name: 'Botanic (New)', contactPerson: 'Jason R', email: 'jason.botanicllc@gmail.com', country: 'US', tier: 'T3', serviceType: 'web_design', totalRevenueUsd: 1200, status: 'ACTIVE' },
    { bonsaiId: '45', name: 'United Craft (Sola Identity)', contactPerson: 'Ian Macdonald', email: 'ian@unitedcraft.ca', country: 'CA', tier: 'T3', serviceType: 'branding_dieline', totalRevenueUsd: 470, status: 'ACTIVE', notes: 'OVERDUE: Invoice 1472 ($420 USD).' },
    { bonsaiId: '46', name: 'YoGhee Foods', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: 'brand_discovery', totalRevenueUsd: 1500, status: 'ACTIVE', notes: 'OVERDUE: Invoice 1464 ($750 USD).' },
    { bonsaiId: '47', name: 'Koala Rum', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: 'sales_deck', totalRevenueUsd: 400, status: 'ACTIVE' },
    { bonsaiId: '48', name: 'Jess Peters', contactPerson: 'Jess Peters', email: '', country: 'US', tier: 'T3', serviceType: 'web_branding_packaging', totalRevenueUsd: 950, status: 'ACTIVE', notes: 'Unbilled time: ~13 hrs @ ~$44/hr = ~$572 exposure.' },
    { bonsaiId: '49', name: 'Colby (Gemzy + Place Cards)', contactPerson: 'Colby', email: '', country: 'US', tier: 'T3', serviceType: 'design', totalRevenueUsd: 320, status: 'ACTIVE' },
    { bonsaiId: '50', name: 'Shirley Ansley (Octavia Fund)', contactPerson: 'Shirley Ansley', email: '', country: 'US', tier: 'T3', serviceType: 'web_design', totalRevenueUsd: 450, status: 'ACTIVE' },
    { bonsaiId: '51', name: 'Design Responsibly (Adobe Express)', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: 'influencer', totalRevenueUsd: 200, status: 'ACTIVE' },
    { bonsaiId: '52', name: "Kenyon O'Rourke", contactPerson: "Kenyon O'Rourke", email: '', country: 'US', tier: 'T3', serviceType: 'adobe_social', totalRevenueUsd: 180, status: 'ACTIVE' },
    { bonsaiId: '53', name: 'Enticity', contactPerson: 'Shanna Dennis', email: 'shanna@enticity.ca', country: 'CA', tier: 'T3', serviceType: 'design_dev', totalRevenueCad: 600, status: 'ACTIVE' },
    { bonsaiId: '54', name: 'Ian (Various)', contactPerson: 'Ian', email: '', country: 'US', tier: 'T3', serviceType: 'small_jobs', totalRevenueUsd: 280, status: 'ACTIVE' },
    { bonsaiId: '55', name: 'CD Howe (Nikita Campbell)', contactPerson: 'Nikita Campbell', email: 'nikita@cdhowe.org', country: 'US', tier: 'T3', serviceType: 'design', totalRevenueUsd: 300, status: 'ACTIVE' },
    { bonsaiId: '56', name: 'Ken Maclean (Marketize.com)', contactPerson: 'Ken Maclean', email: '', country: 'US', tier: 'T3', serviceType: 'web_design', totalRevenueUsd: 150, status: 'ACTIVE' },
    { bonsaiId: '57', name: 'Premier Staffing (Brooke Nistor)', contactPerson: 'Brooke Nistor', email: 'info@premierstaffinga.com', country: 'CA', tier: 'T3', serviceType: 'web_design', totalRevenueCad: 400, status: 'ACTIVE' },
    { bonsaiId: '58', name: 'Veronica Wang (Gloomy Humans)', contactPerson: 'Veronica Wang', email: '', country: 'CA', tier: 'T3', serviceType: 'web_design', totalRevenueCad: 250, status: 'ACTIVE', notes: 'OVERDUE: Invoice 1403 ($250 CAD, 155 days). NOT CONTACTED.' },
    { bonsaiId: '59', name: 'Luda Conti (Dieline)', contactPerson: 'Luda Conti', email: 'luda.conti@icloud.com', country: 'US', tier: 'T3', serviceType: 'dieline_transfer', totalRevenueUsd: 200, status: 'ACTIVE' },
    { bonsaiId: '60', name: 'LeGrand (Maison)', contactPerson: 'jbujold', email: 'jbujold@maisonlegrand.com', country: 'US', tier: 'T3', serviceType: 'dieline_update', totalRevenueUsd: 100, status: 'ACTIVE' },
    { bonsaiId: '61', name: 'Matcha Haus', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: '', status: 'ARCHIVED', notes: 'Dead lead. No revenue.' },
    { bonsaiId: '62', name: 'Micro Bakery', contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: '', status: 'ARCHIVED', notes: 'Archived. No recent activity.' },
    { bonsaiId: '63', name: "Cain'd", contactPerson: '', email: '', country: 'US', tier: 'T3', serviceType: '', status: 'LEAD', notes: 'Unbilled time: 10 hrs @ $50 = $500 exposure.' },
    { bonsaiId: '64', name: 'Corey Goss', contactPerson: 'Corey Goss', email: '', country: 'US', tier: 'T3', serviceType: '', status: 'LEAD', notes: 'Draft invoice $500 USD (Invoice 1446) pending send.' },
    { bonsaiId: '65', name: 'Smash Brand', contactPerson: '', email: '', country: 'US', tier: 'T1', serviceType: 'retainer_monthly', totalRevenueUsd: 2500, status: 'ACTIVE', notes: 'Invoice 1478 ($2,500 USD retainer) sent, due 2026-04-19.' },
  ];

  // Map to store bonsaiId → prisma client id
  const clientIdMap: Record<string, string> = {};

  for (const c of clientsData) {
    // Check for existing contact to upsert cleanly
    const client = await prisma.client.upsert({
      where: {
        // Use domain as unique key if available, otherwise we need a different strategy
        // Since domain isn't always set, we'll use a name-based approach
        // NOTE: In prod, may need to handle this differently
        domain: `bonsai-${c.bonsaiId}.legacy`, // synthetic unique domain for migration
      },
      update: {
        // Update fields if migrating again
        communicationPrefs: JSON.stringify({
          tier: c.tier,
          serviceType: c.serviceType,
          contactPerson: c.contactPerson,
          phone: '',
          address: '',
          city: c.city || '',
          provinceState: '',
          postalCode: '',
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
        knowledgeBase: JSON.stringify([
          c.notes ? { type: 'note', content: c.notes } : null,
        ].filter(Boolean)),
      },
    });

    clientIdMap[c.bonsaiId] = client.id;

    // Create primary contact if email exists
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

  const retainerData = [
    { bonsaiClientId: '1',  monthlyUsd: 1999, billingDay: 1,  startDate: new Date('2025-06-01'), renewalDate: new Date('2026-06-01'), status: 'ACTIVE' },
    { bonsaiClientId: '2',  monthlyUsd: 2000, billingDay: 5,  startDate: new Date('2025-06-15'), renewalDate: new Date('2026-06-15'), status: 'ACTIVE' },
    { bonsaiClientId: '3',  monthlyUsd: 999,  billingDay: 15, startDate: new Date('2023-11-01'), renewalDate: new Date('2026-03-15'), status: 'ACTIVE' },
    { bonsaiClientId: '4',  monthlyUsd: 1999, billingDay: 20, startDate: new Date('2024-11-01'), renewalDate: new Date('2026-11-01'), status: 'ACTIVE' }, // AT_RISK but still active
    { bonsaiClientId: '13', monthlyUsd: 900,  billingDay: 10, startDate: new Date('2025-06-15'), renewalDate: new Date('2026-06-15'), status: 'ACTIVE' },
    { bonsaiClientId: '9',  monthlyUsd: 1999, billingDay: 25, startDate: new Date('2025-05-01'), renewalDate: new Date('2026-05-01'), status: 'ACTIVE' },
    { bonsaiClientId: '10', monthlyUsd: 312,  billingDay: 1,  startDate: new Date('2024-10-01'), renewalDate: new Date('2025-10-01'), status: 'ACTIVE' },
    { bonsaiClientId: '37', monthlyUsd: 0, monthlyCad: 30, billingDay: 1, startDate: new Date('2022-11-01'), renewalDate: new Date('2027-11-01'), status: 'ACTIVE' },
    { bonsaiClientId: '65', monthlyUsd: 2500, billingDay: 19, startDate: new Date('2026-03-10'), renewalDate: new Date('2027-03-10'), status: 'ACTIVE' },
  ];

  for (const r of retainerData) {
    const clientId = clientIdMap[r.bonsaiClientId];
    if (!clientId) {
      console.warn(`⚠️ Client not found for bonsai ID: ${r.bonsaiClientId}`);
      continue;
    }

    await prisma.retainerPlan.upsert({
      where: { clientId },
      update: {},
      create: {
        clientId,
        tier: String(r.monthlyUsd || r.monthlyCad || 0),
        hoursPerMonth: Math.round((r.monthlyUsd || 0) / 50) || 10, // Estimate: $50/hr default
        billingCycleStart: r.startDate,
      },
    });
  }

  console.log(`✅ Seeded ${retainerData.length} retainer plans`);

  // ============================================================
  // STEP 3: Seed Invoices (key ones with full data)
  // ============================================================
  console.log('\n🧾 Seeding invoices...');

  // Get system user (Cameron) — assumes a user exists
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!adminUser) {
    console.error('❌ No admin user found. Create a user first, then run seed.');
    throw new Error('Admin user required for invoice seeding');
  }

  const invoicesData = [
    // Overdue
    { number: '1403', bonsaiClientId: '58', amountUsd: 0, amountCad: 250, currency: 'CAD', issueDate: '2025-10-01', dueDate: '2025-10-17', status: 'OVERDUE', method: null, notes: 'NO CONTACT. 155 days overdue. Consider write-off.' },
    { number: '1464', bonsaiClientId: '46', amountUsd: 750, amountCad: 0, currency: 'USD', issueDate: '2026-01-20', dueDate: '2026-02-20', status: 'OVERDUE', method: null, notes: 'Brand Discovery Phase 1. Follow up required.' },
    { number: '1472', bonsaiClientId: '45', amountUsd: 420, amountCad: 0, currency: 'USD', issueDate: '2026-02-20', dueDate: '2026-03-06', status: 'OVERDUE', method: null, notes: 'Sola branding/dieline.' },
    { number: '1481', bonsaiClientId: '4',  amountUsd: 100, amountCad: 0, currency: 'USD', issueDate: '2026-03-15', dueDate: '2026-03-17', status: 'OVERDUE', method: null, notes: 'Monthly retainer maintenance. Check payment method.' },
    // Outstanding
    { number: '1478', bonsaiClientId: '65', amountUsd: 2500, amountCad: 0, currency: 'USD', issueDate: '2026-03-10', dueDate: '2026-04-19', status: 'SENT', method: null, notes: 'New retainer. First invoice.' },
    { number: '1479', bonsaiClientId: '39', amountUsd: 500, amountCad: 0, currency: 'USD', issueDate: '2026-03-15', dueDate: '2026-03-23', status: 'SENT', method: null, notes: 'Side Deck project.' },
    { number: '1480', bonsaiClientId: '59', amountUsd: 200, amountCad: 0, currency: 'USD', issueDate: '2026-03-15', dueDate: '2026-03-23', status: 'SENT', method: null, notes: 'Dieline work.' },
    { number: '1483', bonsaiClientId: '60', amountUsd: 100, amountCad: 0, currency: 'USD', issueDate: '2026-03-15', dueDate: '2026-03-24', status: 'SENT', method: null, notes: 'Minor dieline update.' },
    // Drafts
    { number: '1236', bonsaiClientId: '17', amountUsd: 0, amountCad: 1650, currency: 'CAD', issueDate: '2025-12-01', dueDate: null, status: 'DRAFT', method: null, notes: 'Production work. Follow up on timing.' },
    { number: '1439', bonsaiClientId: '17', amountUsd: 0, amountCad: 1700, currency: 'CAD', issueDate: '2026-02-15', dueDate: null, status: 'DRAFT', method: null, notes: 'Retainer/production continuation.' },
    { number: '1446', bonsaiClientId: '64', amountUsd: 500, amountCad: 0, currency: 'USD', issueDate: '2026-02-20', dueDate: null, status: 'DRAFT', method: null, notes: 'Rendering work. Ready to send.' },
    { number: '1458', bonsaiClientId: '36', amountUsd: 0, amountCad: 445.01, currency: 'CAD', issueDate: '2026-02-28', dueDate: null, status: 'DRAFT', method: null, notes: 'Web design work. Client awaiting invoice.' },
    { number: '1465', bonsaiClientId: '46', amountUsd: 0, amountCad: 750, currency: 'CAD', issueDate: '2026-02-20', dueDate: null, status: 'DRAFT', method: null, notes: 'Brand Discovery Phase 2. Contingent on Phase 1 payment.' },
    { number: '1466', bonsaiClientId: '46', amountUsd: 0, amountCad: 750, currency: 'CAD', issueDate: '2026-02-20', dueDate: null, status: 'DRAFT', method: null, notes: 'Brand Discovery Phase 3. Contingent on Phase 1+2.' },
    { number: '1473', bonsaiClientId: '45', amountUsd: 0, amountCad: 50, currency: 'CAD', issueDate: '2026-03-10', dueDate: null, status: 'DRAFT', method: null, notes: 'Minor production support.' },
    // Paid (recent sample)
    { number: '1475', bonsaiClientId: '1',  amountUsd: 2500, amountCad: 0, currency: 'USD', issueDate: '2026-03-01', dueDate: '2026-03-05', paidDate: '2026-03-05', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1476', bonsaiClientId: '2',  amountUsd: 2000, amountCad: 0, currency: 'USD', issueDate: '2026-03-05', dueDate: '2026-03-10', paidDate: '2026-03-10', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1477', bonsaiClientId: '3',  amountUsd: 999, amountCad: 0, currency: 'USD', issueDate: '2026-03-08', dueDate: '2026-03-12', paidDate: '2026-03-12', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1482', bonsaiClientId: '13', amountUsd: 900, amountCad: 0, currency: 'USD', issueDate: '2026-03-12', dueDate: '2026-03-15', paidDate: '2026-03-15', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1484', bonsaiClientId: '2',  amountUsd: 2000, amountCad: 0, currency: 'USD', issueDate: '2026-03-15', dueDate: '2026-03-18', paidDate: '2026-03-18', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1470', bonsaiClientId: '10', amountUsd: 312, amountCad: 0, currency: 'USD', issueDate: '2026-02-28', dueDate: '2026-03-03', paidDate: '2026-03-03', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1471', bonsaiClientId: '10', amountUsd: 400, amountCad: 0, currency: 'USD', issueDate: '2026-03-01', dueDate: '2026-03-05', paidDate: '2026-03-05', status: 'PAID', method: 'credit_card', notes: '' },
    { number: '1474', bonsaiClientId: '13', amountUsd: 900, amountCad: 0, currency: 'USD', issueDate: '2026-02-28', dueDate: '2026-03-05', paidDate: '2026-03-05', status: 'PAID', method: 'credit_card', notes: '' },
  ];

  let invoiceCount = 0;
  for (const inv of invoicesData) {
    const clientId = clientIdMap[inv.bonsaiClientId];
    if (!clientId) {
      console.warn(`⚠️ Invoice ${inv.number}: client bonsai ID ${inv.bonsaiClientId} not found`);
      continue;
    }

    const amount = inv.amountUsd || (inv.amountCad * 0.80); // approx USD equiv
    const issueDate = new Date(inv.issueDate);
    const dueDate = inv.dueDate ? new Date(inv.dueDate) : undefined;
    const paidAt = inv.paidDate ? new Date(inv.paidDate) : null;
    const sentAt = inv.status !== 'DRAFT' ? issueDate : null;

    try {
      await prisma.invoice.upsert({
        where: { invoiceNumber: inv.number },
        update: {},
        create: {
          invoiceNumber: inv.number,
          status: inv.status,
          issueDate,
          dueDate: dueDate || undefined,
          subtotal: amount,
          tax: 0,
          total: amount,
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
      console.warn(`⚠️ Invoice ${inv.number} already exists or error:`, e);
    }
  }

  console.log(`✅ Seeded ${invoiceCount} invoices`);

  // ============================================================
  // STEP 4: Seed Revenue Snapshots
  // ============================================================
  console.log('\n📊 Seeding revenue snapshots...');

  const revenueData = [
    { month: '2025-03', revenueUsd: 8500, mrr: 6000 },
    { month: '2025-04', revenueUsd: 10000, mrr: 7500 },
    { month: '2025-05', revenueUsd: 12000, mrr: 8500 },
    { month: '2025-06', revenueUsd: 14000, mrr: 11000 },
    { month: '2025-07', revenueUsd: 15000, mrr: 11500 },
    { month: '2025-08', revenueUsd: 16000, mrr: 11500 },
    { month: '2025-09', revenueUsd: 14000, mrr: 11000 },
    { month: '2025-10', revenueUsd: 13000, mrr: 11000 },
    { month: '2025-11', revenueUsd: 14000, mrr: 11000 },
    { month: '2025-12', revenueUsd: 15000, mrr: 11000 },
    { month: '2026-01', revenueUsd: 14000, mrr: 11400 },
    { month: '2026-02', revenueUsd: 8000, mrr: 11400 },
    { month: '2026-03', revenueUsd: 4000, mrr: 11400 }, // partial
  ];

  for (const r of revenueData) {
    // RevenueSnapshot model doesn't exist yet — this runs AFTER schema migration
    // Uncomment once model is added:
    /*
    await prisma.revenueSnapshot.upsert({
      where: { month_clientId: { month: r.month, clientId: null } },
      update: {},
      create: {
        month: r.month,
        revenueUsd: r.revenueUsd,
        revenueUsdEquiv: r.revenueUsd,
        mrr: r.mrr,
        arr: r.mrr * 12,
        retainerRevenue: r.mrr,
        projectRevenue: r.revenueUsd - r.mrr,
        exchangeRateUsedCadUsd: 0.80,
      },
    });
    */
  }

  console.log(`✅ Revenue snapshot data prepared (${revenueData.length} months) — uncomment after schema migration`);

  console.log('\n🎉 Migration seed complete!');
  console.log(`
Summary:
  ✅ Clients: ${clientsData.length}
  ✅ Retainers: ${retainerData.length}
  ✅ Invoices: ${invoiceCount}
  ⏳ Revenue snapshots: Ready (uncomment after adding RevenueSnapshot model)
  
Next steps:
  1. Run schema migration: npx prisma migrate dev --name bonsai_migration
  2. Uncomment RevenueSnapshot seeding above
  3. Add Expense model entries manually or via CSV import
  4. Verify client/invoice counts in Hub UI
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
