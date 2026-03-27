#!/usr/bin/env node

/**
 * Notion Workspace Mapper
 * 
 * Maps entire Notion workspace structure:
 * - Extract all databases and pages
 * - List all projects and tasks
 * - Extract team assignments
 * - Generate sync plan for hub.ashbi.ca
 * 
 * Config: Set NOTION_TOKEN in .env
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  NOTION_TOKEN: process.env.NOTION_TOKEN,
  NOTION_VERSION: '2022-06-28',
  HUB_API_BASE: process.env.HUB_API_BASE || 'https://hub.ashbi.ca/api',
};

const LOG_FILE = path.join(__dirname, '../memory/notion-mapper-log.txt');

function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${level}: ${msg}\n`;
  console.log(logEntry);
  fs.appendFileSync(LOG_FILE, logEntry, { flag: 'a' });
}

/**
 * Make request to Notion API
 */
async function notionRequest(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
        'Notion-Version': CONFIG.NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`https://api.notion.com/v1${endpoint}`, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${response.status}: ${error}`);
    }

    return await response.json();
  } catch (error) {
    log(`Notion API error: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get all databases in workspace
 */
async function getDatabases() {
  try {
    log('📚 Fetching Notion databases...');
    const response = await notionRequest('/search', 'POST', {
      filter: { value: 'database', property: 'object' },
      page_size: 100,
    });

    const databases = response.results.filter(r => r.object === 'database');
    log(`✅ Found ${databases.length} databases`);
    return databases;
  } catch (error) {
    log(`Error fetching databases: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Get all pages in workspace
 */
async function getPages() {
  try {
    log('📄 Fetching Notion pages...');
    const response = await notionRequest('/search', 'POST', {
      filter: { value: 'page', property: 'object' },
      page_size: 100,
    });

    const pages = response.results.filter(r => r.object === 'page');
    log(`✅ Found ${pages.length} pages`);
    return pages;
  } catch (error) {
    log(`Error fetching pages: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Get all entries in a database
 */
async function getDatabaseEntries(databaseId) {
  try {
    const response = await notionRequest(`/databases/${databaseId}/query`, 'POST', {
      page_size: 100,
    });

    return response.results;
  } catch (error) {
    log(`Error querying database ${databaseId}: ${error.message}`, 'WARN');
    return [];
  }
}

/**
 * Extract properties from database entry
 */
function extractProperties(entry) {
  const props = entry.properties || {};
  const extracted = {};

  for (const [key, value] of Object.entries(props)) {
    if (value.type === 'title') {
      extracted[key] = value.title?.map(t => t.plain_text).join('') || '';
    } else if (value.type === 'rich_text') {
      extracted[key] = value.rich_text?.map(t => t.plain_text).join('') || '';
    } else if (value.type === 'select') {
      extracted[key] = value.select?.name || '';
    } else if (value.type === 'multi_select') {
      extracted[key] = value.multi_select?.map(s => s.name) || [];
    } else if (value.type === 'date') {
      extracted[key] = value.date?.start || '';
    } else if (value.type === 'people') {
      extracted[key] = value.people?.map(p => p.name) || [];
    } else if (value.type === 'checkbox') {
      extracted[key] = value.checkbox || false;
    } else if (value.type === 'url') {
      extracted[key] = value.url || '';
    } else if (value.type === 'email') {
      extracted[key] = value.email || '';
    } else if (value.type === 'number') {
      extracted[key] = value.number || 0;
    }
  }

  return extracted;
}

/**
 * Map Notion workspace and generate report
 */
async function mapWorkspace() {
  try {
    log('🚀 Notion Workspace Mapper started');
    const startTime = Date.now();

    if (!CONFIG.NOTION_TOKEN) {
      throw new Error('NOTION_TOKEN not set in environment');
    }

    const workspace = {
      databases: [],
      pages: [],
      projects: [],
      tasks: [],
      teamAssignments: {},
      syncPlan: [],
    };

    const databases = await getDatabases();
    workspace.databases = databases.map(db => ({
      id: db.id,
      title: db.title?.map(t => t.plain_text).join('') || 'Untitled',
      url: db.url,
      createdTime: db.created_time,
    }));

    const pages = await getPages();
    workspace.pages = pages.map(pg => ({
      id: pg.id,
      title: pg.title?.map(t => t.plain_text).join('') || 'Untitled',
      url: pg.url,
      createdTime: pg.created_time,
    }));

    for (const db of databases) {
      const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Unknown';
      log(`Processing database: ${dbTitle}`);

      const entries = await getDatabaseEntries(db.id);
      
      for (const entry of entries) {
        const props = extractProperties(entry);

        if (dbTitle.toLowerCase().includes('project')) {
          workspace.projects.push({
            id: entry.id,
            name: props.Name || props.Title || 'Untitled',
            status: props.Status || 'Unknown',
            owner: props.Owner || props.Lead || 'Unassigned',
            dueDate: props['Due Date'] || props.Due || null,
            link: entry.url,
          });
        } else if (dbTitle.toLowerCase().includes('task')) {
          workspace.tasks.push({
            id: entry.id,
            title: props.Title || props.Name || 'Untitled',
            status: props.Status || 'Unknown',
            assignee: props.Assignee || props.Owner || 'Unassigned',
            dueDate: props['Due Date'] || props.Due || null,
            project: props.Project || null,
            link: entry.url,
          });
        }

        const assignee = props.Assignee || props.Owner;
        if (assignee) {
          if (!workspace.teamAssignments[assignee]) {
            workspace.teamAssignments[assignee] = [];
          }
          workspace.teamAssignments[assignee].push({
            id: entry.id,
            title: props.Title || props.Name || 'Untitled',
          });
        }
      }
    }

    workspace.syncPlan = generateSyncPlan(workspace);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ Mapping complete in ${duration}s`);
    log(`Found: ${workspace.projects.length} projects, ${workspace.tasks.length} tasks`);

    return workspace;
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Generate sync plan for hub.ashbi.ca
 */
function generateSyncPlan(workspace) {
  const plan = [];

  for (const project of workspace.projects) {
    plan.push({
      type: 'CREATE_PROJECT',
      source: 'notion',
      notionId: project.id,
      title: project.name,
      status: project.status,
      owner: project.owner,
      dueDate: project.dueDate,
      action: `POST /api/projects with name="${project.name}", status="${project.status}"`,
    });
  }

  for (const task of workspace.tasks) {
    plan.push({
      type: 'CREATE_TASK',
      source: 'notion',
      notionId: task.id,
      title: task.title,
      assignee: task.assignee,
      projectId: task.project,
      dueDate: task.dueDate,
      action: `POST /api/projects/:projectId/tasks with title="${task.title}", assignee="${task.assignee}"`,
    });
  }

  return plan;
}

/**
 * Save report to memory
 */
function saveReport(workspace) {
  const reportPath = path.join(__dirname, '../memory/notion-workspace-mapping.md');

  const markdown = `# Notion Workspace Mapping

**Generated:** ${new Date().toISOString()}

## Summary
- **Databases:** ${workspace.databases.length}
- **Pages:** ${workspace.pages.length}
- **Projects:** ${workspace.projects.length}
- **Tasks:** ${workspace.tasks.length}
- **Team Members:** ${Object.keys(workspace.teamAssignments).length}

---

## Sync Plan for hub.ashbi.ca

### To Execute:
\`\`\`
${workspace.syncPlan.slice(0, 10).map(s => `${s.type}: ${s.action}`).join('\n')}
\`\`\`

Total sync actions: ${workspace.syncPlan.length}

---

*Generated by Notion Workspace Mapper*
`;

  fs.writeFileSync(reportPath, markdown);
  return reportPath;
}

/**
 * Main execution
 */
async function main() {
  try {
    log('🚀 Notion Workspace Mapper started');

    const workspace = await mapWorkspace();
    const reportPath = saveReport(workspace);

    log(`✅ Complete! Report: ${reportPath}`);
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    log(`Uncaught error: ${error.message}`, 'ERROR');
    process.exit(1);
  });
}

module.exports = { mapWorkspace, getDatabases, getPages };
