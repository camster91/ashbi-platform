// Credentials Vault routes

import prisma from '../config/db.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export default async function credentialRoutes(fastify) {
  // List credentials with optional filters (admin only)
  fastify.get('/', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const { clientId, projectId, category } = request.query;

    const where = {};
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (category) where.category = category;

    const credentials = await prisma.credential.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Return without decrypting passwords (frontend requests decrypt individually)
    return credentials.map(c => ({
      ...c,
      password: '********'
    }));
  });

  // Get single credential (with decrypted password, admin only)
  fastify.get('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    const credential = await prisma.credential.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    if (!credential) {
      return reply.status(404).send({ error: 'Credential not found' });
    }

    return {
      ...credential,
      password: decrypt(credential.password, { audit: true, label: `credential:${id}:${credential.label}` })
    };
  });

  // Decrypt password only (for copy-to-clipboard, admin only)
  fastify.get('/:id/password', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    const credential = await prisma.credential.findUnique({
      where: { id },
      select: { password: true }
    });

    if (!credential) {
      return reply.status(404).send({ error: 'Credential not found' });
    }

    return { password: decrypt(credential.password, { audit: true, label: `credential-password:${id}` }) };
  });

  // Create credential (admin only)
  fastify.post('/', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { label, username, password, url, notes, category, clientId, projectId } = request.body;

    if (!label || !password) {
      return reply.status(400).send({ error: 'Label and password are required' });
    }

    const credential = await prisma.credential.create({
      data: {
        label,
        username: username || null,
        password: encrypt(password),
        url: url || null,
        notes: notes || null,
        category: category || 'OTHER',
        clientId: clientId || null,
        projectId: projectId || null
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    return reply.status(201).send({
      ...credential,
      password: '********'
    });
  });

  // Update credential (admin only)
  fastify.put('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    const { label, username, password, url, notes, category, clientId, projectId } = request.body;

    const data = {};
    if (label !== undefined) data.label = label;
    if (username !== undefined) data.username = username;
    if (password !== undefined) data.password = encrypt(password);
    if (url !== undefined) data.url = url;
    if (notes !== undefined) data.notes = notes;
    if (category !== undefined) data.category = category;
    if (clientId !== undefined) data.clientId = clientId || null;
    if (projectId !== undefined) data.projectId = projectId || null;

    const credential = await prisma.credential.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    return {
      ...credential,
      password: '********'
    };
  });

  // Delete credential (admin only)
  fastify.delete('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    await prisma.credential.delete({ where: { id } });
    return { success: true };
  });
}
