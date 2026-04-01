// Content Writer Agent routes

import aiClient from '../ai/client.js';

export default async function contentWriterRoutes(fastify) {
  const { prisma } = fastify;

  // POST /content-agent/blog — generate blog post from topic/keywords
  fastify.post('/blog', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic, keywords, tone = 'authoritative' } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const system = `You are an expert content writer for Ashbi Design, a Toronto-based CPG/DTC creative agency. Write engaging, SEO-optimized content that demonstrates real industry expertise. Tone: ${tone}.`;

    const prompt = `Write a comprehensive blog post for Ashbi Design's website.

Topic: ${topic}
Keywords: ${keywords || 'none specified'}

Requirements:
- 1200-1800 words
- Clear H2/H3 structure
- Practical examples relevant to CPG/DTC brands
- CTA at the end (book a consultation with Ashbi Design)
- Written for brand owners and marketing managers

Return JSON:
{
  "title": "compelling blog title with keyword",
  "content": "full markdown blog post",
  "excerpt": "2-3 sentence summary",
  "metaDescription": "150-160 char SEO meta description",
  "suggestedTags": ["tag1", "tag2"]
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.6, maxTokens: 8192 });

      const draft = await prisma.contentDraft.create({
        data: {
          type: 'BLOG',
          title: result.title || topic,
          content: result.content,
          brief: topic,
          keywords: keywords || null,
          status: 'DRAFT'
        }
      });

      return { ...draft, excerpt: result.excerpt, metaDescription: result.metaDescription, suggestedTags: result.suggestedTags };
    } catch (err) {
      fastify.log.error('Content blog generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate blog post', message: err.message });
    }
  });

  // POST /content-agent/social — generate social captions
  fastify.post('/social', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { brief, platforms = ['LINKEDIN', 'INSTAGRAM', 'FACEBOOK'] } = request.body || {};

    if (!brief) return reply.status(400).send({ error: 'brief is required' });

    const system = `You are a social media expert for Ashbi Design, a Toronto-based CPG/DTC creative agency. Write platform-optimized captions that drive engagement. Use brand voice: confident, expert, approachable.`;

    const prompt = `Create social media captions for all requested platforms.

Brief: ${brief}
Platforms: ${platforms.join(', ')}

Return JSON:
{
  "captions": [
    {
      "platform": "LINKEDIN",
      "content": "full caption with hashtags",
      "characterCount": 123,
      "notes": "posting tips"
    },
    {
      "platform": "INSTAGRAM",
      "content": "full caption with hashtags",
      "characterCount": 123,
      "notes": "posting tips"
    },
    {
      "platform": "FACEBOOK",
      "content": "full caption",
      "characterCount": 123,
      "notes": "posting tips"
    }
  ]
}

LinkedIn: professional, thought-leadership, 1300 char max. Instagram: visual-focused, 30 hashtags, 2200 char max. Facebook: conversational, question-based, link-friendly.`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });

      const drafts = [];
      for (const caption of (result.captions || [])) {
        const draft = await prisma.contentDraft.create({
          data: {
            type: 'SOCIAL',
            title: brief.substring(0, 100),
            content: caption.content,
            platform: caption.platform,
            brief,
            status: 'DRAFT'
          }
        });
        drafts.push({ ...draft, notes: caption.notes, characterCount: caption.characterCount });
      }

      return { brief, drafts };
    } catch (err) {
      fastify.log.error('Content social generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate social captions', message: err.message });
    }
  });

  // POST /content-agent/linkedin-article — full LinkedIn article
  fastify.post('/linkedin-article', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic, angle, targetAudience = 'CPG/DTC brand owners' } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const system = `You are Cameron Ashley, founder of Ashbi Design, writing LinkedIn articles. Your style is direct, insightful, and backed by real agency experience. You specialize in CPG/DTC branding, packaging, and ecommerce.`;

    const prompt = `Write a LinkedIn article.

Topic: ${topic}
Angle: ${angle || 'share practical insights from agency experience'}
Target audience: ${targetAudience}

Requirements:
- 800-1200 words
- First person (Cameron's voice)
- Include a hook opening
- 3-5 key takeaways
- End with engagement question
- No fluff, all substance

Return JSON:
{
  "title": "article title",
  "content": "full article in markdown",
  "hookLine": "opening hook for preview",
  "hashtags": ["#tag1", "#tag2"]
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7, maxTokens: 6144 });

      const draft = await prisma.contentDraft.create({
        data: {
          type: 'LINKEDIN_ARTICLE',
          title: result.title || topic,
          content: result.content,
          platform: 'LINKEDIN',
          brief: topic,
          status: 'DRAFT'
        }
      });

      return { ...draft, hookLine: result.hookLine, hashtags: result.hashtags };
    } catch (err) {
      fastify.log.error('Content LinkedIn article error:', err);
      return reply.status(500).send({ error: 'Failed to generate LinkedIn article', message: err.message });
    }
  });

  // GET /content-agent/drafts — list all content drafts
  fastify.get('/drafts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type, status, platform } = request.query || {};

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (platform) where.platform = platform;

    const drafts = await prisma.contentDraft.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return drafts;
  });

  // GET /content-agent/drafts/:id — get single draft
  fastify.get('/drafts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const draft = await prisma.contentDraft.findUnique({
      where: { id: request.params.id }
    });
    if (!draft) return reply.status(404).send({ error: 'Draft not found' });
    return draft;
  });

  // PUT /content-agent/drafts/:id — update draft
  fastify.put('/drafts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { title, content, status } = request.body || {};

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (status !== undefined) {
      data.status = status;
      if (status === 'APPROVED') data.approvedAt = new Date();
      if (status === 'PUBLISHED') data.publishedAt = new Date();
    }

    const draft = await prisma.contentDraft.update({
      where: { id: request.params.id },
      data
    });

    return draft;
  });

  // DELETE /content-agent/drafts/:id
  fastify.delete('/drafts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.contentDraft.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
