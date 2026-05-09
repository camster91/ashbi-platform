/**
 * Proposal Builder Agent for ashbi-platform
 * AI generates branded proposals from lead intake data, exports as PDF, creates Gmail draft
 */

import { createDraft } from './gmail-draft.agent.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Pricing tiers (hardcoded for now, can be updated via UI)
const PRICING_TIERS = {
  branding: {
    lite: { name: 'Branding Lite', price: 1500 },
    full: { name: 'Branding Full', price: 3500 },
    premium: { name: 'Branding Premium', price: 6000 }
  },
  packaging: {
    design: { name: 'Packaging Design', price: 2000 },
    printReady: { name: 'Packaging + Print Ready', price: 3500 }
  },
  shopify: {
    basic: { name: 'Shopify Basic', price: 2500 },
    standard: { name: 'Shopify Standard', price: 4500 },
    advanced: { name: 'Shopify Advanced', price: 7500 }
  }
};

// Proposal templates
const PROPOSAL_TEMPLATES = [
  { id: 'ashbi-branding', name: 'Ashbi Branding', description: 'Full branding proposal with logo, identity, and brand guidelines' },
  { id: 'ashbi-packaging', name: 'Ashbi Packaging', description: 'Product packaging design proposal with print specifications' },
  { id: 'ashbi-shopify', name: 'Ashbi Shopify', description: 'E-commerce store setup proposal with theme customization' },
  { id: 'generic', name: 'Generic', description: 'General-purpose proposal template' }
];

// Proposal statuses
const PROPOSAL_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED'
};

// AI Client import - uses ../ai/client.js
let aiClient = null;
try {
  const mod = await import('../ai/client.js');
  aiClient = mod.default || mod;
} catch (err) {
  console.warn('AI client not found, proposal generation will use fallback');
}

/**
 * Determine recommended pricing tiers based on project type and lead's budget
 * @param {string} projectType - Type of project (branding, packaging, shopify)
 * @param {number} budget - Lead's stated budget
 * @returns {Array} Array of recommended pricing tier objects
 */
function getRecommendedTiers(projectType, budget) {
  const tiers = [];
  const normalizedType = (projectType || '').toLowerCase();

  if (normalizedType.includes('brand') || normalizedType.includes('logo') || normalizedType.includes('identity')) {
    if (budget >= 6000) {
      tiers.push(PRICING_TIERS.branding.premium);
    }
    if (budget >= 3500) {
      tiers.push(PRICING_TIERS.branding.full);
    }
    if (budget >= 1500 || tiers.length === 0) {
      tiers.push(PRICING_TIERS.branding.lite);
    }
  } else if (normalizedType.includes('packag')) {
    if (budget >= 3500) {
      tiers.push(PRICING_TIERS.packaging.printReady);
    }
    if (budget >= 2000 || tiers.length === 0) {
      tiers.push(PRICING_TIERS.packaging.design);
    }
  } else if (normalizedType.includes('shopify') || normalizedType.includes('woo')) {
    if (budget >= 7500) {
      tiers.push(PRICING_TIERS.shopify.advanced);
    }
    if (budget >= 4500) {
      tiers.push(PRICING_TIERS.shopify.standard);
    }
    if (budget >= 2500 || tiers.length === 0) {
      tiers.push(PRICING_TIERS.shopify.basic);
    }
  } else {
    // Default: show all tiers
    tiers.push(PRICING_TIERS.branding.full, PRICING_TIERS.packaging.design, PRICING_TIERS.shopify.standard);
  }

  return tiers;
}

/**
 * Build the proposal HTML document
 * @param {object} proposalData - Generated proposal data
 * @param {object} leadData - Original lead information
 * @returns {string} HTML string for the proposal
 */
function buildProposalHtml(proposalData, leadData) {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const validUntil = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposal: ${proposalData.title || 'Project Proposal'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.6; background: #fff; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px; }
    .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 24px; margin-bottom: 40px; }
    .logo { font-size: 28px; font-weight: 700; letter-spacing: -1px; }
    .proposal-title { font-size: 32px; font-weight: 600; margin: 24px 0 8px; }
    .proposal-meta { color: #666; font-size: 14px; }
    .client-info { background: #f7f7f7; padding: 20px; border-radius: 4px; margin-bottom: 32px; }
    .client-info h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 12px; }
    .section { margin-bottom: 40px; }
    .section h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
    .section p { margin-bottom: 12px; }
    .scope-item { padding: 12px 0; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; }
    .scope-item:last-child { border-bottom: none; }
    .timeline-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .timeline-table th, .timeline-table td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e5e5; }
    .timeline-table th { background: #f7f7f7; font-weight: 600; }
    .pricing-tier { border: 1px solid #e5e5e5; border-radius: 4px; padding: 20px; margin-bottom: 16px; }
    .pricing-tier.selected { border-color: #1a1a1a; background: #fafafa; }
    .pricing-tier h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .pricing-tier .price { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .pricing-tier .features { color: #666; font-size: 14px; }
    .terms { background: #f9f9f9; padding: 20px; border-radius: 4px; font-size: 14px; }
    .terms ul { margin-left: 20px; margin-top: 8px; }
    .terms li { margin-bottom: 6px; }
    .cta { text-align: center; padding: 40px; background: #1a1a1a; color: #fff; border-radius: 4px; margin-top: 40px; }
    .cta h2 { color: #fff; border: none; padding: 0; margin-bottom: 12px; }
    .cta p { color: rgba(255,255,255,0.8); margin-bottom: 20px; }
    .cta-button { display: inline-block; background: #fff; color: #1a1a1a; padding: 14px 32px; text-decoration: none; font-weight: 600; border-radius: 4px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; text-align: center; }
    .tracking-pixel { width: 1px; height: 1px; display: block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ASHBI</div>
      <h1 class="proposal-title">${proposalData.title || 'Project Proposal'}</h1>
      <div class="proposal-meta">
        Prepared for ${leadData.name}${leadData.company ? `, ${leadData.company}` : ''} &nbsp;|&nbsp; ${today}
      </div>
    </div>

    <div class="client-info">
      <h3>Prepared For</h3>
      <p><strong>${leadData.name}</strong></p>
      ${leadData.company ? `<p>${leadData.company}</p>` : ''}
      <p>${leadData.email}</p>
    </div>

    <div class="section">
      <h2>Executive Summary</h2>
      <p>${proposalData.executiveSummary || proposalData.summary || 'Thank you for considering Ashbi for your project. We look forward to delivering exceptional results.'}</p>
    </div>

    <div class="section">
      <h2>Our Approach</h2>
      <p>${proposalData.approach || 'We take a strategic, data-driven approach to every project. Our process is collaborative, transparent, and focused on delivering measurable outcomes that align with your business goals.'}</p>
    </div>

    <div class="section">
      <h2>Scope of Work</h2>
      ${proposalData.scopeOfWork ? proposalData.scopeOfWork.map(item => `
        <div class="scope-item">
          <span>${item.description || item}</span>
        </div>
      `).join('') : '<p>Detailed scope to be defined based on selected package.</p>'}
    </div>

    <div class="section">
      <h2>Timeline</h2>
      <table class="timeline-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Duration</th>
            <th>Deliverables</th>
          </tr>
        </thead>
        <tbody>
          ${proposalData.timeline ? proposalData.timeline.map(phase => `
            <tr>
              <td>${phase.name}</td>
              <td>${phase.duration || 'TBD'}</td>
              <td>${phase.deliverables || 'TBD'}</td>
            </tr>
          `).join('') : `
            <tr>
              <td>Discovery & Strategy</td>
              <td>1-2 weeks</td>
              <td>Research, brief, strategy document</td>
            </tr>
            <tr>
              <td>Design & Development</td>
              <td>2-4 weeks</td>
              <td>Concepts, revisions, final files</td>
            </tr>
            <tr>
              <td>Delivery & Support</td>
              <td>1 week</td>
              <td>Final assets, documentation, support</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Pricing</h2>
      ${proposalData.pricingTiers ? proposalData.pricingTiers.map((tier, i) => `
        <div class="pricing-tier ${i === 0 ? 'selected' : ''}">
          <h3>${tier.name}</h3>
          <div class="price">$${tier.price.toLocaleString()}</div>
          <div class="features">${tier.features || 'See scope of work for details'}</div>
        </div>
      `).join('') : `
        <div class="pricing-tier selected">
          <h3>${proposalData.selectedTier?.name || 'Custom Package'}</h3>
          <div class="price">$${(proposalData.selectedTier?.price || 0).toLocaleString()}</div>
        </div>
      `}
    </div>

    <div class="section">
      <h2>Terms & Conditions</h2>
      <div class="terms">
        <ul>
          <li>50% deposit required to begin work</li>
          <li>Balance due upon project completion</li>
          <li>Revisions included as specified in scope</li>
          <li>Additional revisions billed at hourly rate</li>
          <li>Proposal valid until ${validUntil}</li>
          <li>${proposalData.terms || 'Payment terms: Net 30 days'}</li>
        </ul>
      </div>
    </div>

    <div class="cta">
      <h2>Ready to Move Forward?</h2>
      <p>We're excited to collaborate with you. Accept this proposal to get started.</p>
      <a href="#" class="cta-button">Accept Proposal</a>
    </div>

    <div class="footer">
      <p>Ashbi &nbsp;|&nbsp; Toronto, ON &nbsp;|&nbsp; hello@ashbi.design</p>
      <p>Proposal ID: ${proposalData.id || 'DRAFT'} &nbsp;|&nbsp; Valid until ${validUntil}</p>
      ${proposalData.trackingId ? `<img src="https://api.ashbi.design/track/${proposalData.trackingId}" class="tracking-pixel" alt="">` : ''}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate a full proposal from lead data using AI
 * @param {object} leadData - Lead information { name, company, email, projectType, budget, timeline }
 * @returns {Promise<object>} Generated proposal data with HTML
 */
async function generateProposal(leadData) {
  const {
    name,
    company,
    email,
    projectType,
    budget,
    timeline,
    notes
  } = leadData;

  const budgetNum = parseFloat(budget) || 0;
  const recommendedTiers = getRecommendedTiers(projectType, budgetNum);

  const systemPrompt = `You are a proposal writer for Ashbi Design, a Toronto-based CPG/DTC creative agency. 
You create professional, direct proposals with no fluff. Ashbi specializes in branding, packaging design, and Shopify/WooCommerce web development.
Brand voice: confident, professional, no salesy language. Focus on value and outcomes.`;

  const userPrompt = `Generate a proposal for a potential client.

Client: ${name}
Company: ${company || 'Not specified'}
Email: ${email}
Project type: ${projectType || 'custom project'}
Budget: ${budget ? `$${budgetNum.toLocaleString()}` : 'Not specified'}
Timeline: ${timeline || 'To be determined'}
${notes ? `Additional context: ${notes}` : ''}

Return JSON with these exact fields:
{
  "title": "Proposal title",
  "executiveSummary": "2-3 paragraph executive summary",
  "approach": "Our approach paragraph",
  "scopeOfWork": [{"description": "deliverable"}],
  "timeline": [{"name": "phase name", "duration": "1-2 weeks", "deliverables": "what's delivered"}],
  "selectedTier": {"name": "tier name", "price": 0},
  "terms": "Additional terms if any"
}`;

  let proposalData = {
    title: `Proposal for ${name}${company ? ` - ${company}` : ''}`,
    executiveSummary: `We appreciate the opportunity to present this proposal for your ${projectType || 'project'} needs. Our team is ready to deliver exceptional results that align with your business objectives.`,
    approach: 'We take a strategic, data-driven approach to every project. Our process is collaborative, transparent, and focused on delivering measurable outcomes.',
    scopeOfWork: recommendedTiers[0] ? [
      { description: `Full ${recommendedTiers[0].name} package as specified` }
    ] : [],
    timeline: [
      { name: 'Discovery & Strategy', duration: '1-2 weeks', deliverables: 'Research, brief, strategy document' },
      { name: 'Design & Development', duration: '2-4 weeks', deliverables: 'Concepts, revisions, final files' },
      { name: 'Delivery & Support', duration: '1 week', deliverables: 'Final assets, documentation' }
    ],
    selectedTier: recommendedTiers[0] || { name: 'Custom Package', price: 0 },
    pricingTiers: recommendedTiers,
    terms: null
  };

  // Try AI generation
  if (aiClient && aiClient.chatJSON) {
    try {
      const aiResult = await aiClient.chatJSON({ system: systemPrompt, prompt: userPrompt, temperature: 0.5 });
      if (aiResult) {
        proposalData = { ...proposalData, ...aiResult };
        if (!proposalData.pricingTiers) {
          proposalData.pricingTiers = recommendedTiers;
        }
      }
    } catch (err) {
      console.warn('AI proposal generation failed, using fallback:', err.message);
    }
  }

  const html = buildProposalHtml(proposalData, leadData);

  return {
    ...proposalData,
    html,
    leadData,
    recommendedTiers,
    createdAt: new Date().toISOString()
  };
}

/**
 * Generate PDF from proposal HTML
 * Uses pdfkit for reliable server-side PDF generation
 * @param {string} proposalHtml - HTML string of the proposal
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generatePdf(proposalHtml) {
  try {
    const { default: PDFDocument } = await import('pdfkit');
    
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Basic text extraction from HTML for PDF (simplified)
      // In production, use a proper HTML-to-PDF service
      const plainText = proposalHtml
        .replace(/<style>[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Parse and write content - simplified for PDF
      const lines = plainText.split('\n').filter(l => l.trim());
      let y = 50;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimed) continue;
        
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        // Check for headers (all caps or specific patterns)
        if (trimmed === trimmed.toUpperCase() && trimmed.length < 50 && trimmed.length > 3) {
          doc.fontSize(14).font('Helvetica-Bold');
          y += 5;
        } else if (trimmed.startsWith('ASHBI')) {
          doc.fontSize(24).font('Helvetica-Bold');
        } else {
          doc.fontSize(11).font('Helvetica');
        }

        // Word wrap
        const maxWidth = 500;
        const words = trimmed.split(' ');
        let currentLine = '';

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = doc.widthOfString(testLine);
          
          if (testWidth > maxWidth && currentLine) {
            doc.text(currentLine, 50, y, { width: maxWidth });
            y += 16;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine) {
          doc.text(currentLine, 50, y, { width: maxWidth });
          y += 16;
        }
      }

      doc.end();
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}

/**
 * Create a Gmail draft with the proposal attached
 * @param {object} proposal - Proposal data with HTML and metadata
 * @param {string} leadEmail - Recipient email address
 * @returns {Promise<object>} Draft creation result
 */
async function createProposalDraft(proposal, leadEmail) {
  try {
    // Generate PDF
    const pdfBuffer = await generatePdf(proposal.html);

    // Build email body
    const subject = proposal.title || `Proposal for ${proposal.leadData?.name}`;
    const firstName = (proposal.leadData?.name || 'there').split(' ')[0];
    
    const emailBody = `Hi ${firstName},

Please find attached our proposal for your ${proposal.leadData?.projectType || 'project'}.

I've outlined our approach, timeline, and investment details in the attached document. Take a look and let me know if you have any questions.

Looking forward to potentially working together.

Best,
Cameron
Ashbi Design`;

    // Create draft via gmail-draft agent
    const draftResult = await createDraft(leadEmail, subject, emailBody);

    // In a full implementation, we would attach the PDF here
    // The Maton API supports attachments - would need to upload PDF first then attach
    // For now, we create the draft and note that PDF attachment requires additional step

    return {
      success: true,
      draftId: draftResult.id || draftResult.draft?.id,
      to: leadEmail,
      subject,
      pdfGenerated: true,
      pdfSize: pdfBuffer.length,
      message: 'Draft created. PDF attachment requires additional API call to attach file.'
    };
  } catch (error) {
    console.error('Error creating proposal draft:', error);
    throw error;
  }
}

/**
 * Get available proposal templates
 * @returns {Array} Array of template objects
 */
function getProposalTemplates() {
  return PROPOSAL_TEMPLATES;
}

/**
 * Save proposal to database with status tracking
 * @param {object} proposalData - Proposal data to save
 * @returns {Promise<object>} Saved proposal record
 */
async function saveProposal(proposalData) {
  try {
    const {
      title,
      executiveSummary,
      scopeOfWork,
      timeline,
      selectedTier,
      pricingTiers,
      terms,
      html,
      leadData,
      status = PROPOSAL_STATUS.DRAFT
    } = proposalData;

    const proposal = await prisma.proposal.create({
      data: {
        title: title || `Proposal for ${leadData?.name || 'Unknown Lead'}`,
        notes: JSON.stringify({
          executiveSummary,
          scopeOfWork,
          timeline,
          selectedTier,
          terms,
          html: html?.substring(0, 10000) // Store first 10k chars of HTML
        }),
        subtotal: selectedTier?.price || 0,
        discount: 0,
        total: selectedTier?.price || 0,
        validUntil: new Date(Date.now() + 30 * 86400000),
        status,
        clientId: leadData?.clientId ? parseInt(leadData.clientId) : null,
        createdById: leadData?.userId ? parseInt(leadData.userId) : null,
        // If clientId not provided, store lead data as JSON
        ...(leadData && !leadData.clientId ? { metadata: leadData } : {})
      },
      include: {
        client: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      subtotal: proposal.subtotal,
      total: proposal.total,
      validUntil: proposal.validUntil,
      client: proposal.client,
      createdBy: proposal.createdBy,
      createdAt: proposal.createdAt
    };
  } catch (error) {
    console.error('Error saving proposal:', error);
    throw error;
  }
}

/**
 * Update proposal content
 * @param {string} proposalId - ID of proposal to update
 * @param {object} updateData - Fields to update
 * @returns {Promise<object>} Updated proposal
 */
async function updateProposal(proposalId, updateData) {
  try {
    const proposal = await prisma.proposal.update({
      where: { id: parseInt(proposalId) },
      data: {
        ...(updateData.title && { title: updateData.title }),
        ...(updateData.notes && { notes: updateData.notes }),
        ...(updateData.status && { status: updateData.status }),
        ...(updateData.subtotal !== undefined && { subtotal: updateData.subtotal }),
        ...(updateData.total !== undefined && { total: updateData.total }),
        ...(updateData.validUntil && { validUntil: new Date(updateData.validUntil) })
      },
      include: {
        client: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    return proposal;
  } catch (error) {
    console.error('Error updating proposal:', error);
    throw error;
  }
}

/**
 * Track proposal view - marks proposal as VIEWED when recipient opens
 * Uses tracking pixel via Maton or email open detection
 * @param {string} proposalId - ID of the proposal
 * @returns {Promise<object>} Updated proposal status
 */
async function trackProposalView(proposalId) {
  try {
    const proposal = await prisma.proposal.update({
      where: { id: parseInt(proposalId) },
      data: {
        status: PROPOSAL_STATUS.VIEWED,
        viewedAt: new Date()
      }
    });

    return {
      id: proposal.id,
      status: proposal.status,
      viewedAt: proposal.viewedAt
    };
  } catch (error) {
    console.error('Error tracking proposal view:', error);
    throw error;
  }
}

/**
 * Get proposal by ID
 * @param {string} proposalId - ID of proposal to retrieve
 * @returns {Promise<object>} Proposal data
 */
async function getProposal(proposalId) {
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: parseInt(proposalId) },
      include: {
        client: { select: { id: true, name: true, email: true, company: true } },
        createdBy: { select: { id: true, name: true } },
        lineItems: true
      }
    });

    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    return proposal;
  } catch (error) {
    console.error('Error getting proposal:', error);
    throw error;
  }
}

/**
 * Get proposal statistics (sent, viewed, accepted, rejected counts)
 * @returns {Promise<object>} Stats object
 */
async function getProposalStats() {
  try {
    const [total, sent, viewed, accepted, rejected, draft] = await Promise.all([
      prisma.proposal.count(),
      prisma.proposal.count({ where: { status: PROPOSAL_STATUS.SENT } }),
      prisma.proposal.count({ where: { status: PROPOSAL_STATUS.VIEWED } }),
      prisma.proposal.count({ where: { status: PROPOSAL_STATUS.ACCEPTED } }),
      prisma.proposal.count({ where: { status: PROPOSAL_STATUS.REJECTED } }),
      prisma.proposal.count({ where: { status: PROPOSAL_STATUS.DRAFT } })
    ]);

    return {
      total,
      byStatus: {
        draft,
        sent,
        viewed,
        accepted,
        rejected
      },
      conversionRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
      viewRate: sent > 0 ? Math.round(((viewed + accepted) / sent) * 100) : 0,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting proposal stats:', error);
    throw error;
  }
}

/**
 * Mark proposal as accepted - triggers contract generation
 * @param {string} proposalId - ID of proposal to accept
 * @returns {Promise<object>} Accepted proposal with contract info
 */
async function acceptProposal(proposalId) {
  try {
    const proposal = await prisma.proposal.update({
      where: { id: parseInt(proposalId) },
      data: {
        status: PROPOSAL_STATUS.ACCEPTED,
        acceptedAt: new Date()
      },
      include: {
        client: { select: { id: true, name: true, email: true, company: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    // In a full implementation, this would trigger contract generation
    // const contract = await generateContractFromProposal(proposal);

    return {
      proposal: {
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        total: proposal.total,
        client: proposal.client,
        acceptedAt: proposal.acceptedAt
      },
      message: 'Proposal accepted. Contract generation would be triggered here.',
      // contract would be included in full implementation
    };
  } catch (error) {
    console.error('Error accepting proposal:', error);
    throw error;
  }
}

export {
  generateProposal,
  generatePdf,
  createProposalDraft,
  getProposalTemplates,
  saveProposal,
  updateProposal,
  trackProposalView,
  getProposal,
  getProposalStats,
  acceptProposal,
  PRICING_TIERS,
  PROPOSAL_STATUS,
  PROPOSAL_TEMPLATES
};