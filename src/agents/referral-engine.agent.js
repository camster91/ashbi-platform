/**
 * Referral Engine Agent for ashbi-platform
 * Manages referral pipeline: network analysis, email generation, tracking, and rewards
 *
 * Referral rewards: $250 gift card for clients who refer projects $5K-$15K
 * Reward paid after first payment received
 */

import { createDraft } from './gmail-draft.agent.js';
import prisma from '../config/db.js';

// Referral reward configuration
const REFERRAL_REWARD = {
  AMOUNT: 250,
  MIN_PROJECT_VALUE: 5000,
  MAX_PROJECT_VALUE: 15000,
  PAYMENT_CONDITION: 'paid after first payment received'
};

const REFERRAL_TIERS = {
  TIER_1: 'tier_1',
  TIER_2: 'tier_2',
  TIER_3: 'tier_3'
};

// AI Client import - uses ../ai/client.js
let aiClient = null;
try {
  const mod = await import('../ai/client.js');
  aiClient = mod.default || mod;
} catch (err) {
  console.warn('AI client not found, using fallback generation');
}

/**
 * Sanitize an email header value to prevent header injection and RFC violations.
 */
function sanitizeEmailHeader(value) {
  if (typeof value !== 'string') return '';
  
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  sanitized = sanitized.replace(/\r?\n|\r/g, ' ');
  sanitized = sanitized.replace(/[ \t]+/g, ' ').trim();
  
  if (/[^\x20-\x7E]/.test(sanitized)) {
    const buf = Buffer.from(sanitized, 'utf-8');
    sanitized = '=?UTF-8?B?' + buf.toString('base64') + '?=';
  }
  
  return sanitized;
}

/**
 * Get the primary email for a client from their email mappings
 */
function getPrimaryEmail(client) {
  if (!client.emailMappings || client.emailMappings.length === 0) return null;
  const primary = client.emailMappings.find(m => m.isPrimary);
  return primary ? primary.emailAddress : client.emailMappings[0].emailAddress;
}

/**
 * Get referral network - returns clients categorized by referral likelihood
 */
async function getReferralNetwork() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        emailMappings: {
          select: { emailAddress: true, contactName: true, isPrimary: true }
        },
        contacts: {
          select: { name: true, email: true }
        },
        projects: {
          select: { id: true, status: true, value: true, completedAt: true }
        }
      }
    });

    const tiers = {
      tier_1: [],
      tier_2: [],
      tier_3: []
    };

    for (const client of clients) {
      const referralLikelihood = calculateReferralLikelihood(client);
      const primaryEmail = getPrimaryEmail(client);

      const tierEntry = {
        id: client.id,
        name: client.name,
        email: primaryEmail,
        company: client.contactPerson || '',
        referralLikelihood,
        totalProjects: client.projects.length,
        completedProjects: client.projects.filter(p => p.status === 'completed').length,
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
 */
function calculateReferralLikelihood(client) {
  let score = 0;

  const completedProjects = client.projects.filter(p => p.status === 'completed').length;
  score += Math.min(completedProjects * 10, 40);

  const lastProject = getLastProjectDate(client.projects);
  if (lastProject) {
    const daysSince = Math.floor((Date.now() - new Date(lastProject)) / (1000 * 60 * 60 * 24));
    if (daysSince <= 90) score += 20;
    else if (daysSince <= 180) score += 10;
    else if (daysSince <= 365) score += 5;
  }

  const hasEmail = getPrimaryEmail(client) !== null;
  const hasContacts = client.contacts && client.contacts.length > 0;
  if (hasEmail && hasContacts) score += 20;
  else if (hasEmail || hasContacts) score += 10;

  if (client.relationshipStatus === 'ACTIVE') score += 20;
  else if (client.relationshipStatus === 'ARCHIVED') score += 5;

  return Math.min(score, 100);
}

/**
 * Get the most recent project date
 */
function getLastProjectDate(projects) {
  if (!projects || projects.length === 0) return null;
  const sorted = projects
    .filter(p => p.completedAt)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  return sorted.length > 0 ? sorted[0].completedAt : null;
}

/**
 * Generate referral email using AI or template
 */
async function generateReferralEmail(contactName, company) {
  try {
    const firstName = contactName.split(' ')[0];

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

    // Try AI for enhanced personalization
    if (aiClient) {
      try {
        const prompt = 'Generate a referral request email for ' + contactName + ' at ' + company + '. '
          + 'Use this one-liner style: "If you ever need a web developer, [Your Name] is fantastic — they built our site and its been running great." '
          + 'Include mention of $250 referral reward for $5K-$15K projects, paid after first payment. '
          + 'Return in format: Subject: <line> followed by blank line then body. Keep it warm and natural, not pushy.';

        const aiResponse = await aiClient.generate(prompt, {
          maxTokens: 300,
          temperature: 0.7
        });
        
        if (aiResponse && aiResponse.text) {
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
 */
async function createDraftForReferral(toEmail, subject, body) {
  try {
    if (!toEmail || !subject || !body) {
      throw new Error('Missing required parameters: toEmail, subject, body');
    }

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
 * Generate a unique referral code
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
 * Check if project qualifies for reward
 */
function isRewardEligible(projectValue) {
  if (!projectValue) return false;
  return projectValue >= REFERRAL_REWARD.MIN_PROJECT_VALUE
    && projectValue <= REFERRAL_REWARD.MAX_PROJECT_VALUE;
}

/**
 * Track a referral in the database
 */
async function trackReferral(referrerId, referredLead) {
  try {
    if (!referrerId || !referredLead) {
      throw new Error('Missing required parameters: referrerId, referredLead');
    }

    const referrer = await prisma.client.findUnique({
      where: { id: referrerId },
      include: {
        emailMappings: { select: { emailAddress: true, contactName: true, isPrimary: true } }
      }
    });

    if (!referrer) {
      throw new Error('Referrer client not found with ID: ' + referrerId);
    }

    const existingMapping = await prisma.clientEmailMapping.findFirst({
      where: { emailAddress: referredLead.email },
      include: { client: true }
    });

    let referredClientRecord;
    if (existingMapping) {
      referredClientRecord = existingMapping.client;
    } else {
      referredClientRecord = await prisma.client.create({
        data: {
          name: referredLead.name,
          contactPerson: referredLead.company || '',
          relationshipStatus: 'LEAD',
          referralCode: generateReferralCode(),
          emailMappings: {
            create: {
              emailAddress: referredLead.email,
              contactName: referredLead.name,
              isPrimary: true
            }
          }
        }
      });
    }

    const referral = await prisma.referral.create({
      data: {
        referrerClientId: referrerId,
        referredClientId: referredClientRecord.id,
        status: 'referred',
        referredAt: new Date(),
        projectValue: referredLead.projectValue || null,
        rewardEligible: isRewardEligible(referredLead.projectValue),
        rewardPaid: false
      },
      include: {
        referrerClient: {
          select: { id: true, name: true, contactPerson: true, emailMappings: { select: { emailAddress: true, isPrimary: true } } }
        },
        referredClient: {
          select: { id: true, name: true, contactPerson: true, emailMappings: { select: { emailAddress: true, isPrimary: true } } }
        }
      }
    });

    return {
      success: true,
      referral: {
        id: referral.id,
        referrer: { name: referral.referrerClient.name, email: getPrimaryEmail(referral.referrerClient) },
        referred: { name: referral.referredClient.name, email: getPrimaryEmail(referral.referredClient) },
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
 * Get top referrers by referral count
 */
async function getTopReferrers(limit = 10) {
  try {
    const topGroups = await prisma.referral.groupBy({
      by: ['referrerClientId'],
      where: {
        status: { in: ['referred', 'converted', 'paid'] }
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit
    });

    if (topGroups.length === 0) {
      return {
        referrers: [],
        summary: {
          totalReferrers: 0, totalReferralsAllTime: 0,
          totalConverted: 0, totalRewardsPaid: 0
        },
        generatedAt: new Date().toISOString()
      };
    }

    const referrerIds = topGroups.map(r => r.referrerClientId);
    const clients = await prisma.client.findMany({
      where: { id: { in: referrerIds } },
      include: {
        emailMappings: { select: { emailAddress: true, isPrimary: true } },
        projects: { where: { status: 'completed' }, select: { id: true, value: true } }
      }
    });

    const clientMap = new Map(clients.map(c => [c.id, c]));

    const referrerStats = await Promise.all(topGroups.map(async (group) => {
      const client = clientMap.get(group.referrerClientId);
      if (!client) return null;

      const referrals = await prisma.referral.findMany({
        where: { referrerClientId: group.referrerClientId },
        select: { id: true, status: true, referredAt: true, rewardEligible: true, rewardPaid: true, projectValue: true }
      });

      const totalReferrals = referrals.length;
      const convertedReferrals = referrals.filter(r => ['converted', 'paid'].includes(r.status)).length;
      const rewardsEarned = referrals.filter(r => r.rewardPaid).length;
      const totalProjectValue = client.projects.reduce((sum, p) => sum + (p.value || 0), 0);
      const lastReferral = referrals.sort((a, b) => new Date(b.referredAt) - new Date(a.referredAt))[0];

      return {
        id: client.id,
        name: client.name,
        email: getPrimaryEmail(client),
        company: client.contactPerson || '',
        totalReferrals,
        convertedReferrals,
        conversionRate: totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : 0,
        rewardsEarned,
        totalProjectValue,
        lastReferralAt: lastReferral?.referredAt || null,
        referralCode: client.referralCode
      };
    }));

    const validStats = referrerStats.filter(Boolean);

    return {
      referrers: validStats,
      summary: {
        totalReferrers: validStats.length,
        totalReferralsAllTime: validStats.reduce((s, r) => s + r.totalReferrals, 0),
        totalConverted: validStats.reduce((s, r) => s + r.convertedReferrals, 0),
        totalRewardsPaid: validStats.reduce((s, r) => s + r.rewardsEarned, 0)
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
        const existing = await prisma.clientEmailMapping.findFirst({
          where: { emailAddress: contact.email },
          include: { client: true }
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        const client = await prisma.client.create({
          data: {
            name: contact.name,
            contactPerson: contact.company || '',
            relationshipStatus: 'LEAD',
            referralCode: generateReferralCode(),
            emailMappings: {
              create: {
                emailAddress: contact.email,
                contactName: contact.name,
                isPrimary: true
              }
            }
          }
        });

        results.imported++;
        results.clients.push({
          id: client.id,
          name: client.name,
          email: contact.email,
          company: contact.company || '',
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