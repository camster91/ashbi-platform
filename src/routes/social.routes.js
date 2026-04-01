// Social Agent routes

import aiClient from '../ai/client.js';

export default async function socialRoutes(fastify) {
  const { prisma } = fastify;

  // POST /social/generate — generate post content with Gemini
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic, platform = 'INSTAGRAM' } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const platformLabel = platform === 'LINKEDIN' ? 'LinkedIn' : platform === 'FACEBOOK' ? 'Facebook' : 'Instagram';

    const system = `You are a social media content creator for Ashbi Design, a Toronto-based CPG/DTC creative agency run by Cameron and Bianca. You write engaging, authentic posts that sound human — not like they came from an AI content factory. The brand voice is expert but approachable, direct, never corporate.`;

    const prompt = `Write an ${platformLabel} post for Ashbi Design. Topic: ${topic}. Brand voice: expert but human, direct, not corporate. We work with CPG/DTC brands on branding, packaging, and Shopify/WooCommerce. Format for ${platformLabel}. Include relevant hashtags. Keep Instagram under 200 words, LinkedIn under 300 words. Return JSON with: { "content": "...", "imagePrompt": "a description for an image that would pair well with this post" }`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.8 });
      return { ...result, platform, topic };
    } catch (err) {
      fastify.log.error('Social generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate post', message: err.message });
    }
  });

  // POST /social/posts — save a post (draft)
  fastify.post('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { platform, content, imagePrompt, status = 'DRAFT', scheduledAt } = request.body || {};

    if (!platform || !content) {
      return reply.status(400).send({ error: 'platform and content are required' });
    }

    const post = await prisma.socialPost.create({
      data: {
        platform,
        content,
        imagePrompt: imagePrompt || null,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      }
    });

    return post;
  });

  // GET /social/posts — list all posts
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { platform, status } = request.query || {};

    const where = {};
    if (platform) where.platform = platform;
    if (status) where.status = status;

    const posts = await prisma.socialPost.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return posts;
  });

  // PUT /social/posts/:id — update post
  fastify.put('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { content, imagePrompt, status, scheduledAt, platform } = request.body || {};

    const data = {};
    if (content !== undefined) data.content = content;
    if (imagePrompt !== undefined) data.imagePrompt = imagePrompt;
    if (platform !== undefined) data.platform = platform;
    if (status !== undefined) {
      data.status = status;
      if (status === 'PUBLISHED') data.publishedAt = new Date();
    }
    if (scheduledAt !== undefined) data.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const post = await prisma.socialPost.update({
      where: { id },
      data
    });

    return post;
  });

  // DELETE /social/posts/:id — delete post
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    await prisma.socialPost.delete({ where: { id } });
    return { deleted: true };
  });
}
