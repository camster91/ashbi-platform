// Creative Brief Generator service
// Migrated from ashbi-hub raw SQL to Prisma
// Enhanced with Client Brain RAG context

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';
import { searchSimilar } from './embedding.service.js';

/**
 * Generate a creative brief using AI with RAG context
 */
export async function generateCreativeBrief(data) {
  const { clientId, projectType, notes } = data;

  // Get client context
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, knowledgeBase: true }
  });

  if (!client) throw new Error('Client not found');

  // Get relevant context from Client Brain (RAG)
  let ragContext = '';
  try {
    const searchResults = await searchSimilar(
      `${projectType} ${notes} ${client.name}`,
      3,
      clientId
    );
    if (searchResults.length > 0) {
      ragContext = '\n\nRelevant client context:\n' + searchResults
        .map(r => `- [${r.source}]: ${r.content}`)
        .join('\n');
    }
  } catch (e) {
    // RAG not available, continue without context
    console.warn('RAG context unavailable for creative brief:', e.message);
  }

  // Get brand guidelines if available
  const brandSettings = await prisma.brandSettings.findFirst();
  let brandContext = '';
  if (brandSettings) {
    brandContext = `\n\nBrand: ${brandSettings.companyName}, Primary: ${brandSettings.primaryColor}, Accent: ${brandSettings.accentColor}`;
  }

  const system = `You are an expert creative director with 15+ years of experience creating briefs that lead to award-winning work. Generate a comprehensive creative brief with these sections:
1. Overview
2. Objectives
3. Target Audience
4. Key Message
5. Tone & Style
6. Deliverables
7. Timeline
8. Success Metrics
9. Budget Considerations
10. Stakeholders`;

  const prompt = `Create a creative brief for:
Client: ${client.name}
Project Type: ${projectType}
Notes: ${notes || 'No additional notes'}
${ragContext}${brandContext}

Return a JSON object with each section as a key, containing detailed content.`;

  const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });

  // Save to database
  const brief = await prisma.creativeBrief.create({
    data: {
      title: `${projectType} Brief - ${client.name}`,
      clientId,
      objective: result.Overview || result.objective,
      targetAudience: JSON.stringify(result.TargetAudience || result.targetAudience || {}),
      tone: result.ToneStyle || result.tone || 'professional',
      deliverables: JSON.stringify(result.Deliverables || []),
      references: JSON.stringify(result.references || []),
      constraints: JSON.stringify({
        budget: result.BudgetConsiderations || result.budget,
        timeline: result.Timeline || result.timeline
      }),
      status: 'DRAFT',
      aiGenerated: true
    },
    include: {
      client: { select: { id: true, name: true } }
    }
  });

  return { brief, aiContent: result };
}

/**
 * List briefs for a client
 */
export async function getBriefs(clientId, limit = 50, offset = 0) {
  return prisma.creativeBrief.findMany({
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
 * Get a single brief
 */
export async function getBrief(id) {
  return prisma.creativeBrief.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } }
    }
  });
}

/**
 * Update a brief
 */
export async function updateBrief(id, data) {
  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.objective !== undefined) updateData.objective = data.objective;
  if (data.targetAudience !== undefined) updateData.targetAudience = typeof data.targetAudience === 'string' ? data.targetAudience : JSON.stringify(data.targetAudience);
  if (data.tone !== undefined) updateData.tone = data.tone;
  if (data.deliverables !== undefined) updateData.deliverables = typeof data.deliverables === 'string' ? data.deliverables : JSON.stringify(data.deliverables);
  if (data.constraints !== undefined) updateData.constraints = typeof data.constraints === 'string' ? data.constraints : JSON.stringify(data.constraints);
  if (data.status !== undefined) updateData.status = data.status;

  return prisma.creativeBrief.update({
    where: { id },
    data: updateData,
    include: {
      client: { select: { id: true, name: true } }
    }
  });
}

/**
 * Delete a brief
 */
export async function deleteBrief(id) {
  return prisma.creativeBrief.delete({ where: { id } });
}