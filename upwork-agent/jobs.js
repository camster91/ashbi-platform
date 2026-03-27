// FREELANCER mode — scrape best matches job feed

// Keywords are profile-specific:
// Cameron (Web/Dev): Shopify, WordPress, website builds, agency partnerships
// Bianca (Creative): CPG, DTC, branding, packaging, label design — configured separately
const KEYWORDS_BY_PROFILE = {
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

import { ACTIVE_PROFILE } from './browser.js';
const KEYWORDS = KEYWORDS_BY_PROFILE[ACTIVE_PROFILE] || KEYWORDS_BY_PROFILE.cameron;

function scoreJob(job) {
  const text = `${job.title} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const kw of KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  // Budget bonus
  if (job.budget) {
    const amt = parseFloat(job.budget.replace(/[^0-9.]/g, ''));
    if (amt >= 5000) score += 2;
    else if (amt >= 1000) score += 1;
  }
  return Math.min(score, 10);
}

export async function scrapeJobs(page) {
  await page.goto('https://www.upwork.com/nx/find-work/best-matches', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const jobs = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-test="job-tile-list"] section, .job-tile, article[data-ev-label="search_results_impression"]');
    if (cards.length === 0) {
      // Fallback: try broader selector
      const fallback = document.querySelectorAll('section.air3-card-section, div[class*="JobTile"]');
      return Array.from(fallback).slice(0, 20).map((el) => {
        const titleEl = el.querySelector('a[class*="title"], h2 a, a[data-test="job-tile-title-link"]');
        const descEl = el.querySelector('[data-test="job-description-text"], [class*="description"], p');
        const budgetEl = el.querySelector('[data-test="budget"], [class*="budget"], span[class*="Budget"]');
        const timeEl = el.querySelector('[data-test="posted-on"], span[class*="posted"], small');
        const skillEls = el.querySelectorAll('[data-test="token"], span[class*="skill"], .air3-token');
        return {
          title: titleEl?.textContent?.trim() || '',
          url: titleEl?.href || '',
          description: descEl?.textContent?.trim()?.slice(0, 500) || '',
          budget: budgetEl?.textContent?.trim() || '',
          postedTime: timeEl?.textContent?.trim() || '',
          client: '',
          skills: Array.from(skillEls).map(s => s.textContent.trim()),
        };
      });
    }
    return Array.from(cards).slice(0, 20).map((el) => {
      const titleEl = el.querySelector('a[class*="title"], h2 a, a[data-test="job-tile-title-link"]');
      const descEl = el.querySelector('[data-test="job-description-text"], [class*="description"], p');
      const budgetEl = el.querySelector('[data-test="budget"], [class*="budget"]');
      const timeEl = el.querySelector('[data-test="posted-on"], span[class*="posted"]');
      const clientEl = el.querySelector('[data-test="client-name"], [class*="client"]');
      const skillEls = el.querySelectorAll('[data-test="token"], span[class*="skill"], .air3-token');
      return {
        title: titleEl?.textContent?.trim() || '',
        url: titleEl?.href || '',
        description: descEl?.textContent?.trim()?.slice(0, 500) || '',
        budget: budgetEl?.textContent?.trim() || '',
        postedTime: timeEl?.textContent?.trim() || '',
        client: clientEl?.textContent?.trim() || '',
        skills: Array.from(skillEls).map(s => s.textContent.trim()),
      };
    });
  });

  // Score and filter
  return jobs
    .filter(j => j.title)
    .map(j => ({ ...j, score: scoreJob(j) }))
    .filter(j => j.score >= 2)
    .sort((a, b) => b.score - a.score);
}
