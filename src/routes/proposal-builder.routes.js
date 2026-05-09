/**
 * Proposal Builder Routes for ashbi-platform (Fastify)
 * API endpoints for proposal generation, management, and tracking
 */

import {
  generateProposal,
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
}
