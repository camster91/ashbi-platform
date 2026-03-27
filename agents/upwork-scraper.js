#!/usr/bin/env node

/**
 * Upwork Job Scraper Agent
 * 
 * Scans Upwork job feed for:
 * - React, WordPress, Shopify opportunities
 * - Budget: >$500, <50 proposals
 * - Stores results in hub.ashbi.ca database
 * - Alerts on opportunities >$2000
 * - Runs every 3 hours via cron
 * 
 * Config: Set HUB_API_BASE and HUB_BOT_SECRET in .env
 */

const fetch = require('node-fetch');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  HUB_API_BASE: process.env.HUB_API_BASE || 'https://hub.ashbi.ca/api',
  HUB_BOT_SECRET: process.env.HUB_BOT_SECRET,
  SEARCH_QUERIES: ['React', 'WordPress', 'Shopify'],
  MIN_BUDGET: 500,
  MAX_PROPOSALS: 50,
  ALERT_THRESHOLD: 2000,
  HEADLESS: true,
  TIMEOUT: 30000,
};

// Logging
const LOG_FILE = path.join(__dirname, '../memory/upwork-scraper-log.txt');

function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${level}: ${msg}\n`;
  console.log(logEntry);
  fs.appendFileSync(LOG_FILE, logEntry, { flag: 'a' });
}

/**
 * Authenticate to hub.ashbi.ca
 */
async function authenticateHub() {
  try {
    const response = await fetch(`${CONFIG.HUB_API_BASE}/bot/auth`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.HUB_BOT_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    log(`✅ Hub auth successful, token: ${data.token?.substring(0, 10)}...`);
    return data.token;
  } catch (error) {
    log(`❌ Hub auth failed: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Store opportunity in hub.ashbi.ca database
 */
async function storeOpportunity(hubToken, opportunity) {
  try {
    const response = await fetch(`${CONFIG.HUB_API_BASE}/opportunities`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'upwork',
        title: opportunity.title,
        description: opportunity.description,
        budget: opportunity.budget,
        proposals: opportunity.proposals,
        clientRating: opportunity.clientRating,
        jobUrl: opportunity.jobUrl,
        postedDate: opportunity.postedDate,
        tags: opportunity.tags,
        metadata: {
          upworkJobId: opportunity.upworkJobId,
          clientName: opportunity.clientName,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Store failed: ${response.status}`);
    }

    const data = await response.json();
    log(`✅ Stored: "${opportunity.title}" (${opportunity.jobUrl})`);

    // Alert if high-value opportunity
    if (opportunity.budget >= CONFIG.ALERT_THRESHOLD) {
      log(`🚨 HIGH-VALUE OPPORTUNITY: $${opportunity.budget} - "${opportunity.title}"`, 'ALERT');
      await sendAlert(opportunity);
    }

    return data;
  } catch (error) {
    log(`⚠️  Failed to store opportunity: ${error.message}`, 'WARN');
  }
}

/**
 * Send alert for high-value opportunities
 */
async function sendAlert(opportunity) {
  try {
    log(`ALERT SENT: $${opportunity.budget} opportunity detected`, 'ALERT');
  } catch (error) {
    log(`Failed to send alert: ${error.message}`, 'WARN');
  }
}

/**
 * Search Upwork for opportunities
 */
async function searchUpwork(browser, query) {
  let page = null;
  const opportunities = [];

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    // Navigate to search
    const searchUrl = `https://www.upwork.com/nx/search/jobs?q=${encodeURIComponent(query)}&sort=recency`;
    log(`📡 Searching Upwork: ${query}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle' });

    // Wait for job cards to load
    await page.waitForSelector('[data-test="JobCard-title"]', { timeout: 10000 });

    // Extract all visible jobs
    const jobs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-test="JobCard-title"]'))
        .slice(0, 20)
        .map((card) => {
          const parent = card.closest('[data-test="JobCard"]');
          if (!parent) return null;

          const titleEl = card;
          const budgetEl = parent.querySelector('[data-test="JobCard-budget"]');
          const proposalsEl = parent.querySelector('[data-test="JobCard-proposals"]');
          const linkEl = parent.querySelector('a[href*="/jobs/"]');
          const descEl = parent.querySelector('[data-test="JobCard-description"]');

          if (!titleEl || !budgetEl || !linkEl) return null;

          return {
            title: titleEl.textContent.trim(),
            description: descEl?.textContent.trim() || '',
            budget: budgetEl.textContent.trim(),
            proposals: proposalsEl?.textContent.trim() || '0',
            jobUrl: linkEl.href,
          };
        })
        .filter(Boolean);
    });

    log(`Found ${jobs.length} jobs for query: ${query}`);

    // Parse and filter
    for (const job of jobs) {
      try {
        const budgetMatch = job.budget.match(/\$([0-9,]+)/);
        const budget = budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, '')) : 0;

        const proposalsMatch = job.proposals.match(/(\d+)/);
        const proposals = proposalsMatch ? parseInt(proposalsMatch[1]) : 0;

        // Filter: budget >$500, <50 proposals
        if (budget >= CONFIG.MIN_BUDGET && proposals < CONFIG.MAX_PROPOSALS) {
          opportunities.push({
            title: job.title,
            description: job.description,
            budget,
            proposals,
            clientRating: 'N/A',
            jobUrl: job.jobUrl,
            postedDate: new Date().toISOString(),
            tags: [query],
          });
        }
      } catch (error) {
        log(`Error processing job: ${error.message}`, 'WARN');
      }
    }

    log(`✅ Filtered: ${opportunities.length} opportunities (budget >$${CONFIG.MIN_BUDGET}, <${CONFIG.MAX_PROPOSALS} proposals)`);
  } catch (error) {
    log(`Error searching Upwork: ${error.message}`, 'ERROR');
  } finally {
    if (page) await page.close();
  }

  return opportunities;
}

/**
 * Main execution
 */
async function main() {
  let browser = null;

  try {
    log('🚀 Upwork Job Scraper started');
    const startTime = Date.now();

    if (!CONFIG.HUB_BOT_SECRET) {
      throw new Error('HUB_BOT_SECRET not set in environment');
    }

    // Authenticate to hub
    const hubToken = await authenticateHub();

    // Launch browser
    log('🌐 Launching Chromium browser...');
    browser = await chromium.launch({ headless: CONFIG.HEADLESS });

    // Search for each query
    let totalOpportunities = 0;

    for (const query of CONFIG.SEARCH_QUERIES) {
      const opportunities = await searchUpwork(browser, query);
      totalOpportunities += opportunities.length;

      // Store each opportunity
      for (const opp of opportunities) {
        await storeOpportunity(hubToken, opp);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ Scrape complete: ${totalOpportunities} opportunities found and stored in ${duration}s`);
  } catch (error) {
    log(`❌ Fatal error: ${error.message}`, 'ERROR');
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    log(`Uncaught error: ${error.message}`, 'ERROR');
    process.exit(1);
  });
}

module.exports = { searchUpwork, storeOpportunity };
