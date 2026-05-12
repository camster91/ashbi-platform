/**
 * Referral Engine Agent for ashbi-platform
 * Manages referral pipeline: network analysis, email generation, tracking, and rewards
 * 
 * Referral rewards: $250 gift card for clients who refer projects $5K-$15K
 * Reward paid after first payment received
 * 
 * Referral one-liner: "If you ever need a web developer, [Your Name] is fantastic — 
 * they built our site and it's been running great."
 */

import { createDraft } from './gmail-draft.agent.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Referral reward configuration
const REFERRAL_REWARD = {
  AMOUNT: 250,
  MIN_PROJECT_VALUE: 5000,
  MAX_PROJECT_VALUE: 15000,
  PAYMENT_CONDITION: 'paid after first payment received'
};

// AI Client import - uses ../ai/client.js
let aiClient = null;
try {
  const module = await import('../ai/client.js');
  aiClient = module.default || module;
} catch (err) {
  console.warn('AI client not found, using fallback generation');
  aiClient = null;
}

/**
 * Tier categorization for referral network
 */
const REFERRAL_TIERS = {
  TIER_1: 'tier_1', // Raving fans - highest likelihood to refer
  TIER_2: 'tier_2', // Satisfied clients - medium referral likelihood
  TIER_3: 'tier_3'  // Partners - refer when asked
};

/**
 * Sanitize an email header value to prevent header injection and RFC violations.
 * Removes control characters, newlines, and trims whitespace.
 * Encodes non-ASCII characters using RFC 2047 encoded-word syntax.
 * @param {string} value - The raw header value
 * @returns {string} Sanitized header value safe for RFC 2822
 */
function sanitizeEmailHeader(value) {
  if (typeof value !== 'string') return '';
  
  // Remove any control characters except tabs
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove any newlines (prevents header injection)
  sanitized = sanitized.replace(/\r?\n|\r/g, ' ');
  
  // Collapse multiple spaces
  sanitized = sanitized.replace(/[ \t]+/g, ' ').trim();
  
  // If there are non-ASCII characters, encode the whole value as RFC 2047
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(sanitized)) {
    // Encode using ISO-8859-1 or UTF-8 base64 encoded-word
    const buf = Buffer.from(sanitized, 'utf-8');
    sanitized = '=?UTF-8?B?' + buf.toString('base64') + '?=';
  }
  
  return sanitized;
}

/**
 * Get referral network - returns clients categorized by referral likelihood
 * Tier 1: Raving fans (5-star reviews, multiple past projects, engaged)
 * Tier 2: Satisfied clients (completed projects, no complaints)
 * Tier 3: Partners (vendors, collaborators who may refer business)
 * 
 * @returns {Promise<object>} Network categorized by tiers
 */
async function getReferralNetwork() {
  try {
    // Get all clients with their referral data
    const clients = await prisma.client.findMany({
      include: {
        referralsGiven: {
          select: { id: true, referredClientId: true, status: true }
        },
        referralsReceived: {
          select: { id: true, referrerClientId: true, status: true }
        },
        projects: {
          select: { id: true, status: true, value: true }
        }
      }
    });

    // Categorize clients into tiers based on referral likelihood factors
    const tiers = {
      tier_1: [], // Raving fans
      tier_2: [], // Satisfied clients
      tier_3: []  // Partners
    };

    for (const client of clients) {
      const referralLikelihood = calculateReferralLikelihood(client);
      
      const tierEntry = {
        id: client.id,
        name: client.name,
        email: client.email,
        company: client.company,
        referralLikelihood,
        totalProjects: client.projects.length,
        completedProjects: client.projects.filter(p => p.status === 'completed').length,
        referralsGiven: client.referralsGiven.length,
        referralsReceived: client.referralsReceived.length,
        lastProjectAt: getLastProjectDate(client.projects)
      };

      if (referralLikelihood >= 80) {
        tiers.tier_1.push(tierEntry);
      } else if (referralLikelihood >= 50) {
        tiers.tier_2.push(tierEntry);
      } else {
        tiers.tier_3.push(tierEntry);
      }
    }

    // Sort each tier by referral likelihood descending
    tiers.tier_1.sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    tiers.tier_2.sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    tiers.tier_3.sort((a, b) => b.referralLikelihood - a.referralLikelihood);

    return {
      tiers,
      summary: {
        tier_1_count: tiers.tier_1.length,
        tier_2_count: tiers.tier_2.length,
        tier_3_count: tiers.tier_3.length,
        total: clients.length
      },
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting referral network:', error);
    throw error;
  }
}

/**
 * Calculate referral likelihood score for a client (0-100)
 * Factors: project completion, referrals given/received, engagement
 * 
 * @param {object} client - Client data
 * @returns {number} Likelihood score 0-100
 */
function calculateReferralLikelihood(client) {
  let score = 0;
  
  // Base score from project completion (0-40 points)
  const completedProjects = client.projects.filter(p => p.status === 'completed').length;
  score += Math.min(completedProjects * 10, 40);
  
  // Referrals given (0-30 points)
  score += Math.min(client.referralsGiven.length * 10, 30);
  
  // Referrals received indicates network value (0-10 points)
  score += Math.min(client.referralsReceived.length * 5, 10);
  
  // Recent activity bonus (0-20 points)
  const lastProject = getLastProjectDate(client.projects);
  if (lastProject) {
    const daysSinceLastProject = Math.floor((Date.now() - new Date(lastProject)) / (1000 * 60 * 60 * 24));
    if (daysSinceLastProject <= 90) {
      score += 20;
    } else if (daysSinceLastProject <= 180) {
      score += 10;
    } else if (daysSinceLastProject <= 365) {
      score += 5;
    }
  }
  
  return Math.min(score, 100);
}

/**
 * Get the most recent project date from projects array
 * @param {Array} projects - Array of projects
 * @returns {Date|null} Last project date or null
 */
function getLastProjectDate(projects) {
  if (!projects || projects.length === 0) return null;
  const completed = projects
    .filter(p => p.completedAt)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  return completed.length > 0 ? completed[0].completedAt : null;
}

/**
 * Generate referral email using AI
 * Creates a personalized referral ask email
 * 
 * @param {string} contactName - Name of the contact to ask for referral
 * @param {string} company - Company name of the contact
 * @returns {Promise<object>} Generated email content { subject, body }
 */
async function generateReferralEmail(contactName, company) {
  try {
    const firstName = contactName.split(' ')[0];
    
    // Template system for referral emails
    const referralEmailTemplate = {
      subject: 'Quick favor — trusted web developer recommendation',
      body: `Hi ${firstName},

I hope you're doing well! I wanted to reach out with a quick ask.

I've been working with some great clients in the ${company} space, and a few have mentioned they occasionally get asked for recommendations for web developers.

If you ever find yourself in that position, I'd love to be in the conversation. Here's what I typically hear from people who refer me:

"If you ever need a web developer, ${contactName} is fantastic — they built our site and it's been running great."

Of course, I only take on projects where I can genuinely deliver results, so you'd never recommend me if it wasn't warranted.

The referral reward if someone moves forward: $250 (for projects $5K-$15K, paid after first payment).

No pressure at all — just wanted to put myself on your radar for when the need arises.

Thanks for considering it!

Best,
Cameron`
    };

    // Try to use AI client for enhanced personalization
    if (aiClient && aiClient.generateText) {
      try {
        const aiResponse = await aiClient.generateText({
          prompt: `Generate a referral request email for ${contactName} at ${company}. 
Use this one-liner style: "If you ever need a web developer, [Your Name] is fantastic — they built our site and it's been running great."
Include mention of $250 referral reward for $5K-$15K projects, paid after first payment. Keep it warm and natural, not pushy.`,
          maxTokens: 300,
          temperature: 0.7
        });
        
        if (aiResponse && aiResponse.text) {
          // Parse AI response for subject and body
          const lines = aiResponse.text.split('\n');
          const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
          const emptyIdx = lines.findIndex(l => l === '');
          const bodyLines = emptyIdx >= 0 ? lines.slice(emptyIdx + 1) : lines;
          
          return {
            subject: subjectLine ? subjectLine.replace(/^subject:\s*/i, '') : referralEmailTemplate.subject,
            body: bodyLines.join('\n') || referralEmailTemplate.body,
            generatedBy: 'ai',
            generatedAt: new Date().toISOString()
          };
        }
      } catch (aiError) {
        console.warn('AI generation failed, using template:', aiError.message);
      }
    }

    return {
      ...referralEmailTemplate,
      generatedBy: 'template',
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error generating referral email:', error);
    throw error;
  }
}

/**
 * Create a Gmail draft for a referral email
 * Uses gmail-draft.agent.js to create the draft
 * 
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body content
 * @returns {Promise<object>} Draft creation result
 */
async function createDraftForReferral(toEmail, subject, body) {
  try {
    if (!toEmail || !subject || !body) {
      throw new Error('Missing required parameters: toEmail, subject, body');
    }

    // Sanitize email header values to prevent injection and RFC violations
    const sanitizedSubject = sanitizeEmailHeader(subject);

    const draftResult = await createDraft(toEmail, sanitizedSubject, body);

    return {
      success: true,
      draftId: draftResult.id || draftResult.draft?.id,
      to: toEmail,
      subject: sanitizedSubject,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error creating referral draft:', error);
    throw error;
  }
}

/**
 * Track a referral in the database
 * Records the referral from referrer to referred lead
 * 
 * @param {string} referrerId - ID of the client making the referral
 * @param {object} referredLead - Details of the referred lead { name, email, company, projectValue }
 * @returns {Promise<object>} Created referral record
 */
async function trackReferral(referrerId, referredLead) {
  try {
    if (!referrerId || !referredLead) {
      throw new Error('Missing required parameters: referrerId, referredLead');
    }

    // Check if referrer exists
    const referrer = await prisma.client.findUnique({
      where: { id: parseInt(referrerId) }
    });

    if (!referrer) {
      throw new Error(`Referrer client not found with ID: ${referrerId}`);
    }

    // Check if referred client already exists (by email)
    let referredClient = await prisma.client.findUnique({
      where: { email: referredLead.email }
    });

    // If referred client doesn't exist, create them
    if (!referredClient) {
      referredClient = await prisma.client.create({
        data: {
          name: referredLead.name,
          email: referredLead.email,
          company: referredLead.company || '',
          status: 'referral_lead',
          referralCode: generateReferralCode()
        }
      });
    }

    // Create the referral record
    const referral = await prisma.referral.create({
      data: {
        referrerClientId: parseInt(referrerId),
        referredClientId: referredClient.id,
        status: 'referred',
        referredAt: new Date(),
        projectValue: referredLead.projectValue || null,
        rewardEligible: isRewardEligible(referredLead.projectValue),
        rewardPaid: false
      },
      include: {
        referrerClient: { select: { name: true, email: true, company: true } },
        referredClient: { select: { name: true, email: true, company: true } }
      }
    });

    return {
      success: true,
      referral: {
        id: referral.id,
        referrer: referral.referrerClient,
        referred: referral.referredClient,
        status: referral.status,
        rewardEligible: referral.rewardEligible,
        rewardAmount: referral.rewardEligible ? REFERRAL_REWARD.AMOUNT : 0,
        trackedAt: referral.referredAt
      }
    };
  } catch (error) {
    console.error('Error tracking referral:', error);
    throw error;
  }
}

/**
 * Check if a project value qualifies for referral reward
 * Project must be between $5K and $15K
 * 
 * @param {number} projectValue - Project value in dollars
 * @returns {boolean} Whether reward is eligible
 */
function isRewardEligible(projectValue) {
  if (!projectValue) return false;
  return projectValue >= REFERRAL_REWARD.MIN_PROJECT_VALUE && 
         projectValue <= REFERRAL_REWARD.MAX_PROJECT_VALUE;
}

/**
 * Generate a unique referral code for a client
 * @returns {string} Unique referral code
 */
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'REF-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Get top referrers by referral count
 * Returns clients sorted by number of successful referrals
 * 
 * @param {number} limit - Max number of referrers to return (default 10)
 * @returns {Promise<object>} Top referrers with stats
 */
async function getTopReferrers(limit = 10) {
  try {
    const topReferrers = await prisma.client.findMany({
      where: {
        referralsGiven: {
          some: {
            status: { in: ['referred', 'converted', 'paid'] }
          }
        }
      },
      include: {
        referralsGiven: {
          where: { status: { in: ['referred', 'converted', 'paid'] } },
          select: {
            id: true,
            status: true,
            referredAt: true,
            rewardEligible: true,
            rewardPaid: true,
            projectValue: true
          }
        },
        projects: {
          where: { status: 'completed' },
          select: { id: true, value: true }
        }
      },
      orderBy: {
        referralsGiven: {
          _count: 'desc'
        }
      },
      take: limit
    });

    // Calculate stats for each referrer
    const referrerStats = topReferrers.map(client => {
      const totalReferrals = client.referralsGiven.length;
      const convertedReferrals = client.referralsGiven.filter(r => 
        ['converted', 'paid'].includes(r.status)
      ).length;
      const rewardsEarned = client.referralsGiven.filter(r => r.rewardPaid).length;
      const totalProjectValue = client.projects.reduce((sum, p) => sum + (p.value || 0), 0);

      return {
        id: client.id,
        name: client.name,
        email: client.email,
        company: client.company,
        totalReferrals,
        convertedReferrals,
        conversionRate: totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : 0,
        rewardsEarned,
        totalProjectValue,
        lastReferralAt: client.referralsGiven.length > 0 
          ? client.referralsGiven.sort((a, b) => 
              new Date(b.referredAt) - new Date(a.referredAt)
            )[0].referredAt 
          : null,
        referralCode: client.referralCode
      };
    });

    // Sort by total referrals descending
    referrerStats.sort((a, b) => b.totalReferrals - a.totalReferrals);

    return {
      referrers: referrerStats,
      summary: {
        totalReferrers: referrerStats.length,
        totalReferralsAllTime: referrerStats.reduce((sum, r) => sum + r.totalReferrals, 0),
        totalConverted: referrerStats.reduce((sum, r) => sum + r.convertedReferrals, 0),
        totalRewardsPaid: referrerStats.reduce((sum, r) => sum + r.rewardsEarned, 0)
      },
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting top referrers:', error);
    throw error;
  }
}

/**
 * Import past clients as referral network contacts
 * Used to seed the referral network from CSV data
 * 
 * @param {Array} contacts - Array of { name, email, company } objects
 * @returns {Promise<object>} Import results
 */
async function importContacts(contacts) {
  try {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new Error('Contacts must be a non-empty array');
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: [],
      clients: []
    };

    for (const contact of contacts) {
      try {
        // Check if client already exists
        const existing = await prisma.client.findUnique({
          where: { email: contact.email }
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        // Create new client
        const client = await prisma.client.create({
          data: {
            name: contact.name,
            email: contact.email,
            company: contact.company || '',
            status: 'past_client',
            referralCode: generateReferralCode(),
            source: 'import'
          }
        });

        results.imported++;
        results.clients.push({
          id: client.id,
          name: client.name,
          email: client.email,
          company: client.company,
          referralCode: client.referralCode
        });
      } catch (contactError) {
        results.errors.push({
          contact: contact.email,
          error: contactError.message
        });
      }
    }

    return {
      success: true,
      ...results,
      importedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error importing contacts:', error);
    throw error;
  }
}

export {
  getReferralNetwork,
  generateReferralEmail,
  createDraftForReferral,
  trackReferral,
  getTopReferrers,
  importContacts,
  REFERRAL_TIERS,
  REFERRAL_REWARD,
  sanitizeEmailHeader
};
