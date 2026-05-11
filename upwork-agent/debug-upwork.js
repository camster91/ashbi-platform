#!/usr/bin/env node
/**
 * Debug script to see what Upwork pages look like
 * Takes a screenshot to verify Chrome is loading the page correctly
 */

import playwright from 'playwright';
import fs from 'fs';

async function debug() {
  console.log('🔍 Opening Upwork with real Chrome...\n');
  
  const chromeExePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await playwright.chromium.launch({
    executablePath: chromeExePath,
    headless: false,
  });
  
  const page = await browser.newPage();
  
  console.log('📂 Navigating to https://www.upwork.com/messages/rooms...');
  await page.goto('https://www.upwork.com/messages/rooms', { waitUntil: 'networkidle' });
  
  console.log('⏳ Waiting 5 seconds for page to fully load...');
  await page.waitForTimeout(5000);
  
  // Take a screenshot
  const screenshotPath = './upwork-debug-screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);
  
  // Get page title and URL
  const title = await page.title();
  const url = page.url();
  console.log(`📄 Page title: "${title}"`);
  console.log(`🔗 Current URL: ${url}`);
  
  // Try to find message list
  const messageListSelector = '[data-test="message-list"], .message-list, [role="list"]';
  const exists = await page.$(messageListSelector);
  console.log(`\n📋 Message list element exists: ${exists ? '✅ YES' : '❌ NO'}`);
  
  // List all text content on page (first 500 chars)
  const bodyText = await page.locator('body').textContent();
  if (bodyText && bodyText.trim().length > 0) {
    console.log(`\n📝 Page content (first 300 chars):\n${bodyText.slice(0, 300)}`);
  } else {
    console.log('\n⚠️  Page appears to be empty (no text content)');
  }
  
  // Check if we're logged in (look for logout link or profile menu)
  const logoutLink = await page.$('a[href*="logout"], button[aria-label*="Account"]');
  if (logoutLink) {
    console.log('✅ Logged in (found logout/account link)');
  } else {
    console.log('⚠️  May not be logged in (no logout link found)');
  }
  
  console.log('\n🎯 Keep the browser window open to inspect manually.');
  console.log('   The screenshot is saved above.');
  console.log('   Press Ctrl+C to close when done.\n');
  
  // Keep browser open for manual inspection
  await page.waitForTimeout(60000);
  
  await browser.close();
}

debug().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
