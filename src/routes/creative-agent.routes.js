// Creative Agent Routes — CPG/DTC copy, brand guidelines, design briefs

import { getProvider } from '../ai/providers/index.js';

const ASHBI_BRAND_VOICE = `Ashbi Design is a Toronto CPG/DTC branding agency founded by Cameron & Bianca.
Brand voice: expert yet human, confident without being corporate, warm and direct.
Specialties: packaging design, brand identity, Shopify/WooCommerce, digital marketing.
Clients: supplement brands, skincare, food/beverage, lifestyle products.`;

export default async function creativeAgentRoutes(fastify) {
  // POST /api/creative/copy/generate — generate CPG/DTC copy
  fastify.post('/copy/generate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      brand,
      product,
      copyType = 'product_description',
      tone = 'energetic',
      audience,
      keyBenefits,
      wordCount = 150,
      platform
    } = request.body || {};

    if (!product) {
      return reply.status(400).send({ error: 'product is required' });
    }

    const copyTypes = {
      product_description: 'product description',
      ad_copy: 'ad copy (headline + body)',
      email_subject: 'email subject lines (5 variations)',
      social_caption: 'social media caption',
      landing_page: 'landing page hero section',
      packaging: 'packaging copy (front panel)',
    };

    try {
      const ai = getProvider();
      const prompt = `${ASHBI_BRAND_VOICE}

Write ${copyTypes[copyType] || copyType} for:
Brand: ${brand || 'the client'}
Product: ${product}
Tone: ${tone}
Target Audience: ${audience || 'health-conscious consumers 25-45'}
Key Benefits: ${keyBenefits || 'premium quality, effective results'}
Platform: ${platform || 'general'}
Approximate word count: ${wordCount}

Make it punchy, benefit-driven, and conversion-focused. No filler words.`;

      const copy = await ai.generate(prompt, { maxTokens: 800 });

      return {
        copy,
        metadata: {
          brand,
          product,
          copyType,
          tone,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate copy', details: err.message });
    }
  });

  // GET /api/creative/brand/guidelines — Ashbi brand guidelines
  fastify.get('/brand/guidelines', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return {
      brand: 'Ashbi Design',
      tagline: 'Brands That Move Product',
      colors: {
        primary: '#1A1A2E',
        accent: '#E94560',
        light: '#F5F5F5',
        warm: '#F5A623'
      },
      typography: {
        heading: 'Playfair Display or similar serif',
        body: 'Inter or similar sans-serif',
        accent: 'Montserrat for all-caps labels'
      },
      voice: {
        tone: ['Expert', 'Human', 'Direct', 'Warm'],
        avoid: ['Corporate jargon', 'Buzzwords', 'Passive voice'],
        examples: {
          good: 'Your brand deserves more than a template.',
          avoid: 'We leverage innovative solutions to optimize your brand synergy.'
        }
      },
      retainerTiers: {
        starter: { price: 999, includes: ['Monthly strategy', 'Up to 4 designs', '1 revision round'] },
        growth: { price: 1999, includes: ['Bi-weekly strategy', 'Up to 8 designs', '2 revision rounds', 'Social content'] },
        scale: { price: 3999, includes: ['Weekly strategy', 'Unlimited designs', '3 revision rounds', 'Full marketing suite'] }
      },
      specialties: ['CPG packaging', 'DTC brand identity', 'Shopify/WooCommerce', 'Digital ads', 'Email marketing'],
      updatedAt: new Date().toISOString()
    };
  });

  // POST /api/creative/design-brief/generate — generate a design brief
  fastify.post('/design-brief/generate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      clientName,
      projectType,
      industry,
      targetAudience,
      brandPersonality,
      competitorBrands,
      deliverables,
      timeline,
      notes
    } = request.body || {};

    if (!clientName || !projectType) {
      return reply.status(400).send({ error: 'clientName and projectType are required' });
    }

    try {
      const ai = getProvider();
      const prompt = `${ASHBI_BRAND_VOICE}

Create a comprehensive design brief for Ashbi Design to present to the client team.

Client: ${clientName}
Project: ${projectType}
Industry: ${industry || 'CPG/DTC'}
Target Audience: ${targetAudience || 'Not specified'}
Brand Personality: ${brandPersonality || 'To be defined'}
Competitor Brands: ${competitorBrands || 'None provided'}
Deliverables: ${deliverables || 'Standard package'}
Timeline: ${timeline || 'To be determined'}
Additional Notes: ${notes || 'None'}

Structure the brief with:
1. Project Overview
2. Brand Objectives
3. Target Audience Persona
4. Visual Direction / Mood
5. Deliverables Checklist
6. Success Metrics
7. Open Questions for Client`;

      const brief = await ai.generate(prompt, { maxTokens: 1500 });

      return {
        brief,
        metadata: {
          clientName,
          projectType,
          generatedAt: new Date().toISOString()
        },
        tip: 'Save this brief as a note on the client\'s project in Hub'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate design brief', details: err.message });
    }
  });
}
