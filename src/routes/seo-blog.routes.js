// SEO Blog Agent — SEO Blog Post Generator + Publisher
// AI-powered blog content with WordPress publishing to ashbi.ca

import aiClient from '../ai/client.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export default async function seoBlogRoutes(fastify) {
  const { prisma } = fastify;

  // POST /penny/blog — generate SEO blog post
  fastify.post('/blog', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic, keywords, targetAudience, wordCount = 1200 } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const system = `You are Ashbi Design's SEO content specialist. You write authoritative, engaging blog posts optimized for search engines. Posts are practical, specific, and demonstrate real expertise in CPG/DTC branding, packaging, and ecommerce — never generic AI fluff. You use clear H2/H3 structure, include actionable examples, and naturally weave in keywords.`;

    const targetWords = Math.max(800, Math.min(1500, wordCount));

    const prompt = `Write a comprehensive ${targetWords}-word SEO blog post for Ashbi Design's website (ashbi.ca).

Topic: ${topic}
Target keywords: ${keywords || topic}
Target audience: ${targetAudience || 'DTC brand founders and marketing decision-makers'}

Ashbi Design is a Toronto-based CPG/DTC creative agency specializing in branding, packaging design, and Shopify/WooCommerce ecommerce development. Run by Cameron Ashley.

Requirements:
- ${targetWords}+ words
- Clear H2/H3 structure (use ## and ### markdown)
- Practical examples and actionable advice
- Internal expertise demonstrated (not generic)
- CTA at the end directing readers to contact Ashbi Design
- Natural keyword placement

Return JSON:
{
  "title": "SEO-optimized title with primary keyword",
  "slug": "url-friendly-slug",
  "content": "full markdown content",
  "excerpt": "2-3 sentence summary for meta/social sharing",
  "metaDescription": "150-160 character meta description with primary keyword",
  "suggestedTags": ["tag1", "tag2", "tag3"]
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.6, maxTokens: 8192 });

      // Save as draft blog post
      const post = await prisma.blogPost.create({
        data: {
          title: result.title || topic,
          slug: result.slug || slugify(topic),
          content: result.content,
          excerpt: result.excerpt || null,
          status: 'DRAFT',
          targetKeyword: keywords || topic,
          metaDescription: result.metaDescription || null,
        }
      });

      return { ...post, suggestedTags: result.suggestedTags, generated: true };
    } catch (err) {
      fastify.log.error('SEO-blog generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate blog post', message: err.message });
    }
  });

  // GET /penny/posts — list all drafts + published
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status } = request.query || {};

    const where = {};
    if (status) where.status = status;

    const posts = await prisma.blogPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        status: true,
        targetKeyword: true,
        metaDescription: true,
        wordpressPostId: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return posts;
  });

  // GET /penny/posts/:id — get single post
  fastify.get('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await prisma.blogPost.findUnique({
      where: { id: request.params.id }
    });
    if (!post) return reply.status(404).send({ error: 'Post not found' });
    return post;
  });

  // PUT /penny/posts/:id — update post content
  fastify.put('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, content, excerpt, targetKeyword, metaDescription, slug } = request.body || {};

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (excerpt !== undefined) data.excerpt = excerpt;
    if (targetKeyword !== undefined) data.targetKeyword = targetKeyword;
    if (metaDescription !== undefined) data.metaDescription = metaDescription;
    if (slug !== undefined) data.slug = slug;

    const post = await prisma.blogPost.update({ where: { id }, data });
    return post;
  });

  // PUT /penny/approve/:id — approve post for publishing
  fastify.put('/approve/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const post = await prisma.blogPost.findUnique({ where: { id } });
    if (!post) return reply.status(404).send({ error: 'Post not found' });

    const updated = await prisma.blogPost.update({
      where: { id },
      data: { status: 'APPROVED' }
    });

    return { ...updated, approved: true };
  });

  // POST /penny/publish/:id — push to ashbi.ca via WordPress REST API
  fastify.post('/publish/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const post = await prisma.blogPost.findUnique({ where: { id } });
    if (!post) return reply.status(404).send({ error: 'Post not found' });

    const wpUrl = process.env.ASHBI_WP_URL;
    const wpUser = process.env.ASHBI_WP_USER;
    const wpPassword = process.env.ASHBI_WP_APP_PASSWORD;

    if (!wpUrl || !wpUser || !wpPassword) {
      return reply.status(500).send({
        error: 'WordPress credentials not configured (ASHBI_WP_URL, ASHBI_WP_USER, ASHBI_WP_APP_PASSWORD)'
      });
    }

    try {
      const auth = Buffer.from(`${wpUser}:${wpPassword}`).toString('base64');
      const endpoint = `${wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`;

      const body = {
        title: post.title,
        content: post.content,
        excerpt: post.excerpt || '',
        slug: post.slug,
        status: 'draft', // Push as draft to WP, Cameron publishes from WP admin
        meta: {
          _yoast_wpseo_focuskw: post.targetKeyword || '',
          _yoast_wpseo_metadesc: post.metaDescription || '',
        }
      };

      let wpRes;
      if (post.wordpressPostId) {
        wpRes = await fetch(`${endpoint}/${post.wordpressPostId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });
      } else {
        wpRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });
      }

      if (!wpRes.ok) {
        const errorData = await wpRes.text();
        return reply.status(502).send({ error: 'WordPress API error', details: errorData });
      }

      const wpData = await wpRes.json();

      const updated = await prisma.blogPost.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          wordpressPostId: String(wpData.id),
          publishedAt: new Date(),
        }
      });

      return { ...updated, wordpressUrl: wpData.link };
    } catch (err) {
      fastify.log.error('SEO-blog publish error:', err);
      return reply.status(500).send({ error: 'Failed to publish to WordPress', message: err.message });
    }
  });

  // DELETE /penny/posts/:id — delete a post
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await prisma.blogPost.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
