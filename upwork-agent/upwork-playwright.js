/**
 * upwork-playwright.js — Browser automation via Playwright
 * 
 * Replaces upwork-claude.js to avoid blocking on Claude CLI spawning.
 * Uses Playwright to control a real Chrome browser (or Chromium).
 * 
 * Requires: playwright npm package
 * Benefits:
 * - Non-blocking: runs asynchronously without spawning CLI
 * - Faster: no latency waiting for Claude processes
 * - Reliable: headless automation is stable
 * - Works in CI/CD: no browser extension dependency
 */

import playwright from 'playwright';

// Profile keywords for job scoring
export const KEYWORDS_BY_PROFILE = {
  cameron: [
    'shopify', 'wordpress', 'woocommerce', 'web design', 'website build',
    'website redesign', 'webflow', 'elementor', 'web developer', 'agency partner',
    'white label', 'white-label', 'website development', 'ecommerce store',
    'squarespace', 'landing page', 'page builder',
  ],
  bianca: [
    'cpg', 'dtc', 'branding', 'brand identity', 'packaging design',
    'label design', 'logo design', 'product design', 'package design',
    'brand guidelines', 'visual identity', 'cpg brand', 'beverage brand',
    'supplement brand', 'skincare brand',
  ],
};

export const ACTIVE_PROFILE = process.env.UPWORK_PROFILE || 'cameron';

let browser = null;

/**
 * Get or create a browser instance.
 * Simple approach: use regular launch with Chrome system binary (no userDataDir).
 * Cookies are handled by the real Chrome installation.
 */
async function getBrowser() {
  if (browser) return browser;
  
  console.log('[Playwright] Launching Chrome...');
  
  const chromeExePath = process.env.CHROME_EXE_PATH || 
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  try {
    // Use the real Chrome binary
    browser = await playwright.chromium.launch({ 
      executablePath: chromeExePath,
      headless: false,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
      ],
    });
    console.log('[Playwright] ✅ Chrome launched');
  } catch (err) {
    console.warn(`[Playwright] ⚠️  Could not launch Chrome: ${err.message}`);
    console.log('[Playwright] Falling back to Chromium...');
    browser = await playwright.chromium.launch({ headless: true });
  }
  
  // Graceful shutdown on process exit
  process.on('exit', async () => {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // ignore
      }
    }
  });
  
  return browser;
}

/**
 * Create a new page with session/login context.
 * If upwork-session.json exists, uses saved login.
 * Otherwise, creates fresh context (no login).
 */
async function withPage(callback) {
  const br = await getBrowser();
  
  // Check if session file exists
  let context;
  const sessionPath = new URL(import.meta.url).pathname
    .split('/')
    .slice(0, -1)
    .join('/') + '/upwork-session.json';
  
  try {
    // Try to use saved session
    const fs = await import('fs').then(m => m.promises);
    await fs.access(sessionPath);
    
    console.log('[Playwright] Loading saved Upwork session...');
    context = await br.newContext({
      storageState: sessionPath,
    });
  } catch (err) {
    // No session file, create fresh context
    context = await br.newContext();
  }
  
  const page = await context.newPage();
  
  try {
    return await callback(page);
  } finally {
    await context.close();
  }
}

/**
 * Wait for page load with retry.
 */
async function loadPage(page, url, timeout = 15000) {
  console.log(`[Playwright] Loading ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    await page.waitForTimeout(3000); // Extra time for dynamic content to load
  } catch (err) {
    console.warn(`[Playwright] Load timeout, retrying: ${err.message}`);
    try {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    } catch (retryErr) {
      console.warn(`[Playwright] Reload failed: ${retryErr.message}`);
    }
  }
}

/**
 * Read messages from Upwork inbox.
 * Returns array of { sender, preview, timestamp, roomUrl, roomId, isUnread }
 */
export async function readMessages() {
  return withPage(async (page) => {
    await loadPage(page, 'https://www.upwork.com/messages/rooms');
    
    // Wait for message list to appear
    try {
      await page.waitForSelector('[data-test="message-list"], .message-list, [role="list"]', { timeout: 10000 });
    } catch (err) {
      console.log('[Playwright] Message list not found, returning empty');
      return [];
    }
    
    const messages = await page.evaluate(() => {
      const threads = [];
      
      // Try multiple selectors for message items
      const items = document.querySelectorAll(
        '[data-test="message-list"] > [role="button"], ' +
        '.message-list__item, ' +
        '[role="listitem"], ' +
        '.message-item'
      );
      
      for (const item of Array.from(items).slice(0, 20)) {
        // Try to find room link
        const link = item.querySelector('a[href*="/messages/rooms"]');
        if (!link) continue;
        
        const roomUrl = link.href;
        const roomId = roomUrl.match(/\/rooms\/([^/?]+)/)?.[1];
        if (!roomId) continue;
        
        // Extract sender name (try multiple selectors)
        const senderEl = item.querySelector(
          '[data-test="message-from"], ' +
          '.from-name, ' +
          '.freelancer-name, ' +
          '[class*="sender"], ' +
          'strong'
        );
        const sender = senderEl?.textContent?.trim() || 'Unknown';
        
        // Extract message preview
        const previewEl = item.querySelector(
          '[data-test="message-preview"], ' +
          '.preview, ' +
          '.last-message, ' +
          '[class*="preview"]'
        );
        const preview = previewEl?.textContent?.trim() || '';
        
        // Extract timestamp
        const timeEl = item.querySelector(
          '[data-test="timestamp"], ' +
          '.timestamp, ' +
          'time'
        );
        const timestamp = timeEl?.textContent?.trim() || '';
        
        // Check if unread
        const isUnread = item.classList.contains('unread') || item.getAttribute('data-unread') === 'true';
        
        threads.push({ sender, preview, timestamp, roomUrl, roomId, isUnread: !!isUnread });
      }
      
      return threads;
    });
    
    console.log(`[Playwright] Found ${messages.length} message threads`);
    return messages;
  });
}

/**
 * Read full message thread for a specific room.
 * Returns { roomId, participants, messages: [{ sender, text, timestamp }] }
 */
export async function readMessageThread(roomId) {
  return withPage(async (page) => {
    await loadPage(page, `https://www.upwork.com/messages/rooms/${roomId}`);
    
    // Auto-scroll to load older messages
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const container = document.querySelector('[data-test="message-thread"], .thread-list');
        if (container) container.scrollTop = 0;
      });
      await page.waitForTimeout(500);
    }
    
    const thread = await page.evaluate(rid => {
      const messages = [];
      const items = document.querySelectorAll('[data-test="message"], .message-item');
      
      for (const item of items) {
        const sender = item.querySelector('[data-test="message-from"], .sender, .from-name')?.textContent?.trim();
        const text = item.querySelector('[data-test="message-text"], .message-content, .text')?.textContent?.trim();
        const timestamp = item.querySelector('[data-test="timestamp"], .timestamp, time')?.textContent?.trim();
        
        if (sender && text) {
          messages.push({ sender, text, timestamp: timestamp || '' });
        }
      }
      
      // Extract participants
      const participantElements = document.querySelectorAll('[data-test="participant"], .participant-name');
      const participants = Array.from(participantElements).map(el => el.textContent.trim()).filter(Boolean);
      
      return { roomId: rid, participants: [...new Set(participants)], messages };
    }, roomId);
    
    console.log(`[Playwright] Read thread ${roomId}: ${thread.messages.length} messages, ${thread.participants.length} participants`);
    return thread;
  });
}

/**
 * Scrape the Upwork job feed.
 * Returns array of job objects.
 */
export async function scrapeJobFeed() {
  return withPage(async (page) => {
    await loadPage(page, 'https://www.upwork.com/nx/find-work/best-matches?sort=recency');
    
    // Scroll to load more jobs
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(500);
    }
    
    const jobs = await page.evaluate(() => {
      const jobCards = [];
      const items = document.querySelectorAll('[data-test="job-tile"], .job-tile, article.job-card');
      
      for (const item of Array.from(items).slice(0, 30)) {
        const titleEl = item.querySelector('[data-test="job-title"], h2, .title');
        const title = titleEl?.textContent?.trim();
        const url = item.querySelector('a[href*="/jobs/"]')?.href;
        
        if (!title || !url) continue;
        
        const description = item.querySelector('[data-test="job-description"], .description, .excerpt')?.textContent?.trim() || '';
        const budget = item.querySelector('[data-test="budget"], .budget, .amount')?.textContent?.trim() || '';
        const postedTime = item.querySelector('[data-test="posted-time"], .posted, time')?.textContent?.trim() || '';
        const client = item.querySelector('[data-test="client-info"], .client, .by')?.textContent?.trim() || '';
        const skillElements = item.querySelectorAll('[data-test="skill"], .skill, .tag');
        const skills = Array.from(skillElements).map(el => el.textContent.trim());
        
        jobCards.push({
          title,
          url,
          description: description.slice(0, 500),
          budget,
          postedTime,
          client,
          skills,
          tier: '',
          proposals: '',
        });
      }
      
      return jobCards;
    });
    
    console.log(`[Playwright] Found ${jobs.length} job listings`);
    return jobs;
  });
}

/**
 * Scrape submitted proposals.
 * Returns array of { title, jobUrl, status, submittedDate }
 */
export async function scrapeProposals() {
  return withPage(async (page) => {
    await loadPage(page, 'https://www.upwork.com/ab/proposals/');
    
    const proposals = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('[data-test="proposal"], .proposal-item, tr');
      
      for (const row of Array.from(rows).slice(0, 30)) {
        const titleEl = row.querySelector('[data-test="proposal-title"], .title, td:first-child');
        const title = titleEl?.textContent?.trim();
        
        const linkEl = row.querySelector('a[href*="/jobs/"]');
        const jobUrl = linkEl?.href;
        
        const statusEl = row.querySelector('[data-test="status"], .status, .badge');
        const status = statusEl?.textContent?.trim() || '';
        
        const dateEl = row.querySelector('[data-test="submitted-date"], .date, time');
        const submittedDate = dateEl?.textContent?.trim() || '';
        
        if (title && jobUrl) {
          items.push({ title, jobUrl, status, submittedDate });
        }
      }
      
      return items;
    });
    
    console.log(`[Playwright] Found ${proposals.length} proposals`);
    return proposals;
  });
}

/**
 * Scrape hiring dashboard.
 * Returns { jobPosts, applicants, activeContracts }
 */
export async function scrapeHiring() {
  return withPage(async (page) => {
    // Page 1: Job posts
    await loadPage(page, 'https://www.upwork.com/nx/hire/');
    
    const jobPosts = await page.evaluate(() => {
      const posts = [];
      const items = document.querySelectorAll('[data-test="job-post"], .job-post, article');
      
      for (const item of Array.from(items).slice(0, 10)) {
        const titleEl = item.querySelector('[data-test="title"], h3, .title');
        const title = titleEl?.textContent?.trim();
        const linkEl = item.querySelector('a[href*="/jobs/"]');
        const url = linkEl?.href;
        const applicantCountEl = item.querySelector('[data-test="applicant-count"], .count');
        const applicantCount = applicantCountEl?.textContent?.trim() || '0';
        const postedDateEl = item.querySelector('[data-test="posted-date"], time, .date');
        const postedDate = postedDateEl?.textContent?.trim() || '';
        const statusEl = item.querySelector('[data-test="status"], .status');
        const status = statusEl?.textContent?.trim() || 'open';
        
        if (title) {
          posts.push({ title, url: url || '', applicantCount, postedDate, status });
        }
      }
      
      return posts;
    });
    
    // Page 2: Active contracts
    await loadPage(page, 'https://www.upwork.com/ab/contracts/active');
    
    const activeContracts = await page.evaluate(() => {
      const contracts = [];
      const items = document.querySelectorAll('[data-test="contract"], .contract-item, tr');
      
      for (const item of Array.from(items).slice(0, 20)) {
        const nameEl = item.querySelector('[data-test="freelancer-name"], .name, td:first-child');
        const freelancerName = nameEl?.textContent?.trim();
        const jobEl = item.querySelector('[data-test="job-title"], .job, td:nth-child(2)');
        const jobTitle = jobEl?.textContent?.trim();
        const hoursEl = item.querySelector('[data-test="hours"], .hours, td:nth-child(3)');
        const hoursLogged = hoursEl?.textContent?.trim() || '0';
        const activityEl = item.querySelector('[data-test="last-activity"], .activity, td:last-child');
        const lastActivity = activityEl?.textContent?.trim() || '';
        
        if (freelancerName) {
          contracts.push({ freelancerName, jobTitle: jobTitle || '', hoursLogged, lastActivity });
        }
      }
      
      return contracts;
    });
    
    console.log(`[Playwright] Found ${jobPosts.length} job posts, ${activeContracts.length} active contracts`);
    return { jobPosts, applicants: [], activeContracts };
  });
}

/**
 * Graceful shutdown.
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
