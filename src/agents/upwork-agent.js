/**
 * Upwork Agent for ashbi-platform
 * Handles Upwork profile optimization, job search, and proposal generation
 * 
 * Cam's differentiator: "end-to-end (branding + packaging + Shopify in one)"
 * Specializations: branding, graphic design, packaging design, Shopify websites
 */

import { createDraft } from './gmail-draft.agent.js';

// AI Client import - uses ../ai/client.js
let aiClient = null;
try {
  const module = await import('../ai/client.js');
  aiClient = module.default;
} catch (err) {
  console.warn('AI client not found, using fallback generation');
  aiClient = null;
}

// Profile rewrite content from /Users/biancabienaime/upwork-profile-rewrite.md
const PROFILE_CONTENT = {
  headline: 'Brand Designer + Shopify Developer for DTC Brands',
  overview: `Your brand is only as strong as the connection between what it looks like
and what it sells.

I'm Cam — a designer and developer who builds brand-to-store pipelines for
consumer goods brands launching on Shopify. I handle everything from logo
and packaging design through to a fully functioning DTC storefront, so you
work with one person instead of managing a dozen freelancers.

Whether you're a supplement brand ready to scale, a skincare line hitting
retail, or a CPG startup building from zero — I make sure your brand looks
credible, your packaging pops on shelf, and your Shopify site converts
traffic into orders.

I also work with local professional businesses (law firms, agencies,
consultants) who need a cohesive brand identity and a clean web presence
without the agency price tag.

If you want a designer who gets both the creative and the commercial side
of your business, let's talk.`,
  specializations: [
    'Brand Identity',
    'Graphic Design',
    'Packaging Design',
    'Shopify Development',
    'Logo Design',
    'Visual Design',
    'DTC Branding',
    'Web Design'
  ],
  earnedIt: [
    {
      title: 'Brand & Shopify Store Launch — supplement brand (2025)',
      description: 'Designed full brand identity (logo, color system, typography) and built a Shopify storefront from scratch. Launched with 18 SKUs, branded packaging, and a site optimized for DTC conversion. Client reported 200+ orders in the first 30 days post-launch.'
    },
    {
      title: 'Logo & Packaging Design — artisan food brand (2024)',
      description: 'Developed a premium brand identity and packaging system for a specialty food startup preparing for retail placement. Delivery included logo, label designs for 6 products, and a brand style guide the client still uses for all marketing materials.'
    },
    {
      title: 'Shopify Site Redesign — CPG skincare line (2024)',
      description: 'Redesigned an existing Shopify store to improve mobile conversion. Restructured product pages, implemented a new brand theme, and added trust signals (reviews, guarantees). Organic conversion rate increased 45% within 60 days.'
    },
    {
      title: 'Brand Identity — local law firm (2023)',
      description: 'Delivered a complete rebrand for a boutique law practice: logo, business cards, letterhead, and a mobile-optimized website. The firm reported a noticeable increase in inquiries from new clients within the first month of launching the new brand.'
    }
  ],
  proposalDifferentiator: 'One designer, full brand-to-store pipeline — fewer handoffs, faster execution.',
  proposalTalkingPoints: [
    'I design the brand and build the store, so your packaging and website feel like they came from the same team.',
    'Experience working with CPG and DTC brands — I understand the difference between a portfolio piece and a product that has to move off a shelf.'
  ]
};

// Upwork job search filters for Cam's ICP
const JOB_CATEGORIES = {
  BRANDING: 'branding',
  PACKAGING: 'packaging design',
  SHOPIFY: 'Shopify',
  DTC: 'DTC',
  CPG: 'CPG'
};

/**
 * Optimize Upwork profile - returns full profile rewrite
 * Headline, overview, specialization tags, and earned it entries
 * 
 * @returns {object} Complete profile rewrite
 */
async function optimizeProfile() {
  return {
    success: true,
    profile: {
      headline: PROFILE_CONTENT.headline,
      overview: PROFILE_CONTENT.overview,
      specializations: PROFILE_CONTENT.specializations,
      earnedIt: PROFILE_CONTENT.earnedIt
    },
    meta: {
      source: '/Users/biancabienaime/upwork-profile-rewrite.md',
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Search Upwork for jobs matching Cam's ICP
 * Filters: branding, packaging design, Shopify, DTC brands, CPG
 * 
 * @param {object} filters - Search filters
 * @param {string} filters.category - Job category (branding, packaging, shopify, dtc, cpg)
 * @param {number} filters.budgetMin - Minimum budget
 * @param {number} filters.budgetMax - Maximum budget
 * @param {string} filters.clientVerified - Only verified clients ('true'/'false')
 * @param {number} filters.limit - Max results (default 20)
 * @returns {Promise<object>} Search results
 */
async function searchJobs(filters = {}) {
  try {
    const {
      category,
      budgetMin,
      budgetMax,
      clientVerified,
      limit = 20
    } = filters;

    // Build search query based on filters
    const queryParts = [];
    
    // Core specializations
    if (category === 'branding' || !category) {
      queryParts.push('branding');
    }
    if (category === 'packaging' || !category) {
      queryParts.push('packaging design');
    }
    if (category === 'shopify' || !category) {
      queryParts.push('Shopify');
    }
    
    // Add DTC/CPG focus if specified
    if (category === 'dtc') {
      queryParts.push('DTC brand');
    }
    if (category === 'cpg') {
      queryParts.push('CPG startup');
    }

    // Build final query
    const searchQuery = queryParts.length > 0 
      ? queryParts.join(' OR ') 
      : 'branding packaging Shopify';

    // For now, return mock data structure that matches Upwork API response
    // When Upwork API is available, use:
    // const response = await fetch(`https://api.upwork.com/v2/jobs/search?q=${encodeURIComponent(searchQuery)}`, {...});

    // Return mock results matching the expected structure
    const mockJobs = generateMockJobs(searchQuery, {
      budgetMin,
      budgetMax,
      clientVerified,
      limit
    });

    return {
      success: true,
      query: searchQuery,
      filters: {
        category,
        budgetMin,
        budgetMax,
        clientVerified,
        limit
      },
      total: mockJobs.length,
      jobs: mockJobs,
      searchedAt: new Date().toISOString(),
      note: 'Using mock data - integrate with Upwork API for live results'
    };
  } catch (error) {
    console.error('Error searching Upwork jobs:', error);
    throw error;
  }
}

/**
 * Generate mock jobs for development/testing
 * @param {string} query - Search query
 * @param {object} filters - Filters to apply
 * @returns {Array} Mock job objects
 */
function generateMockJobs(query, filters) {
  const mockJobs = [
    {
      id: 'upwork-job-001',
      title: 'Brand Identity for Supplement Startup',
      client: 'HealthFirst Labs',
      budget: 2500,
      verified: true,
      description: 'Looking for an experienced brand designer to create a complete brand identity for our new supplement line launching on Shopify. Need logo, color palette, typography, and packaging design direction.',
      postedAt: new Date(Date.now() - 86400000).toISOString(),
      proposals: 12,
      skills: ['Branding', 'Logo Design', 'Packaging Design', 'Shopify']
    },
    {
      id: 'upwork-job-002',
      title: 'Shopify Store for CPG Beauty Brand',
      client: 'GlowUp Cosmetics',
      budget: 5000,
      verified: true,
      description: 'Need a Shopify developer with branding experience to build our DTC store. We have brand guidelines ready, need someone who can build the store that matches our brand aesthetic.',
      postedAt: new Date(Date.now() - 172800000).toISOString(),
      proposals: 8,
      skills: ['Shopify', 'Web Design', 'DTC', 'CPG']
    },
    {
      id: 'upwork-job-003',
      title: 'Packaging Design for Artisan Food Brand',
      client: 'Rustic Kitchen Co',
      budget: 1500,
      verified: false,
      description: 'Design packaging for our new line of artisan sauces. Need label designs that work for retail shelf presence while conveying premium quality.',
      postedAt: new Date(Date.now() - 259200000).toISOString(),
      proposals: 23,
      skills: ['Packaging Design', 'Graphic Design', 'Label Design']
    },
    {
      id: 'upwork-job-004',
      title: 'Full Brand Refresh for DTC Skincare',
      client: 'PureRadiance',
      budget: 4500,
      verified: true,
      description: 'Our skincare brand needs a complete visual refresh. Looking for someone who can handle branding, packaging, and Shopify store design — one point of contact.',
      postedAt: new Date(Date.now() - 345600000).toISOString(),
      proposals: 15,
      skills: ['Branding', 'Packaging Design', 'Shopify', 'DTC']
    },
    {
      id: 'upwork-job-005',
      title: 'Shopify Website Redesign for CPG Brand',
      client: 'Nomad Provisions',
      budget: 3000,
      verified: true,
      description: 'Current Shopify store needs conversion optimization and visual refresh. Brand guidelines exist but need implementation across the store.',
      postedAt: new Date(Date.now() - 432000000).toISOString(),
      proposals: 19,
      skills: ['Shopify', 'Web Design', 'Conversion Optimization']
    }
  ];

  // Apply filters
  let filtered = mockJobs;

  if (filters.budgetMin) {
    filtered = filtered.filter(j => j.budget >= filters.budgetMin);
  }
  if (filters.budgetMax) {
    filtered = filtered.filter(j => j.budget <= filters.budgetMax);
  }
  if (filters.clientVerified === 'true') {
    filtered = filtered.filter(j => j.verified);
  }

  return filtered.slice(0, filters.limit || 20);
}

/**
 * Generate personalized proposal for an Upwork job
 * Uses Cam's differentiator: "end-to-end (branding + packaging + Shopify in one)"
 * 
 * @param {string} jobId - Upwork job ID
 * @param {string} jobTitle - Job title
 * @param {number} clientBudget - Client's budget
 * @param {string} jobDescription - Full job description
 * @returns {Promise<object>} Generated proposal
 */
async function generateProposal(jobId, jobTitle, clientBudget, jobDescription) {
  try {
    const differentiator = PROFILE_CONTENT.proposalDifferentiator;
    const talkingPoints = PROFILE_CONTENT.proposalTalkingPoints;

    // Build prompt for AI
    const proposalPrompt = `Generate a personalized Upwork proposal for the following job:

JOB: ${jobTitle}
BUDGET: $${clientBudget}
DESCRIPTION: ${jobDescription}

My differentiator: "${differentiator}"

Talking points to include:
- ${talkingPoints[0]}
- ${talkingPoints[1]}

My experience:
- Full brand-to-store pipeline for DTC brands
- Branding, packaging design, and Shopify development
- Worked with supplement, skincare, food, and CPG brands
- Results-focused portfolio (200+ orders first month, 45% conversion increase)

Generate a professional, personalized proposal that:
1. Opens with specific reference to their needs
2. Explains how I solve their specific problem differently
3. Mentions relevant experience with similar brands
4. Ends with clear next step

Keep it under 300 words. Be confident but not arrogant.`;

    let proposalText = null;
    let generatedBy = 'template';

    // Try AI generation if available
    if (aiClient && aiClient.generateText) {
      try {
        const aiResponse = await aiClient.generateText({
          prompt: proposalPrompt,
          maxTokens: 500,
          temperature: 0.7
        });

        if (aiResponse && aiResponse.text) {
          proposalText = aiResponse.text;
          generatedBy = 'ai';
        }
      } catch (aiError) {
        console.warn('AI proposal generation failed, using template:', aiError.message);
      }
    }

    // Fallback template-based proposal
    if (!proposalText) {
      proposalText = generateTemplateProposal(jobTitle, clientBudget, jobDescription);
    }

    return {
      success: true,
      proposal: {
        jobId,
        jobTitle,
        clientBudget,
        coverLetter: proposalText,
        differentiator,
        talkingPoints,
        generatedBy,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Error generating proposal:', error);
    throw error;
  }
}

/**
 * Generate a template-based proposal when AI is unavailable
 * @param {string} jobTitle - Job title
 * @param {number} clientBudget - Client budget
 * @param {string} jobDescription - Job description
 * @returns {string} Proposal text
 */
function generateTemplateProposal(jobTitle, clientBudget, jobDescription) {
  const differentiator = PROFILE_CONTENT.proposalDifferentiator;
  
  // Extract key needs from description
  const needs = extractKeyNeeds(jobDescription);
  
  return `Hi,

I noticed you're looking for help with ${needs.primary}. As someone who specializes in end-to-end brand-to-store development for DTC brands, I think this could be a great fit.

${differentiator}

I've worked with brands in the ${needs.category || 'CPG/DTC'} space, and I understand the challenge of making your brand look credible both on shelf and online. My recent projects include [relevant example based on their specific needs].

For your project at $${clientBudget}, I'm confident I can deliver ${needs.deliverable} that aligns with your brand goals.

I'd love to jump on a quick call to learn more about your timeline and vision.

Best,
Cameron`;
}

/**
 * Extract key needs from job description
 * @param {string} description - Job description
 * @returns {object} Extracted needs
 */
function extractKeyNeeds(description) {
  const desc = description.toLowerCase();
  
  const needs = {
    primary: 'branding and Shopify development',
    category: 'CPG/DTC',
    deliverable: 'a complete brand identity and Shopify store'
  };

  if (desc.includes('shopify') || desc.includes('store') || desc.includes('website')) {
    needs.primary = 'Shopify store development';
    needs.deliverable = 'a conversion-optimized Shopify store';
  }
  if (desc.includes('packaging') || desc.includes('label')) {
    needs.primary = 'packaging design';
    needs.deliverable = 'shelf-ready packaging that pops';
  }
  if (desc.includes('brand identity') || desc.includes('rebrand')) {
    needs.primary = 'brand identity';
    needs.deliverable = 'a cohesive brand system';
  }
  if (desc.includes('supplement')) {
    needs.category = 'supplement/health';
  } else if (desc.includes('skincare') || desc.includes('beauty')) {
    needs.category = 'skincare/beauty';
  } else if (desc.includes('food') || desc.includes('cpg')) {
    needs.category = 'food/CPG';
  }

  return needs;
}

/**
 * Create a Gmail draft for proposal review
 * Creates draft in Gmail for Cam to review before submitting on Upwork
 * 
 * @param {string} jobId - Upwork job ID
 * @param {string} proposalText - Full proposal text
 * @param {object} options - Additional options { jobTitle, clientBudget }
 * @returns {Promise<object>} Draft creation result
 */
async function createProposalDraft(jobId, proposalText, options = {}) {
  try {
    const { jobTitle, clientBudget } = options;
    
    // Build email content for draft review
    const subject = jobTitle 
      ? `Upwork Proposal: ${jobTitle}` 
      : `Upwork Proposal for Job ${jobId}`;
    
    const body = `
UPWORK PROPOSAL DRAFT
=======================

Job ID: ${jobId}
${jobTitle ? `Job Title: ${jobTitle}` : ''}
${clientBudget ? `Budget: $${clientBudget}` : ''}

---

COVER LETTER:
${proposalText}

---

STATUS: Draft for review before submitting on Upwork
Created: ${new Date().toISOString()}
    `.trim();

    // Use gmail-draft.agent to create the draft
    // Note: In production, you'd use a dedicated Upwork-submission email
    // For now, we create a draft in Gmail for review
    const draftResult = await createDraft(
      'cameron@ashbi.io', // Draft to self for review
      subject,
      body
    );

    return {
      success: true,
      draft: {
        id: draftResult.id || draftResult.draft?.id,
        jobId,
        jobTitle,
        clientBudget,
        subject,
        createdAt: new Date().toISOString()
      },
      note: 'Draft created in Gmail for review. Submit on Upwork after approval.'
    };
  } catch (error) {
    console.error('Error creating proposal draft:', error);
    throw error;
  }
}

/**
 * Get job alert configurations
 * Returns saved job alert settings for Upwork notifications
 * 
 * @returns {object} Job alert configurations
 */
function getJobAlerts() {
  return {
    success: true,
    alerts: [
      {
        id: 'alert-001',
        name: 'DTC Branding Jobs',
        query: 'branding AND (DTC OR "direct to consumer")',
        categories: ['Branding', 'Shopify'],
        budgetMin: 2000,
        active: true
      },
      {
        id: 'alert-002',
        name: 'Packaging Design Jobs',
        query: 'packaging design AND (CPG OR food OR supplement)',
        categories: ['Packaging Design'],
        budgetMin: 1000,
        active: true
      },
      {
        id: 'alert-003',
        name: 'Shopify Development',
        query: 'Shopify AND (DTC OR brand)',
        categories: ['Shopify Development'],
        budgetMin: 2500,
        active: true
      }
    ],
    configuredAt: new Date().toISOString()
  };
}

export {
  optimizeProfile,
  searchJobs,
  generateProposal,
  createProposalDraft,
  getJobAlerts,
  PROFILE_CONTENT
};