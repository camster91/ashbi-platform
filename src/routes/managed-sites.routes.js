import { validateBody, createManagedSiteSchema, importManagedSitesSchema } from '../validators/schemas.js';

export function canonicalManagedSiteUrl(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

function siteData(input) {
  return {
    ...input,
    url: canonicalManagedSiteUrl(input.url),
    clientId: input.clientId || null,
    source: input.source || null,
    notes: input.notes || null,
  };
}

export default async function managedSiteRoutes(fastify) {
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const sites = await request.prisma.managedSite.findMany({
      include: { client: { select: { id: true, name: true, domain: true } } },
      orderBy: [{ host: 'asc' }, { name: 'asc' }],
    });

    return { sites, total: sites.length };
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(createManagedSiteSchema),
  }, async (request, reply) => {
    const data = siteData(request.body);
    const existing = await request.prisma.managedSite.findFirst({ where: { url: data.url } });
    if (existing) return reply.status(409).send({ error: 'This site is already in the inventory' });

    const site = await request.prisma.managedSite.create({ data });
    return reply.status(201).send({ site });
  });

  // Bulk import is intentionally idempotent: it creates only URLs that are
  // not already in this organization's inventory and never changes clients,
  // lifecycle, or metadata on an existing site.
  fastify.post('/import', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(importManagedSitesSchema),
  }, async (request, reply) => {
    const normalized = request.body.sites.map(siteData);
    const distinct = [...new Map(normalized.map((site) => [site.url, site])).values()];
    const existing = await request.prisma.managedSite.findMany({
      where: { url: { in: distinct.map((site) => site.url) } },
      select: { url: true },
    });
    const existingUrls = new Set(existing.map((site) => site.url));
    const toCreate = distinct.filter((site) => !existingUrls.has(site.url));

    if (!toCreate.length) {
      return reply.status(200).send({ created: 0, skipped: distinct.length, sites: [] });
    }

    const created = await request.prisma.$transaction((tx) => Promise.all(
      toCreate.map((data) => tx.managedSite.create({ data })),
    ));
    return reply.status(201).send({ created: created.length, skipped: distinct.length - created.length, sites: created });
  });
}
