// Social Content Agent — Content Generation + Scheduling
// AI-powered content creation with calendar scheduling and approval queue

import aiClient from '../ai/client.js';

export default async function socialContentRoutes(fastify) {
  const { prisma } = fastify;

  // POST /sonny/generate — generate content from brief
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic, type = 'instagram', tone, audience, notes } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const platformMap = {
      instagram: 'Instagram',
      linkedin: 'LinkedIn',
      facebook: 'Facebook',
      twitter: 'Twitter/X',
      carousel: 'Instagram Carousel',
    };

    const platformLabel = platformMap[type.toLowerCase()] || type;

    const system = `You are Ashbi Design's social content creator. You craft engaging, on-brand social media content for a Toronto-based CPG/DTC creative agency run by Cameron and Bianca. Your content sounds human, expert, and direct — never corporate or generic AI. You understand each platform's unique format and audience expectations.`;

    const prompt = `Create a ${platformLabel} post for Ashbi Design.

Brief:
- Topic: ${topic}
- Platform: ${platformLabel}
- Tone: ${tone || 'expert but approachable'}
- Target audience: ${audience || 'DTC brand founders and marketing managers'}
${notes ? `- Additional notes: ${notes}` : ''}

Ashbi Design specializes in CPG/DTC branding, packaging design, and Shopify/WooCommerce development.

${type.toLowerCase() === 'carousel' ? `For carousel: provide 5-7 slides with headline + body for each slide.

Return JSON:
{
  "content": "caption text with hashtags",
  "slides": [{"headline": "...", "body": "..."}],
  "imagePrompt": "image description for the cover slide",
  "platform": "${platformLabel}"
}` : `Format guidelines:
- Instagram: under 200 words, include hashtags
- LinkedIn: under 300 words, professional but human
- Facebook: under 200 words, conversational
- Twitter/X: under 280 characters

Return JSON:
{
  "content": "full post content with hashtags if applicable",
  "imagePrompt": "description for an image that pairs well with this post",
  "platform": "${platformLabel}"
}`}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.8 });
      return { ...result, topic, type };
    } catch (err) {
      fastify.log.error('Social-content generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate content', message: err.message });
    }
  });

  // GET /sonny/calendar — content calendar (scheduled + draft posts)
  fastify.get('/calendar', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { month, year } = request.query || {};

    const posts = await prisma.socialPost.findMany({
      orderBy: { scheduledAt: 'asc' },
      where: {
        status: { in: ['DRAFT', 'SCHEDULED', 'PUBLISHED'] }
      }
    });

    // Group by date for calendar view
    const calendar = {};
    for (const post of posts) {
      const dateKey = post.scheduledAt
        ? new Date(post.scheduledAt).toISOString().split('T')[0]
        : 'unscheduled';
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push(post);
    }

    return { calendar, total: posts.length, posts };
  });

  // POST /sonny/schedule — schedule a post (store in DB with platform + datetime + content)
  fastify.post('/schedule', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { platform, content, imagePrompt, scheduledAt, slides } = request.body || {};

    if (!platform || !content) {
      return reply.status(400).send({ error: 'platform and content are required' });
    }

    if (!scheduledAt) {
      return reply.status(400).send({ error: 'scheduledAt is required for scheduling' });
    }

    const post = await prisma.socialPost.create({
      data: {
        platform: platform.toUpperCase(),
        content,
        imagePrompt: imagePrompt || null,
        status: 'SCHEDULED',
        scheduledAt: new Date(scheduledAt),
      }
    });

    return post;
  });

  // POST /sonny/publish/:id — mark post as published
  fastify.post('/publish/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return reply.status(404).send({ error: 'Post not found' });

    const updated = await prisma.socialPost.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }
    });

    return updated;
  });

  // GET /sonny/posts — list all posts (with optional filters)
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { platform, status } = request.query || {};

    const where = {};
    if (platform) where.platform = platform.toUpperCase();
    if (status) where.status = status;

    const posts = await prisma.socialPost.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return posts;
  });

  // POST /sonny/save — save a draft post (for approval queue)
  fastify.post('/save', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { platform, content, imagePrompt, scheduledAt } = request.body || {};

    if (!platform || !content) {
      return reply.status(400).send({ error: 'platform and content are required' });
    }

    const post = await prisma.socialPost.create({
      data: {
        platform: platform.toUpperCase(),
        content,
        imagePrompt: imagePrompt || null,
        status: 'DRAFT',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      }
    });

    return post;
  });

  // PUT /sonny/approve/:id — approve a post (Cameron approval)
  fastify.put('/approve/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return reply.status(404).send({ error: 'Post not found' });

    const updated = await prisma.socialPost.update({
      where: { id },
      data: {
        status: post.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      }
    });

    return { ...updated, approved: true };
  });

  // PUT /sonny/posts/:id — update post content
  fastify.put('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { content, imagePrompt, platform, scheduledAt, status } = request.body || {};

    const data = {};
    if (content !== undefined) data.content = content;
    if (imagePrompt !== undefined) data.imagePrompt = imagePrompt;
    if (platform !== undefined) data.platform = platform.toUpperCase();
    if (scheduledAt !== undefined) data.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (status !== undefined) data.status = status;

    const post = await prisma.socialPost.update({
      where: { id },
      data
    });

    return post;
  });

  // DELETE /sonny/posts/:id — delete a post
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await prisma.socialPost.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
