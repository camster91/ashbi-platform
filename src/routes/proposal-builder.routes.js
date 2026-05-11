/**
 * Proposal Builder Routes for ashbi-platform (Fastify)
 * API endpoints for proposal generation, management, and tracking
 */

import {
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
  PROPOSAL_STATUS
} from "../agents/proposal-builder.agent.js";


/**
 * Auth middleware for Fastify
 */
async function authMiddleware(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.status(401).send({ error: "Authorization header required" });
  }
}

export default async function proposalBuilderRoutes(fastify, opts) {
  fastify.post("/generate", async (request, reply) => {
    try {
      const { name, company, email, projectType, budget, timeline, notes } = request.body || {};
      if (!name || !email) {
        return reply.status(400).send({ error: "name and email are required" });
      }
      const proposal = await generateProposal({
        name, company, email, projectType, budget, timeline, notes
      });
      if (request.body.saveAsDraft !== false) {
        try {
          const savedProposal = await saveProposal({
            ...proposal,
            leadData: { name, company, email, projectType, budget, timeline }
          });
          proposal.id = savedProposal.id;
          proposal.status = savedProposal.status;
        } catch (saveErr) {
          console.warn("Could not save proposal draft:", saveErr.message);
        }
      }
      return reply.send({
        success: true,
        proposal: {
          id: proposal.id, title: proposal.title, html: proposal.html,
          pricingTiers: proposal.pricingTiers, selectedTier: proposal.selectedTier
        },
        templates: getProposalTemplates(),
        pricingTiers: PRICING_TIERS
      });
    } catch (error) {
      request.log.error(error, "Error generating proposal");
      return reply.status(500).send({ error: "Failed to generate proposal", message: error.message });
    }
  });

  fastify.post("/:id/send", async (request, reply) => {
    const authRes = await authMiddleware(request, reply);
    if (authRes) return authRes;
    try {
      const proposalId = request.params.id;
      const { email } = request.body || {};
      const proposal = await getProposal(proposalId);
      if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
      const recipientEmail = email || proposal.client?.email;
      if (!recipientEmail) return reply.status(400).send({ error: "No recipient email provided" });
      const proposalData = {
        title: proposal.title,
        html: proposal.notes ? JSON.parse(proposal.notes).html || "" : "",
        leadData: proposal.client ? {
          name: proposal.client.name, email: proposal.client.email, company: proposal.client.company
        } : null
      };
      const draftResult = await createProposalDraft(proposalData, recipientEmail);
      await updateProposal(proposalId, { status: PROPOSAL_STATUS.SENT });
      return reply.send({
        success: true,
        draft: { id: draftResult.draftId, to: recipientEmail, subject: draftResult.subject, createdAt: new Date().toISOString() },
        proposal: { id: proposal.id, status: PROPOSAL_STATUS.SENT }
      });
    } catch (error) {
      request.log.error(error, "Error creating proposal draft");
      return reply.status(500).send({ error: "Failed to send proposal", message: error.message });
    }
  });

  fastify.get("/:id", async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const proposal = await getProposal(proposalId);
      let parsedNotes = {};
      try { if (proposal.notes) parsedNotes = JSON.parse(proposal.notes); }
      catch (e) { parsedNotes = { raw: proposal.notes }; }
      return reply.send({
        proposal: {
          id: proposal.id, title: proposal.title, status: proposal.status,
          subtotal: proposal.subtotal, total: proposal.total, validUntil: proposal.validUntil,
          createdAt: proposal.createdAt, viewedAt: proposal.viewedAt, acceptedAt: proposal.acceptedAt,
          client: proposal.client, createdBy: proposal.createdBy, lineItems: proposal.lineItems, notes: parsedNotes
        }
      });
    } catch (error) {
      request.log.error(error, "Error getting proposal");
      return reply.status(error.message.includes("not found") ? 404 : 500).send({
        error: error.message.includes("not found") ? "Proposal not found" : "Failed to get proposal",
        message: error.message
      });
    }
  });

  fastify.put("/:id", async (request, reply) => {
    const authRes = await authMiddleware(request, reply);
    if (authRes) return authRes;
    try {
      const proposalId = request.params.id;
      const { title, notes, status, subtotal, total, validUntil } = request.body || {};
      const proposal = await updateProposal(proposalId, { title, notes, status, subtotal, total, validUntil });
      return reply.send({
        success: true,
        proposal: { id: proposal.id, title: proposal.title, status: proposal.status,
          subtotal: proposal.subtotal, total: proposal.total, validUntil: proposal.validUntil,
          updatedAt: new Date().toISOString() }
      });
    } catch (error) {
      request.log.error(error, "Error updating proposal");
      return reply.status(500).send({ error: "Failed to update proposal", message: error.message });
    }
  });

  fastify.get("/stats", async (request, reply) => {
    try { return reply.send(await getProposalStats()); }
    catch (error) {
      request.log.error(error, "Error getting proposal stats");
      return reply.status(500).send({ error: "Failed to get stats", message: error.message });
    }
  });

  fastify.post("/:id/accept", async (request, reply) => {
    try {
      const result = await acceptProposal(request.params.id);
      return reply.send({ success: true, proposal: result.proposal, message: result.message });
    } catch (error) {
      request.log.error(error, "Error accepting proposal");
      return reply.status(500).send({ error: "Failed to accept proposal", message: error.message });
    }
  });

  fastify.get("/templates", async (request, reply) => {
    return reply.send({ templates: getProposalTemplates() });
  });

  fastify.get("/pricing-tiers", async (request, reply) => {
    return reply.send({ pricingTiers: PRICING_TIERS });
  });

  fastify.post("/:id/track", async (request, reply) => {
    try { await trackProposalView(request.params.id); }
    catch (error) { request.log.error(error, "Error tracking proposal view"); }
    return reply.type("image/gif")
      .send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  });

  // Download proposal as PDF
  fastify.get("/:id/pdf", async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const proposal = await getProposal(proposalId);
      if (!proposal) return reply.status(404).send({ error: "Proposal not found" });

      // Get or generate the HTML for the proposal
      let proposalHtml = "";
      try {
        const notesObj = proposal.notes ? JSON.parse(proposal.notes) : {};
        proposalHtml = notesObj.html || "";
      } catch (e) {
        proposalHtml = proposal.notes || "";
      }

      // If no HTML stored, generate it from the proposal data
      if (!proposalHtml) {
        const leadData = {
          name: proposal.client?.name || "Client",
          email: proposal.client?.email || "",
          company: proposal.client?.company || ""
        };
        const proposalData = {
          title: proposal.title,
          id: proposal.id,
          selectedTier: { name: "Package", price: proposal.total },
          pricingTiers: proposal.lineItems?.map(li => ({
            name: li.description,
            price: li.unitPrice
          })) || []
        };
        // Use basic HTML since we don't have AI generation here
        proposalHtml = buildFallbackProposalHtml(proposalData, leadData);
      }

      const pdfBuffer = await generatePdf(proposalHtml);
      const filename = `Ashbi_Proposal_${proposal.id}.pdf`;

      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (error) {
      request.log.error(error, "Error generating proposal PDF");
      return reply.status(500).send({ error: "Failed to generate PDF", message: error.message });
    }
  });
}

// Helper to build basic proposal HTML when AI is not available
function buildFallbackProposalHtml(proposalData, leadData) {
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
    .client-info { background: #f7f7f7; padding: 20px; border-radius: 4px; margin-bottom: 32px; }
    .section { margin-bottom: 40px; }
    .section h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
    .pricing-tier { border: 1px solid #e5e5e5; border-radius: 4px; padding: 20px; margin-bottom: 16px; }
    .pricing-tier h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .pricing-tier .price { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ASHBI</div>
      <h1 class="proposal-title">${proposalData.title || 'Project Proposal'}</h1>
      <div>Prepared for ${leadData.name}${leadData.company ? `, ${leadData.company}` : ''} | ${today}</div>
    </div>
    <div class="client-info">
      <h3>Prepared For</h3>
      <p><strong>${leadData.name}</strong></p>
      ${leadData.company ? `<p>${leadData.company}</p>` : ''}
      <p>${leadData.email}</p>
    </div>
    <div class="section">
      <h2>Pricing</h2>
      ${(proposalData.pricingTiers || []).map(tier => `
        <div class="pricing-tier">
          <h3>${tier.name}</h3>
          <div class="price">$${tier.price.toLocaleString()}</div>
        </div>
      `).join('')}
      <div class="pricing-tier" style="background:#fafafa;">
        <h3>Total</h3>
        <div class="price">$${(proposalData.selectedTier?.price || 0).toLocaleString()}</div>
      </div>
    </div>
    <div class="footer">
      <p>Ashbi | Toronto, ON | hello@ashbi.design</p>
      <p>Valid until ${validUntil}</p>
    </div>
  </div>
</body>
</html>`;

}
