const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const budgets = [
  { id: 'cmmw5lp17000qdf008hjq7pvk', name: 'Specialty Rice',   hours: 46 },
  { id: 'cmmw8nukr000un3jo0xsom49l', name: 'Smash Brand',      hours: 50 },
  { id: 'cmmw5lpa3008adf00mo3are8b', name: 'Influencer Link',  hours: 40 },
  { id: 'cmmw5lp23001mdf00qthbrdrl', name: 'Marin / LaTanya',  hours: 40 },
  { id: 'cmmw5lp3l0022df002mxo5d2g', name: 'Mom Water',        hours: 20 },
  { id: 'cmmw5lp85004udf00kysiix8x', name: 'Club Kalm',        hours: 18 },
  { id: 'cmmw5lp9m007edf001a9p75wz', name: 'LaTanya Miles',    hours:  7 },
];

async function main() {
  for (const b of budgets) {
    try {
      const updated = await prisma.project.update({
        where: { id: b.id },
        data: { hourlyBudget: b.hours },
        select: { id: true, name: true, hourlyBudget: true },
      });
      console.log(`✅ ${updated.name} → ${updated.hourlyBudget} hrs`);
    } catch (e) {
      console.log(`❌ ${b.name} (${b.id}): ${e.message}`);
    }
  }
  await prisma.$disconnect();
}

main();
