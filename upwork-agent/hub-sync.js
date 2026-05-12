import fetch from 'node-fetch';
import 'dotenv/config';

const ACTIVE_PROFILE = process.env.UPWORK_PROFILE || 'cameron';

const BASE = process.env.HUB_BASE_URL || 'https://hub.ashbi.ca/api/bot';
const SECRET = process.env.HUB_BOT_SECRET;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SECRET}`,
};

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Hub API error ${res.status}: ${text}`);
    return null;
  }
  return res.json();
}

async function get(endpoint) {
  const res = await fetch(`${BASE}${endpoint}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

async function patch(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getProjectId() {
  let projectId = process.env.UPWORK_PROJECT_ID;
  if (projectId) return projectId;

  const projects = await get('/projects');
  if (!projects) return null;

  const upworkProject = projects.find(p => p.name.toLowerCase().includes('upwork'));
  return upworkProject?.id || null;
}

function priorityFromScore(score) {
  if (score >= 8) return 'CRITICAL';
  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'NORMAL';
  return 'LOW';
}

export async function syncOutboundLead(job, projectId) {
  return post('/task', {
    projectId,
    title: `[Lead] ${job.title}`,
    description: `Budget: ${job.budget || 'N/A'}\nClient: ${job.client || 'N/A'}\nPosted: ${job.postedTime || 'N/A'}\nScore: ${job.score}/10\nSkills: ${(job.skills || []).join(', ')}\nURL: ${job.url || ''}\n\n${job.description || ''}`,
    priority: priorityFromScore(job.score),
    tags: ['upwork', 'lead', 'outbound'],
    category: 'IMMEDIATE',
    properties: { source: 'upwork', type: 'lead', score: job.score, url: job.url, profile: ACTIVE_PROFILE },
  });
}

export async function syncProposal(p, projectId) {
  return post('/task', {
    projectId,
    title: `[Proposal] ${p.title}`,
    description: `Status: ${p.status}\nSubmitted: ${p.submittedDate || 'N/A'}\nURL: ${p.jobUrl || ''}`,
    priority: 'NORMAL',
    tags: ['upwork', 'proposal', 'outbound'],
    category: 'THIS_WEEK',
    properties: { source: 'upwork', type: 'proposal', status: p.status, url: p.jobUrl, profile: ACTIVE_PROFILE },
  });
}

export async function syncMessage(m, projectId) {
  return post('/task', {
    projectId,
    title: `[Message] ${m.sender}`,
    description: `Preview: ${m.preview}\nTime: ${m.timestamp || 'N/A'}\nRoom: ${m.roomUrl || ''}`,
    priority: 'HIGH',
    tags: ['upwork', 'message'],
    category: 'IMMEDIATE',
    properties: { source: 'upwork', type: 'message', sender: m.sender, roomUrl: m.roomUrl, roomId: m.roomId },
  });
}

export async function syncMessageThread(thread, projectId) {
  if (!thread || !thread.roomId) return null;

  const messageLog = (thread.messages || [])
    .map(msg => `[${msg.timestamp}] ${msg.sender}: ${msg.text}`)
    .join('\n\n');

  const participants = (thread.participants || []).join(', ');

  return post('/task', {
    projectId,
    title: `[Thread] ${participants || thread.roomId}`,
    description: `Room: ${thread.roomId}\nParticipants: ${participants}\nMessages: ${(thread.messages || []).length}\n\n--- Full Thread ---\n${messageLog}`,
    priority: 'NORMAL',
    tags: ['upwork', 'message-thread', 'full-thread'],
    category: 'THIS_WEEK',
    properties: {
      source: 'upwork',
      type: 'message-thread',
      roomId: thread.roomId,
      participants: thread.participants,
      messageCount: (thread.messages || []).length,
      messages: JSON.stringify(thread.messages || []),
      profile: ACTIVE_PROFILE,
    },
  });
}

export async function syncHiringJob(j, projectId) {
  return post('/task', {
    projectId,
    title: `[Hiring] ${j.title}`,
    description: `Applicants: ${j.applicantCount}\nPosted: ${j.postedDate || 'N/A'}\nStatus: ${j.status}\nURL: ${j.url || ''}`,
    priority: 'NORMAL',
    tags: ['upwork', 'hiring', 'inbound'],
    category: 'THIS_WEEK',
    properties: { source: 'upwork', type: 'hiring-job', applicantCount: j.applicantCount, url: j.url },
  });
}

export async function syncApplicant(a, projectId) {
  return post('/task', {
    projectId,
    title: `[Applicant] ${a.name} — ${a.jobTitle}`,
    description: `Rate: ${a.rate || 'N/A'}\nProposal: ${a.proposalSnippet || 'N/A'}`,
    priority: 'HIGH',
    tags: ['upwork', 'applicant', 'inbound'],
    category: 'IMMEDIATE',
    properties: { source: 'upwork', type: 'applicant', name: a.name, rate: a.rate },
  });
}

export async function syncContract(c, projectId) {
  return post('/task', {
    projectId,
    title: `[Contract] ${c.freelancerName} — ${c.jobTitle}`,
    description: `Hours logged: ${c.hoursLogged}\nLast activity: ${c.lastActivity || 'N/A'}`,
    priority: 'NORMAL',
    tags: ['upwork', 'contract', 'inbound'],
    category: 'THIS_WEEK',
    properties: { source: 'upwork', type: 'contract', freelancer: c.freelancerName, hours: c.hoursLogged },
  });
}
