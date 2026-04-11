// Embedding service - pgvector-based RAG for Client Brain
// Migrated from ashbi-hub raw SQL to Prisma with $queryRaw for vector ops

import { prisma } from '../index.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Generate an embedding vector using Ollama
 */
export async function generateEmbedding(text) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.embedding;
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
 * Search for similar content using pgvector cosine similarity
 */
export async function searchSimilar(query, limit = 5, clientId = null) {
  const queryEmbedding = await generateEmbedding(query);

  const whereClause = clientId
    ? prisma.sql`WHERE ce."clientId" = ${clientId}`
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
    ${whereClause}
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

  await Promise.all(embeddingPromises);

  return { clientId, embeddingsCreated: embeddingPromises.length };
}