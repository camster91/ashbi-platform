// Blog Agent routes

import aiClient from '../ai/client.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export default async function blogRoutes(fastify) {
  const { prisma } = fastify;

  // POST /blog/generate — generate full SEO blog post
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { title, keyword, saveAsDraft = true } = request.body || {};

    if (!title || !keyword) {
      return reply.status(400).send({ error: 'title and keyword are required' });
    }

    const system = `You are an expert SEO content writer for Ashbi Design, a Toronto-based CPG/DTC creative agency. You write authoritative, engaging blog posts optimized for search engines. Posts should be practical, specific, and demonstrate real expertise — not generic AI fluff. Use clear H2/H3 structure.`;

    const prompt = `Write a comprehensive 1500-word SEO blog post for Ashbi Design's website. Title: ${title}. Target keyword: ${keyword}. Ashbi Design is a Toronto-based CPG/DTC creative agency specializing in branding, packaging design, and ecommerce web development. Write for brand/marketing decision-makers at DTC brands. Include H2/H3 headers, practical examples, and a CTA at the end.

Return JSON with:
{
  "title": "${title}",
  "slug": "url-friendly-slug",
  "content": "full markdown content (1500+ words)",
  "excerpt": "2-3 sentence summary for SEO",
  "metaDescription": "150-160 char meta description with keyword"
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.6, maxTokens: 8192 });

      if (saveAsDraft) {
        const post = await prisma.blogPost.create({
          data: {
            title: result.title || title,
            slug: result.slug || slugify(title),
            content: result.content,
            excerpt: result.excerpt || null,
            status: 'DRAFT',
            targetKeyword: keyword,
            metaDescription: result.metaDescription || null,
          }
        });
        return { ...post, generated: true };
      }

      return { ...result, generated: true };
    } catch (err) {
      fastify.log.error('Blog generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate blog post', message: err.message });
    }
  });

  // POST /blog/keywords — generate keyword ideas
  fastify.post('/keywords', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { topic } = request.body || {};

    if (!topic) return reply.status(400).send({ error: 'topic is required' });

    const system = `You are an SEO specialist for a CPG/DTC creative agency. You generate targeted, realistic keyword ideas with commercial and informational intent.`;

    const prompt = `Generate 10 SEO keyword ideas for Ashbi Design's blog. Topic: ${topic}. Ashbi Design is a Toronto CPG/DTC creative agency specializing in branding, packaging design, and ecommerce web development.

Focus on keywords that:
- Have clear search intent (informational or commercial)
- Are relevant to DTC brand owners making decisions
- Mix short-tail and long-tail variations

Return JSON: { "keywords": [{ "keyword": "...", "intent": "informational|commercial", "difficulty": "low|medium|high", "notes": "why this works" }] }`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.5 });
      return { topic, ...result };
    } catch (err) {
      fastify.log.error('Blog keywords error:', err);
      return reply.status(500).send({ error: 'Failed to generate keywords', message: err.message });
    }
  });

  // GET /blog/posts — list all posts
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
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

  // GET /blog/posts/:id — get single post with content
  fastify.get('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await prisma.blogPost.findUnique({
      where: { id: request.params.id }
    });

    if (!post) return reply.status(404).send({ error: 'Post not found' });
    return post;
  });

  // PUT /blog/posts/:id — update post
  fastify.put('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, content, excerpt, status, targetKeyword, metaDescription, slug } = request.body || {};

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (excerpt !== undefined) data.excerpt = excerpt;
    if (status !== undefined) data.status = status;
    if (targetKeyword !== undefined) data.targetKeyword = targetKeyword;
    if (metaDescription !== undefined) data.metaDescription = metaDescription;
    if (slug !== undefined) data.slug = slug;

    const post = await prisma.blogPost.update({
      where: { id },
      data
    });

    return post;
  });

  // POST /blog/publish/:id — publish to WordPress
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
      return reply.status(500).send({ error: 'WordPress credentials not configured (ASHBI_WP_URL, ASHBI_WP_USER, ASHBI_WP_APP_PASSWORD)' });
    }

    try {
      const auth = Buffer.from(`${wpUser}:${wpPassword}`).toString('base64');
      const endpoint = `${wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`;

      const body = {
        title: post.title,
        content: post.content,
        excerpt: post.excerpt || '',
        slug: post.slug,
        status: 'publish',
        meta: {
          _yoast_wpseo_focuskw: post.targetKeyword || '',
          _yoast_wpseo_metadesc: post.metaDescription || '',
        }
      };

      // Update existing or create new
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
      fastify.log.error('Blog publish error:', err);
      return reply.status(500).send({ error: 'Failed to publish to WordPress', message: err.message });
    }
  });

  // DELETE /blog/posts/:id
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.blogPost.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
