/**
 * Outreach Scheduler Agent for ashbi-platform
 * Manages weekly outreach cycle: checks replies, generates follow-up drafts
 * 
 * Follow-up timing:
 * - Day 4 after last email → gentle bump
 * - Day 9 → value-add (sends cameronashley.ca/toronto-home-service-websites)
 * - Day 16 → breakup email
 * - Safe Electrical (id 15) gets special handling: pricing sent May 5, next bump May 9
 */

import { createDraft, searchInbox } from './gmail-draft.agent.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Maton API key from environment
const MATON_API_KEY = process.env.MATON_API_KEY;

// Follow-up configuration
const FOLLOW_UP_DAYS = {
  GENTLE_BUMP: 4,
  VALUE_ADD: 9,
  BREAKUP: 16
};

const VALUE_ADD_URL = 'cameronashley.ca/toronto-home-service-websites';

// Safe Electrical special handling
const SAFE_ELECTRICAL_ID = 15;
const SAFE_ELECTRICAL_PRICING_SENT = new Date('2025-05-05');
const SAFE_ELECTRICAL_NEXT_BUMP = new Date('2025-05-09');

/**
 * Calculate days since a given date
 * @param {Date} date - The date to calculate from
 * @returns {number} Days elapsed
 */
function daysSince(date) {
  if (!date) return Infinity;
  const now = new Date();
  const diffTime = now - new Date(date);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get sequence step based on days since last email
 * @param {number} days - Days since last email
 * @param {boolean} isSafeElectrical - Special handling flag
 * @returns {string|null} Sequence step name or null if no follow-up needed
 */
function getSequenceStep(days, isSafeElectrical) {
  if (isSafeElectrical) {
    // Safe Electrical special handling
    const today = new Date();
    if (today >= SAFE_ELECTRICAL_NEXT_BUMP) {
      return 'gentle_bump';
    }
    return null;
  }

  if (days >= FOLLOW_UP_DAYS.BREAKUP) return 'breakup';
  if (days >= FOLLOW_UP_DAYS.VALUE_ADD) return 'value_add';
  if (days >= FOLLOW_UP_DAYS.GENTLE_BUMP) return 'gentle_bump';
  return null;
}

/**
 * Generate email content based on sequence step
 * @param {string} step - Sequence step (gentle_bump, value_add, breakup)
 * @param {object} prospect - Prospect data
 * @returns {object} { subject, body }
 */
function generateEmailContent(step, prospect) {
  const { name, company, painPoint } = prospect;
  const firstName = name.split(' ')[0];

  const templates = {
    gentle_bump: {
      subject: `Re: ${company} - Quick follow-up`,
      body: `Hi ${firstName},

Hope you had a chance to review my previous email. Just wanted to check in briefly.

If timing isn't right now, let me know and I'll happily follow up in a few weeks.

Best,
Cameron`
    },
    value_add: {
      subject: `Re: ${company} - Resource for ${company}`,
      body: `Hi ${firstName},

I came across something that might be valuable for ${company}.

We recently published a guide on Toronto home service websites: ${VALUE_ADD_URL}

Happy to share more if relevant to your current needs.

Best,
Cameron`
    },
    breakup: {
      subject: `Re: ${company} - Final follow-up`,
      body: `Hi ${firstName},

I won't reach out again after this. But if you ever need help with ${painPoint || 'digital marketing'}, I'd love to help.

Feel free to reply if you'd like to continue the conversation.

Best,
Cameron`
    }
  };

  return templates[step] || null;
}

/**
 * Check inbox for replies from outreach leads
 * Searches for messages from leads in our database that have been replied to
 * @returns {Promise<object>} Replies found with lead details
 */
async function checkReplies() {
  try {
    // Get all active prospects
    const prospects = await prisma.coldEmailProspect.findMany({
      where: {
        status: { in: ['active', 'follow_up'] }
      },
      select: { email: true, name: true, company: true }
    });

    if (prospects.length === 0) {
      return { found: 0, replies: [] };
    }

    // Build search query for emails FROM our prospects
    const emailList = prospects.map(p => p.email).join(' OR ');
    const query = `from:(${emailList}) is:received`;
    
    const result = await searchInbox(query);
    const messages = result.messages || [];

    // Filter to actual replies (not our own sent emails)
    const replies = [];
    for (const msg of messages.slice(0, 50)) {
      const fullMessage = await fetch(
        `https://api.maton.ai/google-mail/gmail/v1/users/me/messages/${msg.id}`,
        {
          headers: { 'Authorization': `Bearer ${MATON_API_KEY}` }
        }
      ).then(r => r.json());

      // Check if this is a reply (has In-Reply-To or references headers)
      const headers = fullMessage.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      
      // Check if the subject starts with "Re:" which indicates a reply
      if (subject.startsWith('Re:') || subject.includes('Re:')) {
        const prospect = prospects.find(p => from.includes(p.email));
        if (prospect) {
          replies.push({
            messageId: msg.id,
            prospectEmail: prospect.email,
            prospectName: prospect.name,
            company: prospect.company,
            subject,
            snippet: fullMessage.snippet
          });
        }
      }
    }

    // Update status for leads who replied
    for (const reply of replies) {
      await prisma.coldEmailProspect.update({
        where: { email: reply.prospectEmail },
        data: { 
          status: 'replied',
          lastEmailedAt: new Date()
        }
      });
    }

    return {
      found: replies.length,
      replies,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error checking replies:', error);
    throw error;
  }
}

/**
 * Generate follow-up drafts for leads past their follow-up date
 * @returns {Promise<object>} Drafts created
 */
async function generateFollowUpDrafts() {
  try {
    const prospects = await prisma.coldEmailProspect.findMany({
      where: {
        status: { in: ['active', 'follow_up'] }
      }
    });

    const draftsCreated = [];

    for (const prospect of prospects) {
      const days = daysSince(prospect.lastEmailedAt || prospect.createdAt);
      const isSafeElectrical = prospect.id === SAFE_ELECTRICAL_ID;
      
      const step = getSequenceStep(days, isSafeElectrical);
      
      if (!step) continue;

      const content = generateEmailContent(step, prospect);
      if (!content) continue;

      try {
        const draft = await createDraft(prospect.email, content.subject, content.body);
        
        // Update prospect status to reflect next step
        await prisma.coldEmailProspect.update({
          where: { id: prospect.id },
          data: { 
            status: 'draft_sent',
            sequenceId: step
          }
        });

        draftsCreated.push({
          prospectId: prospect.id,
          prospectEmail: prospect.email,
          prospectName: prospect.name,
          company: prospect.company,
          step,
          draftId: draft.id || draft.draft?.id
        });
      } catch (draftError) {
        console.error(`Failed to create draft for ${prospect.email}:`, draftError);
      }
    }

    return {
      draftsCreated: draftsCreated.length,
      details: draftsCreated,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error generating follow-up drafts:', error);
    throw error;
  }
}

/**
 * Generate new prospect drafts using AI
 * For new trade categories not yet in the pipeline
 * @returns {Promise<object>} New drafts created
 */
async function generateNewProspectDrafts() {
  // This would integrate with AI to generate cold emails for new categories
  // For now, return placeholder - implement based on Pi's trade targeting
  return {
    draftsCreated: 0,
    message: 'New prospect generation not yet implemented - requires AI integration'
  };
}

/**
 * Run the full weekly outreach cycle
 * Orchestrates: check replies → generate follow-ups → update stats
 * @returns {Promise<object>} Cycle results
 */
async function runWeeklyCycle() {
  const startTime = new Date();
  
  try {
    console.log('Starting weekly outreach cycle...');

    // Step 1: Check for replies
    console.log('Checking for replies...');
    const repliesResult = await checkReplies();
    console.log(`Found ${repliesResult.found} replies`);

    // Step 2: Generate follow-up drafts
    console.log('Generating follow-up drafts...');
    const followUpsResult = await generateFollowUpDrafts();
    console.log(`Created ${followUpsResult.draftsCreated} follow-up drafts`);

    // Step 3: Generate new prospect drafts (AI-generated cold emails)
    console.log('Generating new prospect drafts...');
    const newProspectsResult = await generateNewProspectDrafts();

    const endTime = new Date();
    const durationSeconds = Math.round((endTime - startTime) / 1000);

    const result = {
      success: true,
      cycleId: `cycle_${Date.now()}`,
      startedAt: startTime.toISOString(),
      completedAt: endTime.toISOString(),
      durationSeconds,
      replies: repliesResult,
      followUps: followUpsResult,
      newProspects: newProspectsResult,
      summary: {
        totalRepliesFound: repliesResult.found,
        totalFollowUpsCreated: followUpsResult.draftsCreated,
        totalNewDraftsCreated: newProspectsResult.draftsCreated
      }
    };

    console.log(`Weekly cycle completed in ${durationSeconds}s`);
    return result;
  } catch (error) {
    console.error('Weekly cycle failed:', error);
    return {
      success: false,
      cycleId: `cycle_${Date.now()}`,
      startedAt: startTime.toISOString(),
      completedAt: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Get scheduler status and next scheduled run
 * @returns {Promise<object>} Status info
 */
async function getSchedulerStatus() {
  const prospectStats = await prisma.coldEmailProspect.groupBy({
    by: ['status'],
    _count: true
  });

  const statusCounts = {};
  prospectStats.forEach(s => {
    statusCounts[s.status] = s._count;
  });

  // Calculate next scheduled run (weekly = 7 days from last run)
  // For now, return next Monday as typical weekly schedule
  const now = new Date();
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  const nextRun = new Date(now);
  nextRun.setDate(now.getDate() + daysUntilMonday);
  nextRun.setHours(9, 0, 0, 0); // 9 AM

  return {
    status: 'active',
    nextScheduledRun: nextRun.toISOString(),
    schedule: 'weekly',
    prospectStats: statusCounts,
    followUpConfig: FOLLOW_UP_DAYS,
    valueAddUrl: VALUE_ADD_URL,
    safeElectrical: {
      id: SAFE_ELECTRICAL_ID,
      pricingSent: SAFE_ELECTRICAL_PRICING_SENT.toISOString(),
      nextBump: SAFE_ELECTRICAL_NEXT_BUMP.toISOString()
    }
  };
}

export {
  checkReplies,
  generateFollowUpDrafts,
  generateNewProspectDrafts,
  runWeeklyCycle,
  getSchedulerStatus
};