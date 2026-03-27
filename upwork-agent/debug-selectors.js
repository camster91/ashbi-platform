import { launchBrowser, closeBrowser } from './browser.js';

const page = await launchBrowser();
await page.goto('https://www.upwork.com/nx/find-work/best-matches', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);

const info = await page.evaluate(() => {
  const selectors = [
    '[data-test="job-tile-list"]',
    'section[data-job-uid]',
    'article',
    '.job-tile',
    '[class*="JobTile"]',
    '[class*="job-tile"]',
    '[data-ev-label]',
    'li[class*="job"]',
  ];
  const found = {};
  for (const s of selectors) {
    found[s] = document.querySelectorAll(s).length;
  }
  // Sample class names that contain 'job'
  const jobClasses = [...new Set(
    Array.from(document.querySelectorAll('*'))
      .map(el => [...el.classList].filter(c => c.toLowerCase().includes('job')))
      .flat()
  )].slice(0, 10);

  // Any h2/h3 text that looks like job titles
  const headings = Array.from(document.querySelectorAll('h2, h3')).slice(0, 5).map(h => h.textContent.trim());

  return { url: window.location.href, title: document.title, found, jobClasses, headings };
});

console.log(JSON.stringify(info, null, 2));
await closeBrowser();
