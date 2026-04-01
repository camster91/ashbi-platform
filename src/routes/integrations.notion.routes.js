// Notion Sync Routes
// POST /api/integrations/notion/sync    - two-way sync tasks/projects
// GET  /api/integrations/notion/status  - last sync status
// GET  /api/integrations/notion/databases - list available databases

import { prisma } from '../index.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

export default async function notionRoutes(fastify) {

  // List available Notion databases
  fastify.get('/databases', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!NOTION_TOKEN) return reply.status(503).send({ error: 'NOTION_TOKEN not configured' });
    try {
      const res = await fetch(`${NOTION_API}/search`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({ filter: { value: 'database', property: 'object' } })
      });
      if (!res.ok) return reply.status(502).send({ error: 'Notion API error', detail: await res.text() });
      const data = await res.json();
      return {
        databases: data.results?.map(db => ({
          id: db.id,
          title: db.title?.[0]?.plain_text || 'Untitled',
          url: db.url,
          lastEdited: db.last_edited_time
        })) || [],
        count: data.results?.length || 0
      };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get pages/tasks from a Notion database
  fastify.get('/database/:dbId/pages', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!NOTION_TOKEN) return reply.status(503).send({ error: 'NOTION_TOKEN not configured' });
    const { dbId } = request.params;
    const { cursor, pageSize = 50 } = request.query;
    try {
      const body = { page_size: parseInt(pageSize) };
      if (cursor) body.start_cursor = cursor;

      const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify(body)
      });
      if (!res.ok) return reply.status(502).send({ error: 'Notion API error', detail: await res.text() });
      const data = await res.json();
      return {
        pages: data.results?.map(normalizeNotionPage) || [],
        hasMore: data.has_more,
        nextCursor: data.next_cursor
      };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Pull Notion tasks/projects → create/update in Hub
  fastify.post('/sync', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!NOTION_TOKEN) return reply.status(503).send({ error: 'NOTION_TOKEN not configured' });

    const { dbId, direction = 'notion-to-hub', projectId } = request.body || {};
    if (!dbId) return reply.status(400).send({ error: 'dbId required' });

    const log = { created: 0, updated: 0, skipped: 0, errors: [] };

    try {
      if (direction === 'notion-to-hub' || direction === 'both') {
        // Fetch all pages from Notion database
        let cursor = undefined;
        let hasMore = true;
        const allPages = [];

        while (hasMore) {
          const body = { page_size: 100 };
          if (cursor) body.start_cursor = cursor;

          const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
            method: 'POST',
            headers: notionHeaders(),
            body: JSON.stringify(body)
          });

          if (!res.ok) {
            log.errors.push(`Notion query failed: ${res.status}`);
            break;
          }

          const data = await res.json();
          allPages.push(...(data.results || []));
          hasMore = data.has_more;
          cursor = data.next_cursor;
        }

        // Upsert tasks in Hub
        for (const page of allPages) {
          try {
            const normalized = normalizeNotionPage(page);
            // Try to find existing task by notion page ID stored in metadata
            const existing = await prisma.task.findFirst({
              where: { title: normalized.title, projectId: projectId || undefined }
            });

            if (existing) {
              await prisma.task.update({
                where: { id: existing.id },
                data: {
                  title: normalized.title,
                  description: normalized.description || existing.description,
                  status: mapNotionStatus(normalized.status),
                  updatedAt: new Date()
                }
              });
              log.updated++;
            } else {
              if (projectId) {
                await prisma.task.create({
                  data: {
                    title: normalized.title || 'Untitled',
                    description: normalized.description || '',
                    status: mapNotionStatus(normalized.status),
                    priority: 'NORMAL',
                    projectId
                  }
                });
                log.created++;
              } else {
                log.skipped++;
              }
            }
          } catch (err) {
            log.errors.push(`Page ${page.id}: ${err.message}`);
          }
        }
      }

      if (direction === 'hub-to-notion' || direction === 'both') {
        // Push Hub tasks to Notion
        if (!projectId) {
          log.errors.push('projectId required for hub-to-notion sync');
        } else {
          const tasks = await prisma.task.findMany({ where: { projectId } });

          for (const task of tasks) {
            try {
              await fetch(`${NOTION_API}/pages`, {
                method: 'POST',
                headers: notionHeaders(),
                body: JSON.stringify({
                  parent: { database_id: dbId },
                  properties: {
                    Name: { title: [{ text: { content: task.title } }] },
                    Status: { select: { name: task.status } },
                    Priority: { select: { name: task.priority } },
                  }
                })
              });
              log.created++;
            } catch (err) {
              log.errors.push(`Task ${task.id}: ${err.message}`);
            }
          }
        }
      }

      return {
        success: log.errors.length === 0,
        log,
        syncedAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err, 'Notion sync error');
      return reply.status(500).send({ error: err.message, log });
    }
  });

  // Create a Notion page (push single task to Notion)
  fastify.post('/page', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!NOTION_TOKEN) return reply.status(503).send({ error: 'NOTION_TOKEN not configured' });
    const { dbId, title, status, priority, description } = request.body || {};
    if (!dbId || !title) return reply.status(400).send({ error: 'dbId and title required' });

    try {
      const res = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: {
            Name: { title: [{ text: { content: title } }] },
            ...(status ? { Status: { select: { name: status } } } : {}),
            ...(priority ? { Priority: { select: { name: priority } } } : {}),
          },
          ...(description ? {
            children: [{
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ text: { content: description } }] }
            }]
          } : {})
        })
      });

      if (!res.ok) return reply.status(502).send({ error: await res.text() });
      const page = await res.json();
      return { success: true, pageId: page.id, url: page.url };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}

function normalizeNotionPage(page) {
  const props = page.properties || {};

  // Try to find name/title property
  const titleProp = props.Name || props.Title || props.Task || props['Task Name'] || Object.values(props).find(p => p.type === 'title');
  const title = titleProp?.title?.[0]?.plain_text || 'Untitled';

  const statusProp = props.Status;
  const status = statusProp?.select?.name || statusProp?.status?.name || null;

  const priorityProp = props.Priority;
  const priority = priorityProp?.select?.name || null;

  const descProp = props.Description || props.Notes;
  const description = descProp?.rich_text?.[0]?.plain_text || null;

  return {
    notionId: page.id,
    title,
    status,
    priority,
    description,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time
  };
}

function mapNotionStatus(notionStatus) {
  if (!notionStatus) return 'TODO';
  const s = notionStatus.toLowerCase();
  if (s.includes('done') || s.includes('complete') || s.includes('finished')) return 'DONE';
  if (s.includes('progress') || s.includes('doing') || s.includes('active')) return 'IN_PROGRESS';
  if (s.includes('review') || s.includes('testing')) return 'REVIEW';
  if (s.includes('blocked') || s.includes('hold')) return 'BLOCKED';
  return 'TODO';
}
