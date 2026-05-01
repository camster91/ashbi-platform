// Ad Copy Generator service
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';

const PLATFORM_LIMITS = {
  GOOGLE: { headline: 30, description: 90 },
  FACEBOOK: { headline: 40, description: 125 },
  INSTAGRAM: { headline: 40, description: 125 },
  LINKEDIN: { headline: 50, description: 200 },
  TIKTOK: { headline: 30, description: 100 }
};

/**
 * Generate ad copy variants using AI
 */
export async function generateAdCopy(data) {
  const { clientId, platform = 'GOOGLE', product, audience, tone, keywords } = data;

  // Get client context if provided
  let clientContext = '';
  if (clientId) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, knowledgeBase: true }
    });
    if (client) {
      const kb = typeof client.knowledgeBase === 'string'
        ? JSON.parse(client.knowledgeBase)
        : client.knowledgeBase;
      clientContext = `\n\nClient: ${client.name}\nBrand context: ${JSON.stringify(kb)}`;
    }
  }

  const limits = PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.GOOGLE;

  const system = `You are a direct-response copywriter with proven ROI results. Generate ad copy that converts. Each variant must fit within the platform character limits: headline max ${limits.headline} chars, description max ${limits.description} chars.`;

  const prompt = `Generate 5 ad copy variants for the following:

Platform: ${platform}
Product/Service: ${product}
Target Audience: ${audience || 'general'}
Tone: ${tone || 'professional'}
Keywords: ${keywords || 'none'}
${clientContext}

Return a JSON array of objects with: headline, description, callToAction, toneVariant (professional/casual/urgent/friendly)`;

  const result = await aiClient.chatJSON({ system, prompt, temperature: 0.8 });

  const variants = Array.isArray(result) ? result : result.variants || result.options || [result];

  // Save to database
  const adCopy = await prisma.adCopy.create({
    data: {
      headline: variants[0]?.headline || 'Generated Ad',
      body: variants.map(v => `${v.headline}\n${v.description}`).join('\n\n---\n\n'),
      cta: variants[0]?.callToAction || 'Learn More',
      platform,
      audience: audience || undefined,
      tone: tone || 'professional',
      clientId: clientId || undefined,
      aiGenerated: true,
      status: 'DRAFT'
    }
  });

  return { adCopy, variants };
}

/**
 * List ad copies with optional filters
 */
export async function getAdCopies(filters = {}) {
  const { platform, status, clientId } = filters;

  const where = {};
  if (platform) where.platform = platform;
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;

  return prisma.adCopy.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Get a single ad copy
 */
export async function getAdCopy(id) {
  return prisma.adCopy.findUnique({ where: { id } });
}

/**
 * Update ad copy status
 */
export async function updateAdCopyStatus(id, status) {
  return prisma.adCopy.update({
    where: { id },
    data: { status }
  });
}

/**
 * Delete an ad copy
 */
export async function deleteAdCopy(id) {
  return prisma.adCopy.delete({ where: { id } });
}