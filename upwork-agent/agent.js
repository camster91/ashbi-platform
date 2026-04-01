#!/usr/bin/env node
import 'dotenv/config';
import {
  readMessages,
  readMessageThread,
  scrapeJobFeed,
  scrapeProposals,
  scrapeHiring,
  ACTIVE_PROFILE,
  KEYWORDS_BY_PROFILE,
} from './upwork-claude.js';
import {
  getProjectId,
  syncOutboundLead,
  syncProposal,
  syncMessage,
  syncMessageThread,
  syncHiringJob,
  syncApplicant,
  syncContract,
} from './hub-sync.js';
import { notify } from './notify.js';

const command = process.argv[2] || 'all';

const KEYWORDS = KEYWORDS_BY_PROFILE[ACTIVE_PROFILE] || KEYWORDS_BY_PROFILE.cameron;

function scoreJob(job) {
  const text = `${job.title} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const kw of KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  if (job.budget) {
    const amt = parseFloat(job.budget.replace(/[^0-9.]/g, ''));
    if (amt >= 5000) score += 2;
    else if (amt >= 1000) score += 1;
  }
  return Math.min(score, 10);
}

async function runFeed(projectId) {
  console.log('Scraping Upwork job feed via Claude Code...');
  const rawJobs = await scrapeJobFeed();
  const jobs = rawJobs
    .filter(j => j.title)
    .map(j => ({ ...j, score: scoreJob(j) }))
    .filter(j => j.score >= 2)
    .sort((a, b) => b.score - a.score);

  console.log(`Found ${jobs.length} matching jobs (from ${rawJobs.length} total)`);

  for (const job of jobs) {
    await syncOutboundLead(job, projectId);
  }

  if (jobs.length > 0) {
    const top3 = jobs.slice(0, 3).map(j => `• ${j.title} (${j.score}/10)`).join('\n');
    notify(`Upwork: ${jobs.length} new leads synced\n${top3}`);
  }
  return jobs.length;
}

async function runMessages(projectId) {
  console.log('Scraping Upwork messages via Claude Code...');
  const messages = await readMessages();
  const unread = messages.filter(m => m.sender && m.isUnread);
  console.log(`Found ${unread.length} unread messages (${messages.length} total)`);

  for (const m of unread) {
    // Sync the inbox snippet
    await syncMessage(m, projectId);

    // Also fetch and sync the full thread
    if (m.roomId) {
      try {
        console.log(`  Reading full thread for room ${m.roomId}...`);
        const thread = await readMessageThread(m.roomId);
        await syncMessageThread(thread, projectId);
      } catch (err) {
        console.error(`  Error reading thread ${m.roomId}:`, err.message);
      }
    }
  }

  if (unread.length > 0) {
    notify(`Upwork: ${unread.length} unread messages synced (full threads)`);
  }
  return unread.length;
}

async function runProposals(projectId) {
  console.log('Scraping Upwork proposals via Claude Code...');
  const proposals = await scrapeProposals();
  console.log(`Found ${proposals.length} proposals`);

  for (const p of proposals) {
    await syncProposal(p, projectId);
  }

  const viewed = proposals.filter(p => p.status.includes('view')).length;
  const hired = proposals.filter(p => p.status.includes('hire')).length;
  if (viewed > 0 || hired > 0) {
    notify(`Upwork proposals: ${viewed} viewed, ${hired} hired`);
  }
  return proposals.length;
}

async function runHiring(projectId) {
  console.log('Scraping Upwork hiring via Claude Code...');
  const data = await scrapeHiring();
  console.log(`Found ${data.jobPosts.length} job posts, ${data.applicants.length} applicants, ${data.activeContracts.length} contracts`);

  for (const j of data.jobPosts) {
    await syncHiringJob(j, projectId);
  }
  for (const a of data.applicants) {
    await syncApplicant(a, projectId);
  }
  for (const c of data.activeContracts) {
    await syncContract(c, projectId);
  }

  if (data.applicants.length > 0) {
    notify(`Upwork hiring: ${data.applicants.length} new applicants to review`);
  }
  return data;
}

async function main() {
  try {
    const projectId = await getProjectId();
    if (!projectId) {
      console.error('No Upwork project found in hub. Set UPWORK_PROJECT_ID in .env or create a project with "Upwork" in the name.');
      process.exit(1);
    }
    console.log(`Using project: ${projectId} (profile: ${ACTIVE_PROFILE})`);

    switch (command) {
      case 'feed':
        await runFeed(projectId);
        break;
      case 'messages':
        await runMessages(projectId);
        break;
      case 'proposals':
        await runProposals(projectId);
        break;
      case 'hiring':
        await runHiring(projectId);
        break;
      case 'all':
        await runFeed(projectId);
        await runMessages(projectId);
        await runProposals(projectId);
        await runHiring(projectId);
        console.log('All Upwork modes synced.');
        break;
      default:
        console.error(`Unknown command: ${command}. Use: feed | messages | proposals | hiring | all`);
        process.exit(1);
    }
  } catch (err) {
    console.error('Agent error:', err);
    notify(`Upwork agent error: ${err.message}`);
  }
}

main();
