#!/usr/bin/env node
/**
 * Quick test of Playwright functionality
 * Tests: page loading, DOM queries, error handling
 */

import playwright from 'playwright';

async function test() {
  console.log('🧪 Testing Playwright...\n');
  
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Test 1: Can navigate
    console.log('1️⃣  Testing page navigation...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    console.log(`   ✅ Loaded page: "${title}"\n`);
    
    // Test 2: Can query DOM
    console.log('2️⃣  Testing DOM queries...');
    const headings = await page.locator('h1').count();
    console.log(`   ✅ Found ${headings} h1 elements\n`);
    
    // Test 3: Can extract content
    console.log('3️⃣  Testing content extraction...');
    const firstHeading = await page.locator('h1').first().textContent();
    console.log(`   ✅ First heading: "${firstHeading}"\n`);
    
    // Test 4: Performance (multiple pages)
    console.log('4️⃣  Testing performance (3 pages)...');
    const start = Date.now();
    for (let i = 0; i < 3; i++) {
      await page.goto('https://example.com');
    }
    const elapsed = (Date.now() - start) / 1000;
    console.log(`   ✅ Loaded 3 pages in ${elapsed.toFixed(2)}s (avg ${(elapsed/3).toFixed(2)}s/page)\n`);
    
    console.log('✨ All tests passed! Playwright is working correctly.\n');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

test();
