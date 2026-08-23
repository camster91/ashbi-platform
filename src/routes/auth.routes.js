// Authentication routes

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import env from '../config/env.js';
import { isCurrentUserSession, revokeUserSessions, sessionCookieMaxAge, signUserSession } from '../auth/session.js';
import {
  validateBody,
  schemas,
  loginSchema,
  registerSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  clientSignupSchema,
  clientLoginSchema,
  inviteClientSchema,
  updateProfileSchema
} from '../validators/schemas.js';

const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  // Support legacy SHA-256 hashes (auto-upgrade on next login)
  if (!hash.startsWith('$2')) {
    const sha256 = crypto.createHash('sha256').update(password).digest('hex');
    return sha256 === hash;
  }
  return bcrypt.compare(password, hash);
}

async function upgradeHashIfNeeded(prisma, userId, password, currentHash) {
  if (!currentHash.startsWith('$2')) {
    const newHash = await hashPassword(password);
    await prisma.user.update({ where: { id: userId }, data: { password: newHash } });
  }
}

export default async function authRoutes(fastify) {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip
      }
    }
  };

  // Login
  fastify.post('/login', {
    ...authRateLimit,
    preHandler: [validateBody(loginSchema)],
  }, async (request, reply) => {
    const { email, password } = request.body;

    try {
      const { user, token } = await fastify.auth.login({ email, password });

      reply
        .setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: env.isProduction,
          sameSite: env.isProduction ? 'strict' : 'lax',
          maxAge: sessionCookieMaxAge()
        })
        .send({ user });
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (await isCurrentUserSession(request.prisma, request.user)) {
        await request.prisma.pushSubscription.deleteMany({
          where: { userId: request.user.id }
        });
        await revokeUserSessions(request.prisma, request.user.id);
      }
    } catch {
      // Logout is idempotent: always clear the browser cookie.
    }
    reply
      .clearCookie('token', { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production' && !request.headers.host?.includes('localhost'), sameSite: 'lax' })
      .send({ success: true });
  });

  // Get current user
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = await request.prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true
      }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      ...user,
      skills: typeof user.skills === 'string' ? JSON.parse(user.skills || '[]') : (user.skills || [])
    };
  });

  // Register (admin only, or first user with ADMIN_INVITE_TOKEN)
  fastify.post('/register', {
    ...authRateLimit,
    preHandler: [validateBody(registerSchema)],
  }, async (request, reply) => {
    const { email, password, name, role = 'TEAM', adminInviteToken } = request.body;

    // Check if any users exist
    const userCount = await request.prisma.user.count();

    if (userCount === 0) {
      // First user registration — the bootstrap ADMIN.
      //
      // SECURITY (audit 2026-07-09, swarm finding P2-D): the previous
      // behavior was "if ADMIN_INVITE_TOKEN is unset, log a warning
      // and let the first registrant become ADMIN unconditionally."
      // A typo'd production deploy or a forgotten env var would let
      // any unauthenticated request become admin on a fresh database.
      // Fix: in production, refuse first-user registration if
      // ADMIN_INVITE_TOKEN is unset OR doesn't match. In dev, allow
      // it (the seed needs to work without ceremony).
      if (!process.env.ADMIN_INVITE_TOKEN) {
        if (process.env.NODE_ENV === 'production') {
          return reply.status(503).send({
            error: 'Server misconfigured: ADMIN_INVITE_TOKEN is required for first-user registration in production. Set it in your environment before deploying.'
          });
        }
        // dev / test: log warning, continue
        console.warn('[auth] First user registration without ADMIN_INVITE_TOKEN (non-production env).');
      } else {
        if (!adminInviteToken || adminInviteToken !== process.env.ADMIN_INVITE_TOKEN) {
          return reply.status(403).send({ error: 'Invalid admin invite token. Provide the correct ADMIN_INVITE_TOKEN to register as first admin.' });
        }
      }
    } else {
      // Subsequent users — require admin auth
      try {
        await request.jwtVerify();
        if (!(await isCurrentUserSession(request.prisma, request.user))) {
          return reply.status(401).send({ error: 'Session expired or revoked' });
        }
        if (request.user.role !== 'ADMIN') {
          return reply.status(403).send({ error: 'Admin access required' });
        }
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized — admin login required' });
      }
    }

    // Check if email already exists
    const existing = await request.prisma.user.findUnique({
      where: { email }
    });

    if (existing) {
      return reply.status(400).send({ error: 'Email already registered' });
    }

    // First user is always admin; subsequent users use the provided role (validated by Zod)
    const userRole = userCount === 0 ? 'ADMIN' : role;

    const user = await request.prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        name,
        role: userRole
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true
      }
    });

    return reply.status(201).send(user);
  });

  // Update profile (name, skills, capacity)
  fastify.put('/me', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(updateProfileSchema)],
  }, async (request, reply) => {
    const { name, skills, capacity } = request.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (skills !== undefined) data.skills = Array.isArray(skills) ? skills : [];
    if (capacity !== undefined) data.capacity = parseInt(capacity) || 40;

    const user = await request.prisma.user.update({
      where: { id: request.user.id },
      data,
      select: { id: true, email: true, name: true, role: true, skills: true, capacity: true }
    });
    return user;
  });

  // Change password
  fastify.post('/change-password', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(changePasswordSchema)],
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;

    const user = await request.prisma.user.findUnique({
      where: { id: request.user.id }
    });

    if (!(await verifyPassword(currentPassword, user.password))) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }

    await request.prisma.user.update({
      where: { id: request.user.id },
      data: {
        password: await hashPassword(newPassword),
        sessionVersion: { increment: 1 },
      }
    });

    return { success: true };
  });

  // ===== CLIENT AUTHENTICATION =====

  // Client signup via invitation token
  fastify.post('/client/signup', {
    preHandler: [validateBody(clientSignupSchema)],
  }, async (request, reply) => {
    const { token, email, password } = request.body;

    // Find and validate invitation
    const invitation = await request.prisma.clientInvitation.findUnique({
      where: { token }
    });

    if (!invitation) {
      return reply.status(404).send({ error: 'Invalid invitation token' });
    }

    if (invitation.usedAt) {
      return reply.status(400).send({ error: 'Invitation already used' });
    }

    const now = new Date();
    if (new Date(invitation.expiresAt) < now) {
      return reply.status(400).send({ error: 'Invitation expired' });
    }

    if (invitation.email !== email) {
      return reply.status(400).send({ error: 'Email does not match invitation' });
    }

    // Check if user already exists
    const existingUser = await request.prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return reply.status(400).send({ error: 'Account already exists' });
    }

    // Create user
    const user = await request.prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        name: email.split('@')[0], // Use email prefix as default name
        role: 'CLIENT',
        clientId: invitation.clientId,
        isActive: true
      }
    });

    // Mark invitation as used
    await request.prisma.clientInvitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() }
    });

    const jwtToken = signUserSession(fastify.jwt, user);

    reply
      .setCookie('token', jwtToken, {
        path: '/',
        httpOnly: true,
        secure: env.isProduction,
        sameSite: env.isProduction ? 'strict' : 'lax',
        maxAge: sessionCookieMaxAge()
      })
      .send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'CLIENT'
        }
      });
  });

  // Client login
  fastify.post('/client/login', {
    preHandler: [validateBody(clientLoginSchema)],
  }, async (request, reply) => {
    const { email, password } = request.body;

    const user = await request.prisma.user.findFirst({
      where: {
        email,
        role: 'CLIENT'
      }
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    if (!(await verifyPassword(password, user.password))) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    // Auto-upgrade legacy SHA-256 hash to bcrypt
    await upgradeHashIfNeeded(request.prisma, user.id, password, user.password);

    if (!user.isActive) {
      return reply.status(401).send({ error: 'Account is inactive' });
    }

    const token = signUserSession(fastify.jwt, user);

    reply
      .setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: env.isProduction,
        sameSite: env.isProduction ? 'strict' : 'lax',
        maxAge: sessionCookieMaxAge()
      })
      .send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'CLIENT'
        }
      });
  });

  // Forgot password
  fastify.post('/forgot-password', {
    ...authRateLimit,
    preHandler: [validateBody(forgotPasswordSchema)],
  }, async (request, reply) => {
    try {
      const { email } = request.body;

      const user = await request.prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() }
      });

      // Always return success (don't leak if email exists)
      if (!user) {
        return { success: true };
      }

      // Generate reset token (valid for 24 hours)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await request.prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: resetTokenHash,
          resetTokenExpiresAt: expiresAt
        }
      });

      // Send reset email via Mailgun
      const resetLink = `${env.hubUrl}/reset-password?token=${resetToken}`;

      if (env.mailgunApiKey && env.mailgunDomain) {
        try {
          const mg = new Mailgun(FormData);
          const client = mg.client({
            username: 'api',
            key: env.mailgunApiKey
          });

          await client.messages.create(env.mailgunDomain, {
            from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
            to: email,
            subject: 'Reset Your Password — Ashbi Hub',
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:40px;border-radius:12px;">
                <h2 style="color:#c9a84c;margin-top:0;">Password Reset Request</h2>
                <p>We received a request to reset your password. Click the button below to create a new password.</p>
                <a href="${resetLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c9a84c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
                <p style="font-size:14px;color:#94a3b8;">Or copy this link: <code style="color:#e2e8f0;word-break:break-all;">${resetLink}</code></p>
                <p style="font-size:12px;color:#94a3b8;">This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.</p>
              </div>
            `
          });
          console.log(`[auth] Password reset email sent to ${email}`);
        } catch (mailErr) {
          console.error('[auth] Failed to send reset email:', mailErr.message || mailErr);
          // In production, surface the error so the user knows email delivery failed
          if (env.isProduction) {
            return reply.status(503).send({ error: 'Failed to send reset email. Please try again or contact support.' });
          }
        }
      } else {
        console.warn('[auth] Mailgun not configured — password reset email not sent');
        if (env.isProduction) {
          return reply.status(503).send({ error: 'Email service not configured. Please contact support to reset your password.' });
        } else {
          // Authentication action links are credentials. Never write them to logs;\n          // local testing must use an approved sandbox email provider.
        }
      }

      return { success: true };
    } catch (err) {
      console.error('Forgot password error:', err);
      return reply.status(500).send({ error: 'Failed to process password reset request' });
    }
  });

  // Reset password with token
  fastify.post('/reset-password', {
    preHandler: [validateBody(resetPasswordSchema)],
  }, async (request, reply) => {
    try {
      const { token, newPassword } = request.body;

      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await request.prisma.user.findFirst({
        where: {
          resetToken: resetTokenHash,
          resetTokenExpiresAt: { gt: new Date() }
        }
      });

      if (!user) {
        return reply.status(400).send({ error: 'Invalid or expired reset token' });
      }

      // Update password and clear reset token
      await request.prisma.user.update({
        where: { id: user.id },
        data: {
          password: await hashPassword(newPassword),
          sessionVersion: { increment: 1 },
          resetToken: null,
          resetTokenExpiresAt: null
        }
      });

      return { success: true };
    } catch (err) {
      console.error('Reset password error:', err);
      return reply.status(500).send({ error: 'Failed to reset password' });
    }
  });

  // Admin invite client
  fastify.post('/admin/clients/:clientId/invite', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(inviteClientSchema)],
  }, async (request, reply) => {
    // Check admin role
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { clientId } = request.params;
    const { email } = request.body;

    // Verify client exists
    const client = await request.prisma.client.findUnique({
      where: { id: clientId }
    });

    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    // Check if user already invited
    const existingInvite = await request.prisma.clientInvitation.findFirst({
      where: {
        email,
        clientId,
        usedAt: null
      }
    });

    if (existingInvite && new Date(existingInvite.expiresAt) > new Date()) {
      return reply.status(400).send({ error: 'Active invitation already exists for this email' });
    }

    // Create invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await request.prisma.clientInvitation.create({
      data: {
        token,
        email,
        clientId,
        expiresAt
      }
    });

    // Send invitation email via Mailgun
    const inviteLink = `${process.env.HUB_URL || 'https://hub.ashbi.ca'}/client/invite?token=${token}`;

    if (env.mailgunApiKey && env.mailgunDomain) {
      try {
        const mg = new Mailgun(FormData);
        const mgClient = mg.client({
          username: 'api',
          key: env.mailgunApiKey
        });

        await mgClient.messages.create(env.mailgunDomain, {
          from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
          to: email,
          subject: 'You have been invited to Ashbi Hub',
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:40px;border-radius:12px;">
              <h2 style="color:#c9a84c;margin-top:0;">You've been invited</h2>
              <p>You have been invited to join Ashbi Hub. Click the button below to access your client portal.</p>
              <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c9a84c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Access Client Portal</a>
              <p style="font-size:14px;color:#94a3b8;">Or copy this link: <code style="color:#e2e8f0;word-break:break-all;">${inviteLink}</code></p>
              <p style="font-size:12px;color:#94a3b8;">This link will expire in 7 days.</p>
            </div>
          `
        });
        console.log(`[auth] Client invitation email sent to ${email}`);
      } catch (mailErr) {
        console.error('[auth] Failed to send invitation email:', mailErr.message || mailErr);
      }
    } else {
      console.warn('[auth] Mailgun not configured — invitation email not sent');
      // The authenticated admin response below is the only non-email recovery\n      // path. Never copy the invitation credential into application logs.
    }

    return {
      invitationId: invitation.id,
      email,
      expiresAt,
      inviteLink
    };
  });
}
