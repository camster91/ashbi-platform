// Client Acquisition Funnel — public landing + intake + auto-lead pipeline
// Phase 1a: Landing page, intake form, auto-create lead + pipeline deal

import aiClient from '../ai/client.js';

export default async function clientAcquisitionRoutes(fastify) {

  // ─── GET /client-acquisition/config — brand settings for landing page ───────
  fastify.get('/config', async () => {
    // Public — no auth needed for landing page data
    const brand = await fastify.prisma.brandSettings.findFirst();
    const services = [
      { id: 'branding', title: 'Branding', description: 'Logo, color palettes, typography, brand guidelines — a complete visual identity for your CPG brand.', icon: 'Palette', features: ['Logo design', 'Brand guidelines', 'Color systems', 'Typography'] },
      { id: 'packaging', title: 'Packaging Design', description: 'Shelf-ready packaging that converts browsers into buyers. From concept to production-ready files.', icon: 'Package', features: ['Product packaging', 'Label design', 'Structural design', 'Print-ready files'] },
      { id: 'shopify', title: 'Shopify Development', description: 'Custom Shopify stores optimized for DTC conversion. Theme development, app integration, and speed optimization.', icon: 'ShoppingBag', features: ['Custom theme dev', 'App integration', 'Speed optimization', 'Product pages'] },
      { id: 'graphic-design', title: 'Graphic Design', description: 'Social media assets, email templates, ads, and all visual collateral for your brand.', icon: 'Image', features: ['Social media assets', 'Email templates', 'Ad creatives', 'Brand collateral'] },
    ];
    const portfolio = await fastify.prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, industry: true, logoUrl: true },
      take: 6,
      orderBy: { createdAt: 'desc' }
    }).catch(() => []);

    return {
      brand: brand ? {
        companyName: brand.companyName,
        tagline: 'We Build Brands That Sell',
        description: 'Ashbi Design is a Toronto-based creative studio specializing in branding, packaging, and Shopify development for CPG DTC companies. We help emerging brands look established and established brands stay relevant.',
        logoUrl: brand.logoUrl,
        primaryColor: brand.primaryColor,
        accentColor: brand.accentColor,
        email: brand.email || 'hello@ashbi.ca',
      } : {
        companyName: 'Ashbi Design',
        tagline: 'We Build Brands That Sell',
        description: 'Toronto-based creative studio for CPG DTC brands.',
        logoUrl: null,
        primaryColor: '#c9a84c',
        accentColor: '#1e293b',
        email: 'hello@ashbi.ca',
      },
      services,
      portfolio,
    };
  });

  // ─── POST /client-acquisition/intake — public intake submission ─────────────
  fastify.post('/intake', async (request, reply) => {
    const { companyName, industry, stage, needs, budgetRange, timeline, name, email, phone, notes } = request.body || {};

    if (!companyName || !email || !name) {
      return reply.status(400).send({ error: 'companyName, name, and email are required' });
    }

    // 1. Create or find client
    let client = await fastify.prisma.client.findFirst({
      where: { email }
    });

    if (!client) {
      client = await fastify.prisma.client.create({
        data: {
          name: companyName,
          email,
          phone: phone || null,
          industry: industry || 'CPG',
          status: 'LEAD',
          contactPerson: name,
          notes: notes || null,
          source: 'WEBSITE',
        }
      });
    }

    // 2. Save the intake form response
    const answers = {
      companyName, industry, stage, needs: Array.isArray(needs) ? needs.join(', ') : needs,
      budgetRange, timeline, name, email, phone, notes
    };

    await fastify.prisma.intakeFormResponse.create({
      data: {
        formId: 'website-intake',
        answers: JSON.stringify(answers),
        respondentName: name,
        respondentEmail: email,
        clientId: client.id,
      }
    });

    // 3. Get or create pipeline stage for NEW leads
    let leadStage = await fastify.prisma.pipelineStage.findFirst({
      where: { name: { contains: 'New Lead' } }
    });
    if (!leadStage) {
      leadStage = await fastify.prisma.pipelineStage.findFirst({
        orderBy: { order: 'asc' }
      });
    }

    // 4. Create pipeline deal
    if (leadStage) {
      await fastify.prisma.pipelineDeal.create({
        data: {
          title: `${companyName} — ${needs ? (Array.isArray(needs) ? needs[0] : needs.split(',')[0]) : 'New Inquiry'}`,
          value: 0,
          clientId: client.id,
          stageId: leadStage.id,
          probability: 10,
          contactPerson: name,
          source: 'WEBSITE',
          notes: `Submitted via website intake. Needs: ${Array.isArray(needs) ? needs.join(', ') : needs || 'Not specified'}. Budget: ${budgetRange || 'Not specified'}. Timeline: ${timeline || 'Not specified'}. Stage: ${stage || 'Not specified'}.`,
        }
      });
    }

    // 5. Log the activity
    await fastify.prisma.activity.create({
      data: {
        type: 'LEAD_INTAKE',
        description: `New lead from website: ${companyName} (${name})`,
        clientId: client.id,
        metadata: JSON.stringify({ source: 'WEBSITE', needs, budgetRange, timeline })
      }
    });

    return {
      success: true,
      clientId: client.id,
      message: 'Thanks! We\'ll be in touch within 24 hours.',
    };
  });

  // ─── Protected: list all incoming leads ─────────────────────────────────────

  // GET /client-acquisition/leads — list all website-acquired leads
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const leads = await fastify.prisma.client.findMany({
      where: { source: 'WEBSITE' },
      orderBy: { createdAt: 'desc' },
      include: {
        deals: {
          include: { stage: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { projects: true, invoices: true } }
      }
    });

    return leads.map(l => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      contactPerson: l.contactPerson,
      industry: l.industry,
      status: l.status,
      createdAt: l.createdAt,
      deal: l.deals[0] || null,
      projectCount: l._count.projects,
      invoiceCount: l._count.invoices,
    }));
  });
}
