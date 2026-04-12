// API Key management routes

import { prisma } from '../index.js';
import crypto from 'crypto';

const PREFIX = 'ashbi_'; // API keys start with ashbi_ for easy identification

function generateApiKey() {
  return PREFIX + crypto.randomBytes(32).toString('hex');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export default async function apiKeyRoutes(fastify) {
  // List API keys for current user
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: request.user.id, isActive: true },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    return { keys };
  });

  // Create a new API key
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, expiresAt } = request.body || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    // Limit to 5 active keys per user
    const count = await prisma.apiKey.count({
      where: { userId: request.user.id, isActive: true }
    });
    if (count >= 5) {
      return reply.status(400).send({ error: 'Maximum 5 active API keys per user' });
    }

    const rawKey = generateApiKey();
    const hashed = hashKey(rawKey);

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        key: hashed,
        userId: request.user.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }
    });

    // Return the raw key ONCE — it won't be stored in plaintext
    return {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey, // Only time the raw key is returned
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
    };
  });

  // Revoke an API key
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.userId !== request.user.id) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false }
    });

    return { success: true };
  });
}

// Middleware to authenticate via API key (x-api-key header or Authorization: Bearer ashbi_...)
export async function authenticateApiKey(request, reply) {
  const authHeader = request.headers.authorization;
  const apiKeyHeader = request.headers['x-api-key'];

  let rawKey = apiKeyHeader;
  if (!rawKey && authHeader?.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey || !rawKey.startsWith(PREFIX)) {
    return reply.status(401).send({ error: 'API key required' });
  }

  const hashed = hashKey(rawKey);
  const key = await prisma.apiKey.findUnique({
    where: { key: hashed },
    include: { user: true }
  });

  if (!key || !key.isActive) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  if (key.expiresAt && new Date() > key.expiresAt) {
    return reply.status(401).send({ error: 'API key expired' });
  }

  if (!key.user.isActive) {
    return reply.status(401).send({ error: 'User account is disabled' });
  }

  // Update lastUsedAt
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => {}); // Don't fail if update fails

  // Attach user to request (same shape as JWT auth)
  request.user = {
    id: key.user.id,
    email: key.user.email,
    name: key.user.name,
    role: key.user.role
  };
}