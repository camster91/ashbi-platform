import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import prisma from '../src/config/db.js';

const resetLegacy = process.argv.includes('--reset-legacy');
const users = await prisma.user.findMany({
  select: { id: true, password: true },
});
const legacyUsers = users.filter((user) => !/^\$2[aby]\$/.test(user.password));

if (resetLegacy) {
  for (const user of legacyUsers) {
    const replacement = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: replacement,
        sessionVersion: { increment: 1 },
      },
    });
  }
}

console.log(JSON.stringify({
  totalAccounts: users.length,
  compliantAccounts: users.length - legacyUsers.length,
  legacyAccounts: legacyUsers.length,
  resetAccounts: resetLegacy ? legacyUsers.length : 0,
}));

await prisma.$disconnect();

if (legacyUsers.length > 0 && !resetLegacy) {
  process.exitCode = 2;
}
