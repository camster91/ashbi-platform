// Notion Sync Service
// Pulls project data from Ashbi Design Notion workspace via Maton.ai API
// and creates/updates Project records in ashbi-platform

import prisma from '../config/db.js';

const MATON_BASE = 'https://api.maton.ai/notion';
const DEFAULT_CLIENT_ID = 'cm6wnmop20000p8038gfynwtq'; // Ashbi Design client ID

// Known project pages in the Ashbi Design Notion workspace
const KNOWN_PROJECTS = [
  { pageId: '3523a5e9-c171-804bae5dec5f8569f21f', name: 'Motomotus', tasksPageId: '3523a5e9-c171-8070b992fd0b3dbc150f' },
  { pageId: '75af4bbf-1e5f-4898-8e63-837f291ecdca', name: 'Numan', tasksPageId: null },
  { pageId: '3413a5e9-c171-80f2-b05c-f370fcd96b93', name: 'TotalETO', tasksPageId: null },
  { pageId: '3263a5e9-c171-80248aecdf9249ab0acb', name: 'Bionic', tasksPageId: null },
  { pageId: '3413a5e9-c171-801cb4afcc64df4a1a15', name: 'Evergreen', tasksPageId: null },
  { pageId: '3413a5e9-c171-8097-b411feca574a5387', name: 'Wellington', tasksPageId: null },
  { pageId: '3433a5e9-c171-80229290ebff001de7b4', name: 'SSCA', tasksPageId: null },
  { pageId: '34f3a5e9-c171-8076-8b0c-f5be5845e756', name: 'Fixes', tasksPageId: null },
  { pageId: '3513a5e9-c171-806fb34ec7dcf95b25ad', name: 'Fixes 2', tasksPageId: null },
];

// Map Notion status to Project status enum
const STATUS_MAP = {
  'done': 'LAUNCHED',
  'complete': 'LAUNCHED',
  'completed': 'LAUNCHED',
  'launched': 'LAUNCHED',
  'live': 'LAUNCHED',
  'in progress': 'DESIGN_DEV',
  'active': 'DESIGN_DEV',
  'design': 'DESIGN_DEV',
  'development': 'DESIGN_DEV',
  'adding content': 'ADDING_CONTENT',
  'content': 'ADDING_CONTENT',
  'finalizing': 'FINALIZING',
  'on hold': 'ON_HOLD',
  'paused': 'ON_HOLD',
  'cancelled': 'CANCELLED',
  'planning': 'STARTING_UP',
  'starting up': 'STARTING_UP',
};

function mapStatus(notionStatus) {
  if (!notionStatus) return 'STARTING_UP';
  const key = notionStatus.toLowerCase().trim();
  return STATUS_MAP[key] || 'STARTING_UP';
}

/**
 * Fetch a Notion page via Maton API and parse its content
 */
async function fetchNotionPage(pageId) {
  const apiKey = process.env.MATON_API_KEY;
  if (!apiKey) {
    throw new Error('MATON_API_KEY is not set');
  }

  const res = await fetch(`${MATON_BASE}/notion-fetch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: pageId }),
  });

  if (!res.ok) {
    throw new Error(`Notion fetch failed for page ${pageId}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Parse Notion page response to extract properties and content
 */
function parseNotionPage(data) {
  const rawText = data?.content?.[0]?.text;
  if (!rawText) {
    return { title: 'Unknown', properties: {}, content: '' };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { title: 'Unknown', properties: {}, content: rawText.substring(0, 500) };
  }

  const title = parsed.title || 'Unknown';

  // Extract properties block
  let properties = {};
  const propMatch = rawText.match(/<properties>(.*?)<\/properties>/s);
  if (propMatch) {
    try {
      properties = JSON.parse(propMatch[1]);
    } catch {
      // properties block may not be valid JSON
    }
  }

  // Extract content block
  let content = '';
  const contentMatch = rawText.match(/<content>(.*?)<\/content>/s);
  if (contentMatch) {
    content = contentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return { title, properties, content };
}

/**
 * Extract credential info from page content
 */
function extractCredentials(content, properties) {
  const creds = [];
  const loginMatch = content.match(/(?:Login|URL|Site)[:\s]+(https?:\/\/[^\s]+)/i);
  const credMatch = content.match(/(?:Creds|Credentials|User|Username)[:\s]+([^\n]+)/i);
  const passMatch = content.match(/(?:Pass|Password)[:\s]+([^\n]+)/i);

  if (loginMatch || credMatch) {
    creds.push({
      type: 'WP_ADMIN',
      label: 'WP Admin',
      url: loginMatch?.[1] || properties['Figma Link'] || '',
      username: credMatch?.[1]?.trim() || '',
      password: passMatch?.[1]?.trim() || '',
    });
  }

  return creds;
}

/**
 * Sync a single Notion project page to ashbi-platform
 */
async function syncProject(projectDef, clientId) {
  const { pageId, name } = projectDef;

  try {
    const data = await fetchNotionPage(pageId);
    const { title, properties, content } = parseNotionPage(data);

    const projectName = properties['Project name'] || title || name;
    const notionStatus = properties['Status'] || '';
    const status = mapStatus(notionStatus);
    const figmaLink = properties['Figma Link'] || null;
    const owner = properties['Owner'] || null;

    // Combine Notion properties with extracted content for description
    const descriptionParts = [];
    if (figmaLink) descriptionParts.push(`Figma: ${figmaLink}`);
    if (content) descriptionParts.push(content.substring(0, 1000));

    const description = descriptionParts.join('\n\n') || null;

    // Upsert project: find by name, update or create
    const existing = await prisma.project.findFirst({
      where: { name: projectName, clientId },
    });

    let project;
    if (existing) {
      project = await prisma.project.update({
        where: { id: existing.id },
        data: {
          description,
          status,
          serviceType: 'web_design',
          updatedAt: new Date(),
        },
      });
    } else {
      project = await prisma.project.create({
        data: {
          name: projectName,
          description,
          status,
          clientId,
          serviceType: 'web_design',
          isRetainer: false,
        },
      });
    }

    // Sync credentials if found
    const creds = extractCredentials(content, properties);
    if (creds.length > 0) {
      for (const cred of creds) {
        const existingCred = await prisma.credential.findFirst({
          where: { projectId: project.id, label: cred.label },
        });
        if (existingCred) {
          await prisma.credential.update({
            where: { id: existingCred.id },
            data: {
              url: cred.url,
              username: cred.username,
              password: cred.password,
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.credential.create({
            data: {
              projectId: project.id,
              label: cred.label,
              category: cred.type,
              url: cred.url,
              username: cred.username,
              password: cred.password,
            },
          });
        }
      }
    }

    return {
      projectId: project.id,
      name: projectName,
      status,
      action: existing ? 'updated' : 'created',
      hadCredentials: creds.length > 0,
      notionStatus,
    };
  } catch (err) {
    return {
      name,
      error: err.message,
      action: 'failed',
    };
  }
}

/**
 * Main sync function — syncs all known Notion projects
 */
export async function syncAllProjects(clientId = DEFAULT_CLIENT_ID) {
  const results = [];

  for (const projectDef of KNOWN_PROJECTS) {
    const result = await syncProject(projectDef, clientId);
    results.push(result);
  }

  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action === 'updated').length;
  const failed = results.filter(r => r.action === 'failed').length;

  return {
    total: results.length,
    created,
    updated,
    failed,
    results,
  };
}

/**
 * Sync a single project by page ID
 */
export async function syncSingleProject(pageId, clientId = DEFAULT_CLIENT_ID) {
  const projectDef = KNOWN_PROJECTS.find(p => p.pageId === pageId) || { pageId, name: 'Unknown' };
  return syncProject(projectDef, clientId);
}

export { KNOWN_PROJECTS };
