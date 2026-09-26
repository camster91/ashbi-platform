// Embedding service - pgvector-based RAG for Client Brain
// Migrated from ashbi-hub raw SQL to Prisma with $queryRaw for vector ops

import prisma from '../config/db.js';
import { randomUUID } from 'node:crypto';
import { aiGovernance } from '../ai/governance.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Generate an embedding vector using Ollama.
 *
 * Honours the AI kill switches (#413): throws AiDisabledError when AI is off
 * for the deployment or for the request's / job's organization, before any
 * text leaves the server. Embeddings always use the platform endpoint, never
 * an organization's BYOK connection (docs/ai-byok.md).
 */
export async function generateEmbedding(text) {
  await aiGovernance.assertAllowed();
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
export async function assertEmbeddingClientOwnership(clientId, prismaClient = prisma) {
  const client = await prismaClient.client.findFirst({
    where: { id: clientId },
    select: { id: true, organizationId: true },
  });
  if (!client) {
    const error = new Error('The selected client is not available in this organization');
    error.statusCode = 404;
    throw error;
  }
  return client;
}

export async function storeEmbedding(clientId, content, source, sourceId = null, metadata = {}, options = {}) {
  const prismaClient = options.prismaClient || prisma;
  const embed = options.generateEmbedding || generateEmbedding;
  await assertEmbeddingClientOwnership(clientId, prismaClient);
  const embedding = await embed(content);
  const id = randomUUID();

  // Use Prisma's $executeRaw for the vector column since it's an Unsupported type
  await prismaClient.$executeRaw`
    INSERT INTO "client_embeddings" ("id", "clientId", "source", "sourceId", "content", "embedding", "metadata", "createdAt", "updatedAt")
    VALUES (
      ${id},
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

  return { id, clientId, source, content: content.substring(0, 100) + '...' };
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

  // Bind the vector as a single parameter fragment instead of splicing it into
  // the statement text. `::vector` is applied to the bound value, so the
  // embedding never becomes part of the SQL string.
  const vector = prisma.sql`${queryEmbedding}::vector`;

  const results = await prisma.$queryRaw`
    SELECT
      ce.id,
      ce."clientId",
      ce.source,
      ce.content,
      ce.metadata,
      c.name as "clientName",
      1 - (ce.embedding <=> ${vector}) as similarity
    FROM "client_embeddings" ce
    JOIN clients c ON c.id = ce."clientId"
    WHERE ${tenantClause}
    ${clientClause}
    ORDER BY ce.embedding <=> ${vector}
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
export async function deleteEmbeddings(source, sourceId, organizationId, prismaClient = prisma) {
  if (!organizationId) {
    throw new Error('organizationId is required for scoped embedding deletion');
  }
  return prismaClient.$executeRaw`
    DELETE FROM "client_embeddings" AS ce
    USING clients AS c
    WHERE ce.source = ${source}
      AND ce."sourceId" = ${sourceId}
      AND c."organizationId" = ${organizationId}
      AND ce."clientId" = c.id
  `;
}

/**
 * Re-embed all content for a client (rebuild Client Brain)
 */
export async function rebuildClientBrain(clientId, options = {}) {
  const prismaClient = options.prismaClient || prisma;
  await assertEmbeddingClientOwnership(clientId, prismaClient);
  const client = await prismaClient.client.findUnique({
    where: { id: clientId },
    include: {
      projects: { include: { threads: { include: { messages: true } } } },
      proposals: true,
    }
  });

  if (!client) {
    const error = new Error('The selected client is not available in this organization');
    error.statusCode = 404;
    throw error;
  }

  const embeddingInputs = [];

  // Embed client knowledge base
  if (client.knowledgeBase) {
    const kb = typeof client.knowledgeBase === 'string'
      ? JSON.parse(client.knowledgeBase)
      : client.knowledgeBase;
    if (Array.isArray(kb) && kb.length > 0) {
      embeddingInputs.push([clientId, kb.join(' '), 'KNOWLEDGE_BASE', null, { type: 'knowledge_base' }]);
    }
  }

  // Embed project threads and messages
  for (const project of client.projects) {
    if (project.aiSummary) {
      embeddingInputs.push([clientId, project.aiSummary, 'PROJECT', project.id, { projectName: project.name }]);
    }
    for (const thread of project.threads) {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (lastMessage) {
        embeddingInputs.push([
          clientId,
          `${thread.subject}: ${lastMessage.bodyText.substring(0, 500)}`,
          'THREAD',
          thread.id,
          { project: project.name, threadSubject: thread.subject },
        ]);
      }
    }
  }

  // Embed proposals
  for (const proposal of client.proposals) {
    embeddingInputs.push([
      clientId,
      `Proposal: ${proposal.title} - ${proposal.notes || ''}`,
      'PROPOSAL',
      proposal.id,
      { status: proposal.status, total: proposal.total },
    ]);
  }

  // PERFORMANCE (audit 2026-07-09, swarm finding): previously called
  // Promise.all on every embedding in one shot — for a client with
  // 100+ threads that's 100+ concurrent Ollama requests, which Ollama
  // typically handles at 1-4 concurrency before rate-limiting or
  // crashing. Chunk in groups of OLLAMA_CONCURRENCY to bound fan-out.
  const OLLAMA_CONCURRENCY = 4;
  if (embeddingInputs.length === 0) {
    return {
      clientId,
      embeddingsCreated: 0,
      embeddingsReplaced: 0,
      existingEmbeddingsPreserved: true,
    };
  }

  const existing = await prismaClient.clientEmbedding.findMany({
    where: { clientId },
    select: { id: true },
  });
  const createdIds = [];
  try {
    for (let i = 0; i < embeddingInputs.length; i += OLLAMA_CONCURRENCY) {
      const chunk = embeddingInputs.slice(i, i + OLLAMA_CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((input) => storeEmbedding(...input, {
        prismaClient,
        generateEmbedding: options.generateEmbedding,
      })));
      createdIds.push(...settled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value.id));
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }

    if (existing.length > 0) {
      await prismaClient.clientEmbedding.deleteMany({
        where: { id: { in: existing.map((item) => item.id) }, clientId },
      });
    }
  } catch (error) {
    if (createdIds.length > 0) {
      await prismaClient.clientEmbedding.deleteMany({
        where: { id: { in: createdIds }, clientId },
      }).catch(() => {});
    }
    throw error;
  }

  return {
    clientId,
    embeddingsCreated: createdIds.length,
    embeddingsReplaced: existing.length,
  };
}
