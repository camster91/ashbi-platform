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

const PLATFORM_CHAR_LIMITS = {
  TWITTER: 280,
  LINKEDIN: 3000,
  FACEBOOK: 63206,
  INSTAGRAM: 2200,
  TIKTOK: 2200
};

/**
 * Format content for a specific platform
 */
export function formatPostForPlatform(content, platform, options = {}) {
  const { truncate = true, addHashtags = true } = options;
  const limit = PLATFORM_CHAR_LIMITS[platform] || 2200;
  let formatted = content;

  switch (platform) {
    case 'TWITTER': {
      // Twitter: truncate to 280, preserve hashtags
      const hashtagMatch = content.match(/#\w+/g);
      const hashtags = hashtagMatch ? hashtagMatch.join(' ') : '';
      const textOnly = content.replace(/#\w+/g, '').trim();
      const available = limit - hashtags.length - 1;
      const truncated = textOnly.length > available
        ? textOnly.substring(0, Math.max(available - 3, 0)) + '...'
        : textOnly;
      formatted = hashtags ? `${truncated}\n\n${hashtags}` : truncated;
      break;
    }
    case 'LINKEDIN': {
      // LinkedIn: preserve formatting, add line breaks, keep hashtags
      formatted = content
        .replace(/\n{3,}/g, '\n\n')  // max double line breaks
        .trim();
      if (formatted.length > limit && truncate) {
        formatted = formatted.substring(0, limit - 3) + '...';
      }
      break;
    }
    case 'INSTAGRAM': {
      // Instagram: auto-add newlines for readability, preserve hashtags
      const hashtagMatch = content.match(/#\w+/g);
      const hashtags = hashtagMatch ? hashtagMatch.join(' ') : '';
      const textOnly = content.replace(/#\w+/g, '').trim();
      // Add line breaks every ~100 chars for readability
      const withBreaks = textOnly.replace(/(.{100})/g, '$1\n').trim();
      formatted = hashtags ? `${withBreaks}\n\n${hashtags}` : withBreaks;
      if (formatted.length > limit && truncate) {
        formatted = formatted.substring(0, limit - 3) + '...';
      }
      break;
    }
    case 'FACEBOOK': {
      // Facebook: preserve content as-is, truncate if needed
      if (formatted.length > limit && truncate) {
        formatted = formatted.substring(0, limit - 3) + '...';
      }
      break;
    }
    case 'TIKTOK': {
      // TikTok: similar to Instagram but more casual
      const hashtagMatch = content.match(/#\w+/g);
      const hashtags = hashtagMatch ? hashtagMatch.join(' ') : '';
      const textOnly = content.replace(/#\w+/g, '').trim();
      formatted = hashtags ? `${textOnly}\n\n${hashtags}` : textOnly;
      if (formatted.length > limit && truncate) {
        formatted = formatted.substring(0, limit - 3) + '...';
      }
      break;
    }
    default:
      if (formatted.length > limit && truncate) {
        formatted = formatted.substring(0, limit - 3) + '...';
      }
  }

  return formatted;
}

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
 * Create/compose a social post with full options
 */
export async function createSocialPost(data) {
  const {
    platform = 'LINKEDIN',
    content,
    imageUrl,
    scheduledAt,
    status = 'DRAFT',
    clientId,
    projectId
  } = data;

  // Parse hashtags from content
  const hashtags = content.match(/#\w+/g) || [];
  const cleanContent = content.replace(/#\w+/g, '').trim();

  // Apply platform-specific formatting
  const formattedContent = formatPostForPlatform(content, platform, { truncate: true });

  return prisma.socialPost.create({
    data: {
      platform,
      content: formattedContent,
      imagePrompt: imageUrl || null,
      status,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      publishedAt: status === 'PUBLISHED' ? new Date() : null
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
 * Publish a social post (simulated - marks as PUBLISHED)
 * In production, this would call actual platform APIs
 */
export async function publishPost(id) {
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) throw new Error('Post not found');
  if (post.status === 'PUBLISHED') throw new Error('Post already published');

  // Apply platform-specific formatting before publishing
  const formatted = formatPostForPlatform(post.content, post.platform, { truncate: false });

  // In production: call actual platform API here
  // For now, just mark as published with formatted content
  return prisma.socialPost.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      content: formatted,
      publishedAt: new Date()
    }
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
  const [total, published, scheduled, drafts, failed] = await Promise.all([
    prisma.socialPost.count(),
    prisma.socialPost.count({ where: { status: 'PUBLISHED' } }),
    prisma.socialPost.count({ where: { status: 'SCHEDULED' } }),
    prisma.socialPost.count({ where: { status: 'DRAFT' } }),
    prisma.socialPost.count({ where: { status: 'FAILED' } })
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
    failed,
    byPlatform: byPlatform.map(p => ({ platform: p.platform, count: p._count }))
  };
}

/**
 * Process scheduled posts that are due (called by cron)
 * Returns posts that were published
 */
export async function processScheduledPosts() {
  const now = new Date();

  const duePosts = await prisma.socialPost.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now }
    }
  });

  const results = [];
  for (const post of duePosts) {
    try {
      const formatted = formatPostForPlatform(post.content, post.platform, { truncate: false });
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: 'PUBLISHED',
          content: formatted,
          publishedAt: new Date()
        }
      });
      results.push({ id: post.id, status: 'PUBLISHED' });
    } catch (err) {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'FAILED' }
      });
      results.push({ id: post.id, status: 'FAILED', error: err.message });
    }
  }

  return results;
}