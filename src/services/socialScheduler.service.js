// Social Scheduler service
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';

const PLATFORM_LIMITS = {
  TWITTER: 280,
  LINKEDIN: 3000,
  INSTAGRAM: 2200,
  FACEBOOK: 2200,
  TIKTOK: 2200
};

/**
 * Generate social media posts using AI
 */
export async function generatePosts(data) {
  const { platform = 'LINKEDIN', topic, tone = 'professional', count = 5 } = data;

  const charLimit = PLATFORM_LIMITS[platform] || 2200;

  const system = `You are a viral social media strategist with 10M+ reach across platforms. Generate engaging social media posts that drive interaction and conversions.`;

  const prompt = `Generate ${count} social media posts for:
Platform: ${platform}
Topic: ${topic}
Tone: ${tone}
Max characters per post: ${charLimit}

Return a JSON array of objects with: content (the post text), hashtags (array of hashtags), suggestedTime (best time to post).`;

  const result = await aiClient.chatJSON({ system, prompt, temperature: 0.8 });
  const posts = Array.isArray(result) ? result : result.posts || result.options || [result];

  return posts;
}

/**
 * Schedule a social media post
 */
export async function schedulePost(data) {
  const { platform, content, clientId, projectId, scheduledAt } = data;

  // Parse hashtags from content
  const hashtags = content.match(/#\w+/g) || [];
  const cleanContent = content.replace(/#\w+/g, '').trim();

  return prisma.socialPost.create({
    data: {
      platform: platform || 'LINKEDIN',
      content: cleanContent,
      imagePrompt: hashtags.length > 0 ? `Visual for: ${hashtags.join(' ')}` : null,
      status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    }
  });
}

/**
 * Get scheduled posts with filters
 */
export async function getScheduledPosts(filters = {}) {
  const { platform, status } = filters;

  const where = {};
  if (platform) where.platform = platform;
  if (status) where.status = status;

  return prisma.socialPost.findMany({
    where,
    orderBy: { scheduledAt: 'asc' }
  });
}

/**
 * Get a single post
 */
export async function getPost(id) {
  return prisma.socialPost.findUnique({ where: { id } });
}

/**
 * Update post status
 */
export async function updatePostStatus(id, status) {
  const data = { status };
  if (status === 'PUBLISHED') data.publishedAt = new Date();

  return prisma.socialPost.update({
    where: { id },
    data
  });
}

/**
 * Delete a post
 */
export async function deletePost(id) {
  return prisma.socialPost.delete({ where: { id } });
}

/**
 * Get analytics for social posts
 */
export async function getSocialAnalytics() {
  const [total, published, scheduled, drafts] = await Promise.all([
    prisma.socialPost.count(),
    prisma.socialPost.count({ where: { status: 'PUBLISHED' } }),
    prisma.socialPost.count({ where: { status: 'SCHEDULED' } }),
    prisma.socialPost.count({ where: { status: 'DRAFT' } })
  ]);

  const byPlatform = await prisma.socialPost.groupBy({
    by: ['platform'],
    _count: true
  });

  return {
    total,
    published,
    scheduled,
    drafts,
    byPlatform: byPlatform.map(p => ({ platform: p.platform, count: p._count }))
  };
}