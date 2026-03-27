#!/usr/bin/env node
/**
 * Automated Upwork login with email + password
 * 
 * Usage:
 *   UPWORK_EMAIL=cameron@ashbi.ca UPWORK_PASSWORD=yourpassword node upwork-login-auto.js
 * 
 * Or just run it and enter credentials interactively.
 */

import playwright from 'playwright';
import fs from 'fs';
import readline from 'readline';

const SESSION_FILE = './upwork-session.json';

// Prompt for input
function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function autoLogin() {
  console.log('🔐 Automated Upwork Login\n');
  
  // Get credentials from env or prompt
  let email = process.env.UPWORK_EMAIL;
  let password = process.env.UPWORK_PASSWORD;
  
  if (!email) {
    email = await prompt('Upwork email: ');
  }
  
  if (!password) {
    password = await prompt('Upwork password: ');
  }
  
  if (!email || !password) {
    console.error('❌ Email and password required');
    process.exit(1);
  }
  
  console.log(`\n🔑 Logging in as: ${email}\n`);
  
  const chromeExePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  console.log('1️⃣  Launching Chrome...');
  const browser = await playwright.chromium.launch({
    executablePath: chromeExePath,
    headless: false,
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('2️⃣  Navigating to Upwork login...');
    await page.goto('https://www.upwork.com/ab/account-security/login', {
      waitUntil: 'domcontentloaded',
    });
    
    await page.waitForTimeout(1000);
    
    console.log('3️⃣  Entering email...');
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    if (emailInput) {
      await emailInput.fill(email);
      console.log('   ✅ Email entered');
    } else {
      console.warn('   ⚠️  Could not find email input');
    }
    
    // Click continue/next button
    console.log('4️⃣  Clicking continue...');
    const continueBtn = await page.$('button[type="submit"], button:has-text("Continue"), button:has-text("Next")');
    if (continueBtn) {
      await continueBtn.click();
      console.log('   ✅ Clicked continue');
    }
    
    // Wait for password field
    await page.waitForTimeout(2000);
    
    console.log('5️⃣  Entering password...');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (passwordInput) {
      await passwordInput.fill(password);
      console.log('   ✅ Password entered');
    } else {
      console.warn('   ⚠️  Could not find password input');
    }
    
    // Click login button
    console.log('6️⃣  Clicking login...');
    const loginBtn = await page.$('button[type="submit"]:has-text("Log In"), button[type="submit"]:has-text("Sign In"), button[type="submit"]');
    if (loginBtn) {
      await loginBtn.click();
      console.log('   ✅ Clicked login');
    }
    
    // Wait for navigation to complete
    console.log('\n⏳ Waiting for login to complete...');
    let loggedIn = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const url = page.url();
      
      if (!url.includes('/account-security/login') && !url.includes('login')) {
        loggedIn = true;
        console.log(`\n✅ Login successful!`);
        console.log(`   Current URL: ${url}`);
        break;
      }
      
      if (i % 10 === 0 && i > 0) {
        console.log(`   Still waiting... (${i}s)`);
      }
    }
    
    if (!loggedIn) {
      console.error('\n⚠️  Login may have failed. Check the browser window.');
      console.log('   You can still manually complete login if needed.');
      console.log('   Script will wait 30 more seconds...\n');
      
      // Wait for manual login
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);
        const url = page.url();
        if (!url.includes('/account-security/login') && !url.includes('login')) {
          console.log('✅ Manual login detected!');
          loggedIn = true;
          break;
        }
      }
    }
    
    if (!loggedIn) {
      console.error('❌ Login failed');
      await browser.close();
      process.exit(1);
    }
    
    // Wait for page to load
    await page.waitForTimeout(3000);
    
    // Save session
    console.log('\n7️⃣  Saving your session...');
    await context.storageState({ path: SESSION_FILE });
    console.log(`   ✅ Session saved to: ${SESSION_FILE}`);
    
    if (fs.existsSync(SESSION_FILE)) {
      const stats = fs.statSync(SESSION_FILE);
      console.log(`   📦 File size: ${(stats.size / 1024).toFixed(1)} KB`);
    }
    
    console.log('\n🎉 Setup complete!\n');
    console.log('Your Upwork session is now saved. Future runs will use this login.\n');
    console.log('Next steps:');
    console.log('  npm run messages   # Get your Upwork messages');
    console.log('  npm run feed       # Find new jobs');
    console.log('  npm run proposals  # Check your proposals\n');
    
  } catch (err) {
    console.error('❌ Error during login:', err.message);
    console.error('   You can still manually log in if the browser is still open.');
    process.exit(1);
  } finally {
    console.log('Closing browser in 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

autoLogin();
