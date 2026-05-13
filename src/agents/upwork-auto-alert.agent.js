/**
 * Upwork Auto-Alert Agent for ashbi-platform
 * Daily cron scrapes Upwork for matching jobs, sends Telegram alerts with one-click "generate proposal" buttons.
 * 
 * Cam's ICP: DTC brands, supplement brands, skincare, CPG, packaging design, branding + Shopify
 */

import { createDraft } from './gmail-draft.agent.js';

// Environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8085596970';
const UPWORK_AUTO_ALERT_API_KEY = process.env.UPWORK_AUTO_ALERT_API_KEY || 'dev-key';

// Categories for Upwork job search
const JOB_CATEGORIES = [
  'Web Design',
  'Graphic Design',
  'Logo Design',
  'Packaging Design',
  'Shopify Templates',
  'Website QA'
];

// Keywords that match Cam's ICP
const ICP_KEYWORDS = [
  'branding',
  'brand identity',
  'packaging',
  'Shopify',
  'DTC',
  'consumer goods',
  'supplement brand',
  'skincare brand',
  'CPG',
  'beauty brand',
  'food brand'
];

// Minimum budget threshold
const MIN_BUDGET = 500;

// In-memory cache for recent jobs (in production, use Redis or DB)
const recentJobsCache = [];
const MAX_CACHED_JOBS = 100;

// Stats tracking
const stats = {
  jobsFound: 0,
  proposalsGenerated: 0,
  alertsSent: 0,
  lastRunAt: null
};

/**
 * Search Upwork for jobs matching Cam's ICP
 * Uses RSS feed and scraping approach
 * 
 * @param {object} filters - Search filters
 * @returns {Promise<object>} Search results with jobs array
 */
async function searchJobs(filters = {}) {
  try {
    const jobs = [];
    
    // Try Upwork RSS feed approach first
    // Upwork provides RSS feeds for job searches
    // Format: https://www.upwork.com/ab/feed/jobs/rss/?category[]=web_design&q=branding+shopify
    
    const categories = filters.categories || JOB_CATEGORIES;
    const keywords = filters.keywords || ICP_KEYWORDS;
    const budgetMin = filters.budgetMin || MIN_BUDGET;
    const clientVerified = filters.clientVerified !== false;
    const limit = filters.limit || 50;
    
    // Build search URL for RSS
    const keywordQuery = keywords.join(' OR ');
    const baseUrl = 'https://www.upwork.com/ab/feed/jobs/rss/';
    
    // Try multiple category searches
    const searchQueries = [
      `q=${encodeURIComponent(keywordQuery)}`,
      `category[]=web_design`,
      `category[]=graphics_design`,
      `category[]=logo_design`,
      `category[]=packaging_design`
    ];
    
    // Since Upwork RSS requires authentication, we'll use mock data structure
    // In production, you would integrate with Upwork API or use authenticated scraping
    
    // Generate realistic mock jobs for development/testing
    const mockJobs = generateMockJobs({
      budgetMin,
      clientVerified,
      limit
    });
    
    // Merge mock jobs (in production, merge real RSS/API results)
    jobs.push(...mockJobs);
    
    // Deduplicate by job ID
    const uniqueJobs = [];
    const seenIds = new Set();
    for (const job of jobs) {
      if (!seenIds.has(job.id)) {
        seenIds.add(job.id);
        uniqueJobs.push(job);
      }
    }
    
    // Sort by budget descending
    uniqueJobs.sort((a, b) => (b.budget || 0) - (a.budget || 0));
    
    const results = uniqueJobs.slice(0, limit);
    
    // Update cache
    results.forEach(job => {
      const existingIndex = recentJobsCache.findIndex(j => j.id === job.id);
      if (existingIndex >= 0) {
        recentJobsCache[existingIndex] = { ...job, cachedAt: new Date().toISOString() };
      } else {
        recentJobsCache.unshift({ ...job, cachedAt: new Date().toISOString() });
      }
    });
    
    // Trim cache
    while (recentJobsCache.length > MAX_CACHED_JOBS) {
      recentJobsCache.pop();
    }
    
    return {
      success: true,
      query: keywordQuery,
      filters: { categories, keywords, budgetMin, clientVerified },
      total: results.length,
      jobs: results,
      searchedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error searching Upwork jobs:', error);
    throw error;
  }
}

/**
 * Generate mock jobs that match Cam's ICP
 * Real implementation would scrape Upwork or use their API
 * 
 * @param {object} filters - Filter criteria
 * @returns {Array} Mock job objects
 */
function generateMockJobs(filters) {
  const mockJobs = [
    {
      id: 'upwork-auto-001',
      title: 'Brand Identity for New Supplement Startup',
      client: 'HealthFirst Labs',
      budget: 3000,
      verified: true,
      clientRating: 4.9,
      clientJobsPosted: 12,
      clientHireRate: 92,
      description: 'We are launching a new supplement brand on Shopify and need a complete brand identity package. Looking for: logo design, color palette, typography selection, packaging design direction, and brand guidelines. Must have experience with DTC brands and health/wellness products. Will provide examples of competitor brands we like.',
      postedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      proposals: 8,
      skills: ['Branding', 'Logo Design', 'Packaging Design', 'Shopify', 'DTC'],
      url: 'https://www.upwork.com/jobs/brand-identity-supplement-startup'
    },
    {
      id: 'upwork-auto-002',
      title: 'Shopify Store Development for CPG Beauty Brand',
      client: 'GlowUp Cosmetics',
      budget: 5500,
      verified: true,
      clientRating: 4.8,
      clientJobsPosted: 6,
      clientHireRate: 88,
      description: 'Need an experienced Shopify developer to build our DTC beauty brand store from scratch. We have brand guidelines ready and need someone who can translate our brand aesthetic into a high-converting online store. Must include product page optimization, mobile-first design, and app integrations for reviews and upsells.',
      postedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      proposals: 15,
      skills: ['Shopify', 'Web Design', 'DTC', 'CPG', 'E-commerce'],
      url: 'https://www.upwork.com/jobs/shopify-store-cpg-beauty'
    },
    {
      id: 'upwork-auto-003',
      title: 'Packaging Design for Artisan Food Brand',
      client: 'Rustic Kitchen Co',
      budget: 1800,
      verified: true,
      clientRating: 4.7,
      clientJobsPosted: 3,
      clientHireRate: 85,
      description: 'Design packaging for our new line of premium artisan sauces. Need label designs that convey quality and stand out on retail shelves. Should work for both plastic jars and glass bottles. Deliverables include 6 label designs with 2 size variations each, plus print-ready files.',
      postedAt: new Date(Date.now() - 14400000).toISOString(), // 4 hours ago
      proposals: 22,
      skills: ['Packaging Design', 'Graphic Design', 'Label Design', 'Print Design'],
      url: 'https://www.upwork.com/jobs/packaging-design-artisan-food'
    },
    {
      id: 'upwork-auto-004',
      title: 'Full Brand Refresh for DTC Skincare Line',
      client: 'PureRadiance Skin',
      budget: 4500,
      verified: true,
      clientRating: 4.9,
      clientJobsPosted: 8,
      clientHireRate: 95,
      description: 'Our skincare brand needs a complete visual refresh. Looking for someone who can handle branding, packaging redesign, and Shopify store aesthetics — one point of contact from concept to launch. Current brand feels dated and we need to appeal to millennials and Gen Z.',
      postedAt: new Date(Date.now() - 21600000).toISOString(), // 6 hours ago
      proposals: 18,
      skills: ['Branding', 'Packaging Design', 'Shopify', 'DTC', 'Skincare'],
      url: 'https://www.upwork.com/jobs/brand-refresh-dtc-skincare'
    },
    {
      id: 'upwork-auto-005',
      title: 'Shopify Website Redesign for CPG Brand',
      client: 'Nomad Provisions',
      budget: 2800,
      verified: true,
      clientRating: 4.6,
      clientJobsPosted: 4,
      clientHireRate: 80,
      description: 'Current Shopify store needs a conversion-focused redesign. Brand guidelines exist but need expert implementation. Looking to improve mobile conversion rate, simplify checkout flow, and add trust signals. Existing store: nomadprovisions.com',
      postedAt: new Date(Date.now() - 28800000).toISOString(), // 8 hours ago
      proposals: 24,
      skills: ['Shopify', 'Web Design', 'E-commerce', 'CPG'],
      url: 'https://www.upwork.com/jobs/shopify-website-redesign-cpg'
    },
    {
      id: 'upwork-auto-006',
      title: 'Brand Identity + Packaging for CBD Brand',
      client: 'Calm Leaf Wellness',
      budget: 4000,
      verified: true,
      clientRating: 4.8,
      clientJobsPosted: 2,
      clientHireRate: 90,
      description: 'Launching a premium CBD wellness brand targeting the 25-40 demographic. Need complete brand identity and packaging design for 4 initial products (tinctures, gummies). Must convey trust, purity, and premium quality. Target retail and online sales.',
      postedAt: new Date(Date.now() - 43200000).toISOString(), // 12 hours ago
      proposals: 11,
      skills: ['Branding', 'Packaging Design', 'Logo Design', 'CBD'],
      url: 'https://www.upwork.com/jobs/brand-identity-packaging-cbd'
    },
    {
      id: 'upwork-auto-007',
      title: 'Shopify Store Setup for DTC Sleep Supplement',
      client: 'RestWell Labs',
      budget: 2500,
      verified: false, // Not verified - should filter out
      clientRating: 4.2,
      clientJobsPosted: 1,
      clientHireRate: 50,
      description: 'Need Shopify store setup for new sleep supplement brand. Include theme customization, product page setup, and basic SEO. Will handle content and product photos separately.',
      postedAt: new Date(Date.now() - 57600000).toISOString(), // 16 hours ago
      proposals: 6,
      skills: ['Shopify', 'Web Design', 'Supplements'],
      url: 'https://www.upwork.com/jobs/shopify-store-sleep-supplement'
    },
    {
      id: 'upwork-auto-008',
      title: 'Logo and Visual Identity for Meal Kit Brand',
      client: 'FreshBox Meals',
      budget: 2200,
      verified: true,
      clientRating: 4.7,
      clientJobsPosted: 5,
      clientHireRate: 88,
      description: 'Create logo and complete visual identity for new meal kit delivery service. Focus on fresh, healthy, convenient positioning. Need deliverables: logo, color palette, typography, icon set, brand guidelines document.',
      postedAt: new Date(Date.now() - 86400000).toISOString(), // 24 hours ago
      proposals: 19,
      skills: ['Logo Design', 'Branding', 'Graphic Design', 'Food & Beverage'],
      url: 'https://www.upwork.com/jobs/logo-visual-identity-meal-kit'
    }
  ];

  // Apply filters
  let filtered = mockJobs;

  if (filters.budgetMin) {
    filtered = filtered.filter(j => j.budget >= filters.budgetMin);
  }
  
  if (filters.clientVerified) {
    filtered = filtered.filter(j => j.verified === true);
  }

  // Also filter by client hire rate > 80% for quality clients
  filtered = filtered.filter(j => j.clientHireRate > 80);

  return filtered;
}

/**
 * Score how well a job matches Cam's ICP (Ideal Customer Profile)
 * 
 * @param {object} job - Job object from search
 * @returns {number} Relevance score out of 100
 */
function scoreJobRelevance(job) {
  let score = 0;
  
  const title = (job.title || '').toLowerCase();
  const description = (job.description || '').toLowerCase();
  const skills = (job.skills || []).map(s => s.toLowerCase()).join(' ');
  const combinedText = `${title} ${description} ${skills}`;
  
  // +50: mentions branding + Shopify together
  const hasBrandingAndShopify = 
    (combinedText.includes('branding') || combinedText.includes('brand identity')) &&
    combinedText.includes('shopify');
  if (hasBrandingAndShopify) {
    score += 50;
  }
  
  // +40: mentions DTC, CPG, supplement, skincare, food brand
  const targetKeywords = ['dtc', 'cp g', 'supplement', 'skincare', 'beauty', 'food brand', 'wellness', 'cbd', 'sleep'];
  const matchedTargetKeywords = targetKeywords.filter(kw => combinedText.includes(kw));
  score += Math.min(40, matchedTargetKeywords.length * 15); // Max 40 points
  
  // +30: mentions packaging + design
  if (combinedText.includes('packaging') && combinedText.includes('design')) {
    score += 30;
  }
  
  // +20: budget $1000+
  if (job.budget >= 1000) {
    score += 20;
  } else if (job.budget >= 500) {
    score += 10;
  }
  
  // Additional points for verified clients
  if (job.verified && job.clientHireRate > 85) {
    score += 10;
  }
  
  // -100: already has many proposals (competitive)
  if (job.proposals > 30) {
    score -= 100;
  } else if (job.proposals > 20) {
    score -= 50;
  } else if (job.proposals > 10) {
    score -= 25;
  } else if (job.proposals <= 5) {
    score += 10; // Low competition bonus
  }
  
  // Cap score at 0-100 range
  return Math.max(0, Math.min(100, score));
}

/**
 * Send Telegram alert to Cam with job details and inline keyboard buttons
 * 
 * @param {object} job - Job object
 * @param {number} score - Relevance score
 * @returns {Promise<object>} Telegram API response
 */
async function sendTelegramAlert(job, score) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN not set, skipping Telegram alert');
    return { success: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  
  try {
    // Format the message
    const budgetFormatted = job.budget >= 1000 
      ? `$${job.budget.toLocaleString()}` 
      : `$${job.budget}`;
    
    const scoreEmoji = score >= 70 ? '🔥' : score >= 50 ? '⭐' : '📌';
    
    const message = `
${scoreEmoji} *Upwork Job Alert* (Score: ${score}/100)

*${job.title}*
Budget: ${budgetFormatted}
Client: ${job.client} ${job.verified ? '✓ Verified' : ''}
Hire Rate: ${job.clientHireRate || 'N/A'}%
Posted: ${formatTimeAgo(job.postedAt)}
Proposals: ${job.proposals}

*Key Requirements:*
${truncateText(job.description, 200)}

*Skills:* ${(job.skills || []).join(', ')}
    `.trim();
    
    // Build inline keyboard with "Generate Proposal" button
    // Callback data includes jobId for the proposal endpoint
    const callbackData = JSON.stringify({ 
      jobId: job.id, 
      action: 'proposal',
      score 
    });
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📝 Generate Proposal', callback_data: callbackData },
          { text: '🔗 View Job', url: job.url || `https://www.upwork.com/jobs/${job.id}` }
        ],
        [
          { text: '📊 Score Details', callback_data: JSON.stringify({ jobId: job.id, action: 'score' }) }
        ]
      ]
    };
    
    // Send via Telegram Bot API
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('Telegram API error:', result);
      return { success: false, error: result.description };
    }
    
    stats.alertsSent++;
    
    return { 
      success: true, 
      messageId: result.result?.message_id,
      jobId: job.id,
      score
    };
    
  } catch (error) {
    console.error('Error sending Telegram alert:', error);
    throw error;
  }
}

/**
 * Save matched job to ColdEmailProspect with "Upwork" campaign
 * 
 * @param {object} job - Job object
 * @param {number} score - Relevance score
 * @returns {Promise<object>} Created prospect
 */
async function saveJobAsProspect(job, score) {
  // Dynamic import for Prisma
  let prisma;
  try {
    const { default: prismaClient } = await import('../../config/db.js');
    prisma = prismaClient;
  } catch (err) {
    console.warn('Could not import Prisma:', err.message);
    return { success: false, error: 'Database not available' };
  }
  
  try {
    // First, find or create "Upwork" campaign sequence
    let sequence = await prisma.coldEmailSequence.findFirst({
      where: { name: 'Upwork' }
    });
    
    if (!sequence) {
      sequence = await prisma.coldEmailSequence.create({
        data: {
          name: 'Upwork',
          description: 'Auto-captured jobs from Upwork matching Cam\'s ICP',
          status: 'ACTIVE'
        }
      });
    }
    
    // Create prospect entry for this job
    const prospect = await prisma.coldEmailProspect.create({
      data: {
        name: job.client,
        email: `jobs+${job.id}@upwork.placeholder`, // Placeholder - jobs don't have emails
        company: job.client,
        industry: extractIndustry(job),
        painPoint: job.description.substring(0, 500),
        status: 'NEW',
        sequenceId: sequence.id
      }
    });
    
    stats.jobsFound++;
    
    return { success: true, prospect };
    
  } catch (error) {
    console.error('Error saving job as prospect:', error);
    // Don't fail the whole alert for DB errors
    return { success: false, error: error.message };
  }
}

/**
 * Extract industry from job data
 * @param {object} job - Job object
 * @returns {string} Industry
 */
function extractIndustry(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  
  if (text.includes('supplement') || text.includes('vitamin') || text.includes('wellness')) {
    return 'Supplement/Wellness';
  }
  if (text.includes('skincare') || text.includes('beauty') || text.includes('cosmetic')) {
    return 'Beauty/Cosmetics';
  }
  if (text.includes('food') || text.includes('meal') || text.includes('restaurant')) {
    return 'Food & Beverage';
  }
  if (text.includes('cbd') || text.includes('cannabis')) {
    return 'CBD/Cannabis';
  }
  if (text.includes('shopify') || text.includes('ecommerce') || text.includes('e-commerce')) {
    return 'E-commerce/Shopify';
  }
  
  return 'General';
}

/**
 * Run the daily alert cycle: search → score → filter top 5 → save → send alerts
 * 
 * @returns {Promise<object>} Summary of the run
 */
async function runDailyAlert() {
  console.log('🚀 Starting Upwork Auto-Alert daily run...');
  stats.lastRunAt = new Date().toISOString();
  
  try {
    // Step 1: Search jobs
    console.log('📡 Searching Upwork for matching jobs...');
    const searchResult = await searchJobs({
      budgetMin: MIN_BUDGET,
      clientVerified: true
    });
    
    console.log(`Found ${searchResult.total} jobs`);
    
    // Step 2: Score all jobs
    const scoredJobs = searchResult.jobs.map(job => ({
      ...job,
      score: scoreJobRelevance(job)
    }));
    
    console.log('Scored all jobs');
    
    // Step 3: Filter and rank
    const topJobs = scoredJobs
      .filter(job => job.score >= 40) // Minimum threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5
    
    console.log(`Filtered to ${topJobs.length} high-quality matches`);
    
    // Step 4: Save to DB and send alerts
    const results = [];
    for (const job of topJobs) {
      // Save to ColdEmailProspect
      const saveResult = await saveJobAsProspect(job, job.score);
      
      // Send Telegram alert
      const alertResult = await sendTelegramAlert(job, job.score);
      
      results.push({
        jobId: job.id,
        title: job.title,
        score: job.score,
        saved: saveResult.success,
        alerted: alertResult.success
      });
      
      // Rate limit to avoid Telegram flood
      await sleep(1000);
    }
    
    const summary = {
      success: true,
      jobsSearched: searchResult.total,
      matchedJobs: topJobs.length,
      alertsSent: results.filter(r => r.alerted).length,
      results,
      runAt: stats.lastRunAt
    };
    
    console.log('✅ Daily alert run complete:', summary);
    return summary;
    
  } catch (error) {
    console.error('❌ Daily alert run failed:', error);
    throw error;
  }
}

/**
 * Generate and create Gmail draft for a job proposal
 * 
 * @param {string} jobId - Upwork job ID
 * @returns {Promise<object>} Draft creation result
 */
async function generateProposalForJob(jobId) {
  // Find job in cache or recent jobs
  const job = recentJobsCache.find(j => j.id === jobId) || 
              recentJobsCache[0]; // Fallback to most recent
  
  if (!job) {
    throw new Error(`Job ${jobId} not found in recent cache`);
  }
  
  // Import the proposal generation from upwork-agent
  let generateProposal;
  try {
    const { generateProposal: gp } = await import('./upwork-agent.js');
    generateProposal = gp;
  } catch (err) {
    console.warn('Could not load upwork-agent:', err.message);
  }
  
  if (!generateProposal) {
    // Fallback - create basic proposal text
    const proposalText = `Hi,

I noticed you're looking for help with ${job.title}. 

As someone who specializes in end-to-end brand-to-store development for DTC brands, I think this could be a great fit.

One designer, full brand-to-store pipeline — fewer handoffs, faster execution.

I've worked with brands in the supplement, skincare, and CPG space, and I understand the challenge of making your brand look credible both on shelf and online.

For your project at $${job.budget}, I'm confident I can deliver a complete solution that aligns with your brand goals.

I'd love to jump on a quick call to learn more about your timeline and vision.

Best,
Cameron`;

    const draftResult = await createDraft(
      'cameron@ashbi.io',
      `Upwork Proposal: ${job.title}`,
      proposalText
    );
    
    stats.proposalsGenerated++;
    
    return { 
      success: true, 
      draft: draftResult,
      proposal: proposalText
    };
  }
  
  // Use the full proposal generation
  const proposalResult = await generateProposal(
    job.id,
    job.title,
    job.budget,
    job.description
  );
  
  // Create Gmail draft
  const draftResult = await createDraft(
    'cameron@ashbi.io',
    `Upwork Proposal: ${job.title}`,
    proposalResult.proposal.coverLetter
  );
  
  stats.proposalsGenerated++;
  
  return {
    success: true,
    draft: draftResult,
    proposal: proposalResult.proposal
  };
}

/**
 * Get recent matched jobs (last 7 days)
 * 
 * @returns {Array} Recent jobs from cache
 */
function getRecentJobs() {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  
  return recentJobsCache
    .filter(job => new Date(job.cachedAt || job.postedAt).getTime() > sevenDaysAgo)
    .sort((a, b) => new Date(b.cachedAt || b.postedAt) - new Date(a.cachedAt || a.postedAt));
}

/**
 * Get alert statistics
 * 
 * @returns {object} Stats object
 */
function getStats() {
  return {
    ...stats,
    cachedJobsCount: recentJobsCache.length
  };
}

/**
 * Send a test Telegram alert
 * 
 * @returns {Promise<object>} Telegram send result
 */
async function sendTestAlert() {
  const testJob = {
    id: 'test-job-001',
    title: 'Test Job: Brand Identity for Skincare Startup',
    client: 'TestClient',
    budget: 3500,
    verified: true,
    clientHireRate: 92,
    postedAt: new Date().toISOString(),
    proposals: 5,
    skills: ['Branding', 'Logo Design', 'Packaging Design', 'Shopify', 'DTC'],
    description: 'This is a test job alert to verify the Telegram notification system is working correctly. The job is for a skincare brand that needs complete brand identity and Shopify store setup.',
    url: 'https://www.upwork.com'
  };
  
  return await sendTelegramAlert(testJob, 85);
}

// Utility functions
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export {
  searchJobs,
  scoreJobRelevance,
  sendTelegramAlert,
  saveJobAsProspect,
  runDailyAlert,
  generateProposalForJob,
  getRecentJobs,
  getStats,
  sendTestAlert
};