#!/usr/bin/env node
// Security audit script for Agency Hub

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AUTHORIZED_ADMINS = [
  'cameron@ashbi.ca',
  'bianca@ashbi.ca'
];

async function auditUsers() {
  console.log('🔍 Running security audit...\n');

  // Get all users
  const allUsers = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`📊 Total users: ${allUsers.length}\n`);

  // Check admin users
  const adminUsers = allUsers.filter(user => user.role === 'ADMIN');
  console.log('👑 Admin Users:');
  console.log('================');

  let unauthorizedAdmins = [];

  for (const admin of adminUsers) {
    const isAuthorized = AUTHORIZED_ADMINS.includes(admin.email);
    const status = isAuthorized ? '✅ AUTHORIZED' : '❌ UNAUTHORIZED';
    const activeStatus = admin.isActive ? 'ACTIVE' : 'INACTIVE';
    
    console.log(`${status} | ${admin.email} | ${admin.name} | ${activeStatus}`);
    
    if (!isAuthorized) {
      unauthorizedAdmins.push(admin);
    }
  }

  console.log('');

  // Check team users
  const teamUsers = allUsers.filter(user => user.role === 'TEAM');
  console.log('👥 Team Users:');
  console.log('==============');

  for (const user of teamUsers) {
    const activeStatus = user.isActive ? 'ACTIVE' : 'INACTIVE';
    console.log(`✅ VALID | ${user.email} | ${user.name} | ${activeStatus}`);
  }

  console.log('');

  // Security recommendations
  console.log('🔒 Security Audit Results:');
  console.log('==========================');

  if (unauthorizedAdmins.length === 0) {
    console.log('✅ All admin users are authorized');
  } else {
    console.log('❌ Found unauthorized admin users:');
    for (const admin of unauthorizedAdmins) {
      console.log(`   - ${admin.email} (${admin.name}) - ID: ${admin.id}`);
    }
    console.log('\n⚠️  RECOMMENDATION: Review and demote/remove unauthorized admin accounts');
  }

  // Check for test/demo accounts
  const testAccounts = allUsers.filter(user => 
    user.email.includes('test') || 
    user.email.includes('demo') || 
    user.email.includes('example') ||
    user.name.toLowerCase().includes('test') ||
    user.name.toLowerCase().includes('demo')
  );

  if (testAccounts.length > 0) {
    console.log('\n❌ Found potential test/demo accounts:');
    for (const account of testAccounts) {
      console.log(`   - ${account.email} (${account.name}) - ID: ${account.id}`);
    }
    console.log('\n⚠️  RECOMMENDATION: Remove test/demo accounts from production');
  } else {
    console.log('✅ No test/demo accounts found');
  }

  // Check inactive accounts
  const inactiveUsers = allUsers.filter(user => !user.isActive);
  if (inactiveUsers.length > 0) {
    console.log(`\n🔒 Found ${inactiveUsers.length} inactive user(s):`);
    for (const user of inactiveUsers) {
      console.log(`   - ${user.email} (${user.name}) - Role: ${user.role}`);
    }
  }

  console.log('\n📋 Summary:');
  console.log(`   - Total Users: ${allUsers.length}`);
  console.log(`   - Admin Users: ${adminUsers.length}`);
  console.log(`   - Team Users: ${teamUsers.length}`);
  console.log(`   - Active Users: ${allUsers.filter(u => u.isActive).length}`);
  console.log(`   - Inactive Users: ${inactiveUsers.length}`);
  console.log(`   - Unauthorized Admins: ${unauthorizedAdmins.length}`);

  return {
    totalUsers: allUsers.length,
    adminUsers: adminUsers.length,
    unauthorizedAdmins: unauthorizedAdmins.length,
    testAccounts: testAccounts.length,
    inactiveUsers: inactiveUsers.length,
    isSecure: unauthorizedAdmins.length === 0 && testAccounts.length === 0
  };
}

async function fixUnauthorizedAdmins() {
  console.log('\n🔧 Fixing unauthorized admin accounts...\n');

  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' }
  });

  for (const admin of adminUsers) {
    if (!AUTHORIZED_ADMINS.includes(admin.email)) {
      console.log(`🔽 Demoting ${admin.email} from ADMIN to TEAM...`);
      await prisma.user.update({
        where: { id: admin.id },
        data: { role: 'TEAM' }
      });
    }
  }

  console.log('✅ Unauthorized admin cleanup complete');
}

async function main() {
  try {
    const results = await auditUsers();

    if (process.argv.includes('--fix')) {
      if (!results.isSecure) {
        await fixUnauthorizedAdmins();
      }
    } else if (!results.isSecure) {
      console.log('\n💡 Run with --fix to automatically demote unauthorized admins');
    }

    console.log('\n🎉 Security audit complete!');
    
    // Exit with error code if security issues found
    process.exit(results.isSecure ? 0 : 1);
  } catch (error) {
    console.error('❌ Security audit failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();