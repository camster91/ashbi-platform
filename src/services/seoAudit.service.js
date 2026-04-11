// SEO Audit service
// Migrated from ashbi-hub raw SQL to Prisma

import { prisma } from '../index.js';
import aiClient from '../ai/client.js';

/**
 * Run an SEO audit using AI
 */
export async function runSeoAudit(data) {
  const { url, clientId, projectId } = data;

  const system = `You are an SEO expert with 10+ years of experience. Analyze the given URL and generate a comprehensive SEO audit covering:
1. Technical SEO (meta tags, headings, structured data, page speed indicators)
2. On-Page SEO (content quality, keyword usage, internal linking)
3. Content Quality (readability, uniqueness, relevance)
4. Recommendations (prioritized as High/Medium/Low)

Return a JSON object with: title, score (0-100), issues (array of {category, severity, description, suggestion}), keywords (array of suggested target keywords), summary`;

  const prompt = `Generate an SEO audit for:
URL: ${url}
${clientId ? `Client ID: ${clientId}` : ''}

Provide actionable, specific recommendations.`;

  const result = await aiClient.chatJSON({ system, prompt, temperature: 0.3 });

  // Save to database
  const audit = await prisma.sEOAudit.create({
    data: {
      url,
      title: result.title || `SEO Audit - ${url}`,
      score: result.score || 0,
      issues: JSON.stringify(result.issues || []),
      suggestions: JSON.stringify(result.recommendations || result.suggestions || []),
      keywords: JSON.stringify(result.keywords || []),
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      status: 'COMPLETED',
      aiGenerated: true
    },
    include: {
      client: { select: { id: true, name: true } }
    }
  });

  return audit;
}

/**
 * List audits for a client
 */
export async function getAudits(clientId, limit = 50, offset = 0) {
  return prisma.sEOAudit.findMany({
    where: clientId ? { clientId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      client: { select: { id: true, name: true } }
    }
  });
}

/**
 * Get a single audit
 */
export async function getAudit(id) {
  return prisma.sEOAudit.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } }
    }
  });
}

/**
 * Delete an audit
 */
export async function deleteAudit(id) {
  return prisma.sEOAudit.delete({ where: { id } });
}