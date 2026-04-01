#!/usr/bin/env node
/**
 * Interactive Upwork login setup
 * 
 * This script:
 * 1. Opens Chrome
 * 2. Navigates to Upwork login
 * 3. Waits for you to manually log in
 * 4. Saves your session to upwork-session.json
 * 5. Future runs use that saved session (no login needed)
 * 
 * Usage:
 *   node setup-upwork-session.js
 * 
 * Then:
 * - Chrome will open to Upwork login
 * - Log in with your credentials
 * - Script will automatically detect when you're logged in
 * - Session saved! You're done.
 */

import playwright from 'playwright';
import fs from 'fs';

const SESSION_FILE = './upwork-session.json';

async function setupSession() {
  console.log('🔐 Upwork Session Setup\n');
  console.log('This will help you set up automatic Upwork login.\n');
  
  const chromeExePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  console.log('1️⃣  Launching Chrome...');
  const browser = await playwright.chromium.launch({
    executablePath: chromeExePath,
    headless: false,
  });
  
  console.log('2️⃣  Opening Upwork login page...\n');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://www.upwork.com/ab/account-security/login', {
    waitUntil: 'domcontentloaded',
  });
  
  console.log('📝 LOGIN INSTRUCTIONS:');
  console.log('   • Chrome should open to Upwork login page');
  console.log('   • Enter your email and password');
  console.log('   • Complete any 2FA if prompted');
  console.log('   • Once logged in, this script will detect it\n');
  console.log('⏳ Waiting for you to log in... (this may take a minute)\n');
  
  // Wait for successful login by checking if we've been redirected away from login page
  let loggedIn = false;
  let attempts = 0;
  const maxAttempts = 120; // 2 minutes (poll every second)
  
  while (!loggedIn && attempts < maxAttempts) {
    await page.waitForTimeout(1000);
    attempts++;
    
    const currentUrl = page.url();
    const title = await page.title();
    
    // Check if we're no longer on login page
    if (!currentUrl.includes('/account-security/login') && !currentUrl.includes('login')) {
      loggedIn = true;
      console.log(`\n✅ Login detected!`);
      console.log(`   Current page: ${title}`);
      console.log(`   URL: ${currentUrl}`);
      break;
    }
    
    // Show progress every 10 seconds
    if (attempts % 10 === 0) {
      console.log(`   ⏳ Still waiting... (${attempts}s)`);
    }
  }
  
  if (!loggedIn) {
    console.error('\n❌ Login timeout. Please try again.');
    await browser.close();
    process.exit(1);
  }
  
  // Wait a bit for page to fully load
  await page.waitForTimeout(2000);
  
  // Save session
  console.log('\n3️⃣  Saving your session...');
  await context.storageState({ path: SESSION_FILE });
  console.log(`   ✅ Session saved to: ${SESSION_FILE}`);
  
  // Verify session file was created
  if (fs.existsSync(SESSION_FILE)) {
    const stats = fs.statSync(SESSION_FILE);
    console.log(`   📦 File size: ${(stats.size / 1024).toFixed(1)} KB`);
  }
  
  console.log('\n4️⃣  Closing browser...');
  await browser.close();
  
  console.log('\n🎉 Setup complete!\n');
  console.log('Your Upwork session is now saved. Future runs will use this login.\n');
  console.log('Next steps:');
  console.log('  npm run messages   # Get your Upwork messages');
  console.log('  npm run feed       # Find new jobs');
  console.log('  npm run proposals  # Check your proposals\n');
  console.log('💡 Tip: If the session expires, just run this script again.\n');
}

setupSession().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
