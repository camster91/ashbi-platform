/**
 * upwork-claude.js — Browser automation via Claude Code + Chrome extension
 *
 * Instead of Puppeteer/CDP, we spawn Claude Code tasks that use the
 * Chrome extension to control the real Chrome browser. This means:
 * - Real session = logged into Upwork = no Cloudflare issues
 * - No debug ports, no profile copying, no CDP gymnastics
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '120000', 10);

// Profile keywords for job scoring (exported for jobs.js)
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

/**
 * Run a Claude Code task and parse the JSON result.
 * --print makes Claude output to stdout; --permission-mode bypassPermissions
 * lets it use the Chrome extension without prompts.
 */
async function claudeTask(prompt) {
  const { stdout } = await execFileAsync(
    CLAUDE_BIN,
    ['--print', '--permission-mode', 'bypassPermissions', prompt],
    { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
  );

  // Extract JSON from Claude's response (may have text around it)
  const jsonMatch = stdout.match(/```json\s*([\s\S]*?)```/) ||
                    stdout.match(/(\[[\s\S]*\])/) ||
                    stdout.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    console.error('Claude response (no JSON found):', stdout.slice(0, 500));
    throw new Error('Could not parse JSON from Claude response');
  }

  return JSON.parse(jsonMatch[1]);
}

/**
 * Read messages from Upwork inbox.
 * Returns array of { sender, preview, timestamp, roomUrl, roomId, isUnread }
 */
export async function readMessages() {
  const prompt = `Open Chrome and navigate to https://www.upwork.com/messages/rooms

Wait for the page to fully load (at least 3 seconds).

Extract the first 20 message threads from the inbox. For each thread, extract:
- sender: the contact name
- preview: the last message preview (max 200 chars)
- timestamp: when the last message was sent
- roomUrl: the full URL to the message room (the href of the link)
- roomId: extract the room ID from the URL (the part after /rooms/)
- isUnread: whether the thread has an unread indicator

Return ONLY a JSON array. No explanation. Example:
\`\`\`json
[{"sender":"John Doe","preview":"Hey, about the project...","timestamp":"2h ago","roomUrl":"https://www.upwork.com/messages/rooms/abc123","roomId":"abc123","isUnread":true}]
\`\`\``;

  return claudeTask(prompt);
}

/**
 * Read full message thread for a specific room.
 * Returns { roomId, participants, messages: [{ sender, text, timestamp }] }
 */
export async function readMessageThread(roomId) {
  const prompt = `Open Chrome and navigate to https://www.upwork.com/messages/rooms/${roomId}

Wait for the page to fully load (at least 3 seconds). Scroll up to load older messages if there's a "load more" button.

Extract the full conversation thread. For each message extract:
- sender: who sent it
- text: the full message text
- timestamp: when it was sent

Also extract the list of participants in this conversation.

Return ONLY JSON. No explanation. Example:
\`\`\`json
{"roomId":"${roomId}","participants":["John Doe","Cameron"],"messages":[{"sender":"John Doe","text":"Hey, about the project...","timestamp":"Mar 15, 2026 2:30 PM"},{"sender":"Cameron","text":"Sure, let me check...","timestamp":"Mar 15, 2026 2:35 PM"}]}
\`\`\``;

  return claudeTask(prompt);
}

/**
 * Scrape the Upwork job feed (best matches, sorted by recency).
 * Returns array of job objects.
 */
export async function scrapeJobFeed() {
  const prompt = `Open Chrome and navigate to https://www.upwork.com/nx/find-work/best-matches?sort=recency

Wait for the page to fully load (at least 3 seconds). Scroll down 3-4 times to load more job cards.

Extract up to 30 job listings. For each job extract:
- title: job title
- url: full URL to the job posting
- description: job description (max 500 chars)
- budget: budget or hourly rate shown
- postedTime: when it was posted (e.g. "2 hours ago")
- client: client country and total spend, separated by " · "
- skills: array of required skills
- tier: contractor tier if shown (e.g. "Expert")
- proposals: proposal count text if shown

Return ONLY a JSON array. No explanation. Example:
\`\`\`json
[{"title":"Build Shopify Store","url":"https://www.upwork.com/jobs/~abc","description":"Need a developer...","budget":"$1,000-$2,500","postedTime":"2 hours ago","client":"United States · $50K+ spent","skills":["Shopify","CSS","JavaScript"],"tier":"Expert","proposals":"5 to 10"}]
\`\`\``;

  return claudeTask(prompt);
}

/**
 * Scrape submitted proposals.
 * Returns array of { title, jobUrl, status, submittedDate }
 */
export async function scrapeProposals() {
  const prompt = `Open Chrome and navigate to https://www.upwork.com/ab/proposals/

Wait for the page to fully load (at least 3 seconds).

Extract up to 30 proposals. For each proposal extract:
- title: the job title
- jobUrl: URL to the job
- status: current status (e.g. "submitted", "viewed", "hired", "archived")
- submittedDate: when the proposal was submitted

Return ONLY a JSON array. No explanation. Example:
\`\`\`json
[{"title":"Build Shopify Store","jobUrl":"https://www.upwork.com/jobs/~abc","status":"viewed","submittedDate":"Mar 10, 2026"}]
\`\`\``;

  return claudeTask(prompt);
}

/**
 * Scrape hiring dashboard (client mode) - job posts, applicants, contracts.
 * Returns { jobPosts, applicants, activeContracts }
 */
export async function scrapeHiring() {
  const prompt = `I need you to scrape 3 Upwork pages in sequence. Open Chrome for each.

**Page 1:** Navigate to https://www.upwork.com/nx/hire/
Wait for load. Extract job postings as array:
- title, url, applicantCount, postedDate, status

**Page 2:** Navigate to https://www.upwork.com/ab/contracts/active
Wait for load. Extract active contracts as array:
- freelancerName, jobTitle, hoursLogged, lastActivity

For applicants: for the first 5 job posts from Page 1 that have URLs, visit each URL, click the Applicants tab if present, and extract:
- name, rate, proposalSnippet (max 200 chars), jobTitle (from the parent job)

Return ONLY JSON combining all results. No explanation. Example:
\`\`\`json
{"jobPosts":[{"title":"Dev needed","url":"https://...","applicantCount":"5","postedDate":"Mar 1","status":"open"}],"applicants":[{"name":"Jane Doe","rate":"$45/hr","proposalSnippet":"I have 5 years...","jobTitle":"Dev needed"}],"activeContracts":[{"freelancerName":"Bob","jobTitle":"Dev work","hoursLogged":"24","lastActivity":"Yesterday"}]}
\`\`\``;

  return claudeTask(prompt);
}

/**
 * Read contract details for a specific contract.
 * Returns { contractId, freelancerName, jobTitle, startDate, status, hoursLogged, totalEarned, weeklyLimit, milestones }
 */
export async function readContractDetails(contractId) {
  const prompt = `Open Chrome and navigate to https://www.upwork.com/ab/contracts/${contractId}

Wait for the page to fully load (at least 3 seconds).

Extract all visible contract details:
- contractId: "${contractId}"
- freelancerName: the freelancer's name
- jobTitle: the job/contract title
- startDate: when the contract started
- status: current status (active, paused, ended)
- hoursLogged: total hours logged
- totalEarned: total amount earned/paid
- weeklyLimit: weekly hour limit if set
- milestones: array of milestones if any (each with description, amount, status)

Return ONLY JSON. No explanation. Example:
\`\`\`json
{"contractId":"${contractId}","freelancerName":"Jane Doe","jobTitle":"Web Development","startDate":"Mar 1, 2026","status":"active","hoursLogged":"48","totalEarned":"$2,400","weeklyLimit":"40 hrs/wk","milestones":[]}
\`\`\``;

  return claudeTask(prompt);
}
