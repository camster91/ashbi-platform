#!/usr/bin/env node
/**
 * Upwork Agent — powered by browser-agent skill
 * 
 * Replaces upwork-claude.js / upwork-playwright.js with the new browser-agent
 * (skills/browser-agent/) which uses Playwright + Claude Haiku vision.
 * 
 * Usage:
 *   node agent.js feed        — Scan job feed, score, sync to Hub
 *   node agent.js messages    — Read unread messages, sync to Hub
 *   node agent.js proposals   — Check proposal statuses, sync to Hub
 *   node agent.js hiring      — Check active contracts, sync to Hub
 *   node agent.js all         — Run all of the above
 *   node agent.js sync-profile — Re-sync Chrome profile (run when session goes stale)
 * 
 * IMPORTANT: Proposals are NEVER submitted automatically.
 * All drafts require Cameron's ✅ before sending.
 * 
 * Cookie refresh: run `node agent.js sync-profile` with Chrome closed to get
 * fresh cookies. The Network/Cookies file requires Chrome to be closed.
 */

import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
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

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BROWSER_AGENT = path.resolve(
  __dirname,
  '../../skills/browser-agent/scripts/browser-agent.js'
);

const PROFILE = 'ashbi'; // matches skills/browser-agent/chrome-profiles/ashbi/
const TURN_LIMIT = 20;

const KEYWORDS = {
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

const ACTIVE_PROFILE = process.env.UPWORK_PROFILE || 'cameron';
const ACTIVE_KEYWORDS = KEYWORDS[ACTIVE_PROFILE] || KEYWORDS.cameron;

/**
 * Run the browser-agent with a given prompt and start URL.
 * Returns the plain-text output.
 */
async function runBrowserAgent(prompt, startUrl, extraArgs = []) {
  const args = [
    BROWSER_AGENT,
    '--profile', PROFILE,
    '--prompt', prompt,
    '--start-url', startUrl,
    '--turn-limit', String(TURN_LIMIT),
    ...extraArgs,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('node', args, {
      timeout: 3 * 60 * 1000, // 3 min max
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });
    if (stderr) console.error('[browser-agent stderr]', stderr.trim());
    return stdout.trim();
  } catch (err) {
    console.error('[browser-agent error]', err.message);
    throw err;
  }
}

/**
 * Parse structured text output from browser-agent into job objects.
 * Browser-agent returns free-form text; we extract jobs by splitting on
 * numbered list items or "---" separators.
 */
function parseJobOutput(text) {
  const jobs = [];
  // Split on lines that start with a number + period/dash, or "---"
  const blocks = text.split(/\n(?=\d+[\.\)]\s|\-{3})/g);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const titleMatch = block.match(/^[\d]+[\.\)]\s*(.+?)(?:\n|$)/);
    const title = titleMatch ? titleMatch[1].trim() : block.split('\n')[0].trim();
    const budgetMatch = block.match(/budget[:\s]+([^\n]+)/i) || block.match(/\$[\d,]+(?:k)?(?:\s*[-–]\s*\$[\d,]+(?:k)?)?/i);
    const budget = budgetMatch ? budgetMatch[0].replace(/budget[:\s]+/i, '').trim() : null;
    const urlMatch = block.match(/https?:\/\/[^\s]+upwork\.com[^\s]*/i);
    const url = urlMatch ? urlMatch[0] : null;
    if (title && title.length > 5) {
      jobs.push({ title, budget, url, description: block, skills: [] });
    }
  }
  return jobs;
}

function scoreJob(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  let score = 0;
  for (const kw of ACTIVE_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  if (job.budget) {
    const amt = parseFloat(job.budget.replace(/[^0-9.]/g, ''));
    if (amt >= 5000) score += 2;
    else if (amt >= 1000) score += 1;
  }
  return Math.min(score, 10);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function runFeed(projectId) {
  console.log('Scanning Upwork job feed via browser-agent...');

  const output = await runBrowserAgent(
    `Go to the Upwork job feed. Look for recently posted jobs matching these criteria: WordPress, WooCommerce, web design, Elementor, Figma to WordPress, CPG branding, DTC packaging design, brand identity, or website redesign. 
    For each matching job, extract: job title, budget/rate, number of proposals, client rating, posted time, and job URL. 
    Return a numbered list of up to 20 matching jobs with all extracted details. Skip any jobs with 50+ proposals already.`,
    'https://www.upwork.com/nx/find-work/most-recent'
  );

  console.log('\n[Raw browser-agent output]\n', output.slice(0, 500), '...');

  const rawJobs = parseJobOutput(output);
  const jobs = rawJobs
    .map(j => ({ ...j, score: scoreJob(j) }))
    .filter(j => j.score >= 2)
    .sort((a, b) => b.score - a.score);

  console.log(`Found ${jobs.length} matching jobs (from ${rawJobs.length} parsed)`);

  for (const job of jobs) {
    await syncOutboundLead(job, projectId);
  }

  if (jobs.length > 0) {
    const top3 = jobs.slice(0, 3).map(j => `• ${j.title} (score: ${j.score}/10)`).join('\n');
    notify(`Upwork: ${jobs.length} new leads synced\n${top3}`);
  }

  // Also return raw output so the Upwork agent (Ash's team) can read it
  return { count: jobs.length, jobs, raw: output };
}

async function runMessages(projectId) {
  console.log('Reading Upwork messages via browser-agent...');

  const output = await runBrowserAgent(
    `Go to Upwork messages. List all unread or recent conversations. For each conversation return: 
    sender name, message preview (first 100 chars), time received, and whether it appears urgent or requires a reply. 
    Focus on anything needing a response.`,
    'https://www.upwork.com/messages/rooms'
  );

  console.log('\n[Raw browser-agent output]\n', output.slice(0, 500), '...');

  // Parse into basic message objects
  const messages = output
    .split(/\n(?=\d+[\.\)]\s)/g)
    .filter(b => b.trim().length > 5)
    .map(block => {
      const senderMatch = block.match(/sender[:\s]+([^\n]+)/i) || block.match(/^[\d]+[\.\)]\s*([^:]+):/);
      return {
        sender: senderMatch ? senderMatch[1].trim() : 'Unknown',
        preview: block.slice(0, 200),
        isUnread: /unread|new message/i.test(block),
        raw: block,
      };
    });

  const unread = messages.filter(m => m.isUnread);
  console.log(`Found ${unread.length} unread messages (${messages.length} total)`);

  for (const m of unread) {
    await syncMessage(m, projectId);
  }

  if (unread.length > 0) {
    notify(`Upwork: ${unread.length} unread messages synced`);
  }

  return { count: unread.length, messages, raw: output };
}

async function runProposals(projectId) {
  console.log('Checking Upwork proposals via browser-agent...');

  const output = await runBrowserAgent(
    `Go to Upwork proposals page. List all active proposals. For each proposal return: 
    job title, proposal status (sent/viewed/interviewing/hired/declined), when submitted, client name if visible.
    Highlight any that have been viewed or moved to interview stage.`,
    'https://www.upwork.com/nx/proposals'
  );

  console.log('\n[Raw browser-agent output]\n', output.slice(0, 500), '...');

  const proposals = output
    .split(/\n(?=\d+[\.\)]\s)/g)
    .filter(b => b.trim().length > 5)
    .map(block => {
      const statusMatch = block.match(/status[:\s]+([^\n]+)/i) || 
                          block.match(/\b(sent|viewed|interviewing|hired|declined)\b/i);
      return {
        title: block.split('\n')[0].replace(/^\d+[\.\)]\s*/, '').trim(),
        status: statusMatch ? statusMatch[1] || statusMatch[0] : 'sent',
        raw: block,
      };
    });

  console.log(`Found ${proposals.length} proposals`);

  for (const p of proposals) {
    await syncProposal(p, projectId);
  }

  const viewed = proposals.filter(p => /view/i.test(p.status)).length;
  const hired = proposals.filter(p => /hire/i.test(p.status)).length;
  if (viewed > 0 || hired > 0) {
    notify(`Upwork proposals: ${viewed} viewed, ${hired} hired`);
  }

  return { count: proposals.length, proposals, raw: output };
}

async function runHiring(projectId) {
  console.log('Checking Upwork active contracts via browser-agent...');

  const output = await runBrowserAgent(
    `Go to Upwork active contracts page. List all active contracts. For each contract return:
    client name, project title, contract type (hourly/fixed), current status, 
    any pending milestones or time submissions, and whether any action is needed.`,
    'https://www.upwork.com/ab/jobs/?status=active'
  );

  console.log('\n[Raw browser-agent output]\n', output.slice(0, 500), '...');

  // Minimal parse — sync as hiring data
  const contracts = output
    .split(/\n(?=\d+[\.\)]\s)/g)
    .filter(b => b.trim().length > 5)
    .map(block => ({
      title: block.split('\n')[0].replace(/^\d+[\.\)]\s*/, '').trim(),
      raw: block,
    }));

  for (const c of contracts) {
    await syncContract(c, projectId);
  }

  return { count: contracts.length, raw: output };
}

async function syncProfileCmd() {
  console.log('Syncing Chrome Profile 4 → browser-agent ashbi profile...');
  console.log('NOTE: Close Chrome for a full cookie sync (Network/Cookies file).');

  try {
    const { stdout, stderr } = await execFileAsync('node', [BROWSER_AGENT, 'sync-profile', 'ashbi'], {
      timeout: 60 * 1000,
      env: { ...process.env },
    });
    if (stderr) console.error(stderr.trim());
    console.log(stdout.trim());
  } catch (err) {
    console.error('Profile sync error:', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const command = process.argv[2] || 'all';

async function main() {
  if (command === 'sync-profile') {
    await syncProfileCmd();
    return;
  }

  try {
    const projectId = await getProjectId();
    if (!projectId) {
      console.warn('No Upwork project found in hub. Proceeding without project sync.');
    }
    console.log(`Upwork agent running — command: ${command} | profile: ${ACTIVE_PROFILE}`);

    let result;
    switch (command) {
      case 'feed':
        result = await runFeed(projectId);
        // Print clean summary for the Upwork agent to read
        console.log('\n=== JOB FEED RESULTS ===\n' + (result.raw || ''));
        break;
      case 'messages':
        result = await runMessages(projectId);
        console.log('\n=== MESSAGES RESULTS ===\n' + (result.raw || ''));
        break;
      case 'proposals':
        result = await runProposals(projectId);
        console.log('\n=== PROPOSALS RESULTS ===\n' + (result.raw || ''));
        break;
      case 'hiring':
        result = await runHiring(projectId);
        console.log('\n=== HIRING/CONTRACTS RESULTS ===\n' + (result.raw || ''));
        break;
      case 'all':
        await runFeed(projectId);
        await runMessages(projectId);
        await runProposals(projectId);
        await runHiring(projectId);
        console.log('\nAll Upwork modes synced.');
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Use: feed | messages | proposals | hiring | all | sync-profile');
        process.exit(1);
    }
  } catch (err) {
    console.error('Agent error:', err);
    notify(`Upwork agent error: ${err.message}`);
    process.exit(1);
  }
}

main();
