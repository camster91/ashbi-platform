// Embedding service - pgvector-based RAG for Client Brain
// Migrated from ashbi-hub raw SQL to Prisma with $queryRaw for vector ops

import prisma from '../config/db.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Generate an embedding vector using Ollama
 */
export async function generateEmbedding(text) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.statusText}`);
  }

  const data = await response.json();
  const embedding = data.embeddings?.[0];
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Ollama embedding response did not include a vector');
  }
  return embedding;
}

/**
 * Store an embedding for a client
 */
export async function storeEmbedding(clientId, content, source, sourceId = null, metadata = {}) {
  const embedding = await generateEmbedding(content);

  // Use Prisma's $executeRaw for the vector column since it's an Unsupported type
  await prisma.$executeRaw`
    INSERT INTO "client_embeddings" ("id", "clientId", "source", "sourceId", "content", "embedding", "metadata", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${clientId},
      ${source},
      ${sourceId},
      ${content},
      ${embedding}::vector,
      ${JSON.stringify(metadata)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING
  `;

  return { clientId, source, content: content.substring(0, 100) + '...' };
}

/**
 * Search for similar content using pgvector cosine similarity.
 *
 * SECURITY (audit 2026-07-09, swarm finding P0-B): the previous
 * implementation trusted a caller-supplied `clientId` query param and
 * returned cross-tenant matches when none was provided. We now require an
 * `organizationId` (taken from the per-request scoped prisma's
 * `client.organizationId`) and always filter by it. If the caller also
 * provides a `clientId`, that is applied as an additional AND filter.
 */
export async function searchSimilar(query, limit = 5, clientId = null, organizationId = null) {
  const queryEmbedding = await generateEmbedding(query);

  // Tenant-scope: build WHERE clause from organizationId first, then
  // optionally narrow by clientId. organizationId is mandatory.
  if (!organizationId) {
    throw new Error('organizationId is required for scoped embedding search');
  }

  const tenantClause = prisma.sql`c."organizationId" = ${organizationId}`;
  const clientClause = clientId
    ? prisma.sql`AND ce."clientId" = ${clientId}`
    : prisma.sql``;

  const results = await prisma.$queryRaw`
    SELECT
      ce.id,
      ce."clientId",
      ce.source,
      ce.content,
      ce.metadata,
      c.name as "clientName",
      1 - (ce.embedding <=> ${queryEmbedding}::vector) as similarity
    FROM "client_embeddings" ce
    JOIN clients c ON c.id = ce."clientId"
    WHERE ${tenantClause}
    ${clientClause}
    ORDER BY ce.embedding <=> ${queryEmbedding}::vector
    LIMIT ${limit}
  `;

  return results.map(r => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    source: r.source,
    content: r.content,
    similarity: Number(r.similarity),
    metadata: r.metadata
  }));
}

/**
 * Delete embeddings for a specific source
 */
export async function deleteEmbeddings(source, sourceId) {
  await prisma.$executeRaw`
    DELETE FROM "client_embeddings"
    WHERE source = ${source} AND "sourceId" = ${sourceId}
  `;
}

/**
 * Re-embed all content for a client (rebuild Client Brain)
 */
export async function rebuildClientBrain(clientId) {
  // Delete existing embeddings for this client
  await prisma.$executeRaw`
    DELETE FROM "client_embeddings"
    WHERE "clientId" = ${clientId}
  `;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: { include: { threads: { include: { messages: true } } } },
      proposals: true,
      invoices: true
    }
  });

  if (!client) return;

  const embeddingPromises = [];

  // Embed client knowledge base
  if (client.knowledgeBase) {
    const kb = typeof client.knowledgeBase === 'string'
      ? JSON.parse(client.knowledgeBase)
      : client.knowledgeBase;
    if (Array.isArray(kb) && kb.length > 0) {
      embeddingPromises.push(
        storeEmbedding(clientId, kb.join(' '), 'KNOWLEDGE_BASE', null, { type: 'knowledge_base' })
      );
    }
  }

  // Embed project threads and messages
  for (const project of client.projects) {
    if (project.aiSummary) {
      embeddingPromises.push(
        storeEmbedding(clientId, project.aiSummary, 'PROJECT', project.id, { projectName: project.name })
      );
    }
    for (const thread of project.threads) {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (lastMessage) {
        embeddingPromises.push(
          storeEmbedding(
            clientId,
            `${thread.subject}: ${lastMessage.bodyText.substring(0, 500)}`,
            'THREAD',
            thread.id,
            { project: project.name, threadSubject: thread.subject }
          )
        );
      }
    }
  }

  // Embed proposals
  for (const proposal of client.proposals) {
    embeddingPromises.push(
      storeEmbedding(
        clientId,
        `Proposal: ${proposal.title} - ${proposal.notes || ''}`,
        'PROPOSAL',
        proposal.id,
        { status: proposal.status, total: proposal.total }
      )
    );
  }

  // PERFORMANCE (audit 2026-07-09, swarm finding): previously called
  // Promise.all on every embedding in one shot — for a client with
  // 100+ threads that's 100+ concurrent Ollama requests, which Ollama
  // typically handles at 1-4 concurrency before rate-limiting or
  // crashing. Chunk in groups of OLLAMA_CONCURRENCY to bound fan-out.
  const OLLAMA_CONCURRENCY = 4;
  let completed = 0;
  for (let i = 0; i < embeddingPromises.length; i += OLLAMA_CONCURRENCY) {
    const chunk = embeddingPromises.slice(i, i + OLLAMA_CONCURRENCY);
    await Promise.all(chunk);
    completed += chunk.length;
  }

  return { clientId, embeddingsCreated: embeddingPromises.length };
}
