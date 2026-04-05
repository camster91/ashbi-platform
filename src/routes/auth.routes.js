// Authentication routes

import { prisma } from '../index.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

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

async function upgradeHashIfNeeded(userId, password, currentHash) {
  if (!currentHash.startsWith('$2')) {
    const newHash = await hashPassword(password);
    await prisma.user.update({ where: { id: userId }, data: { password: newHash } });
  }
}

export default async function authRoutes(fastify) {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip
      }
    }
  };

  // Login
  fastify.post('/login', {
    ...authRateLimit,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !(await verifyPassword(password, user.password))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return reply.status(401).send({ error: 'Account is disabled' });
    }

    // Auto-upgrade legacy SHA-256 hash to bcrypt
    await upgradeHashIfNeeded(user.id, password, user.password);

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });

    reply
      .setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' && !request.headers.host?.includes('localhost'),
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })
      .send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      });
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply
      .clearCookie('token', { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production' && !request.headers.host?.includes('localhost'), sameSite: 'lax' })
      .send({ success: true });
  });

  // Get current user
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
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

    return user;
  });

  // Register (admin only, or first user)
  fastify.post('/register', { ...authRateLimit }, async (request, reply) => {
    const { email, password, name, role = 'TEAM' } = request.body;

    // Check if any users exist
    const userCount = await prisma.user.count();

    // If users exist, require admin auth
    if (userCount > 0) {
      try {
        await request.jwtVerify();
        if (request.user.role !== 'ADMIN') {
          return reply.status(403).send({ error: 'Admin access required' });
        }
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email }
    });

    if (existing) {
      return reply.status(400).send({ error: 'Email already registered' });
    }

    // First user is always admin
    const userRole = userCount === 0 ? 'ADMIN' : role;

    const user = await prisma.user.create({
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

  // Change password
  fastify.post('/change-password', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;

    const user = await prisma.user.findUnique({
      where: { id: request.user.id }
    });

    if (!(await verifyPassword(currentPassword, user.password))) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }

    await prisma.user.update({
      where: { id: request.user.id },
      data: { password: await hashPassword(newPassword) }
    });

    return { success: true };
  });

  // ===== CLIENT AUTHENTICATION =====

  // Client signup via invitation token
  fastify.post('/client/signup', async (request, reply) => {
    const { token, email, password } = request.body;

    if (!token || !email || !password) {
      return reply.status(400).send({ error: 'Token, email, and password required' });
    }

    // Find and validate invitation
    const invitation = await prisma.clientInvitation.findUnique({
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
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return reply.status(400).send({ error: 'Account already exists' });
    }

    // Create user
    const user = await prisma.user.create({
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
    await prisma.clientInvitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() }
    });

    const jwtToken = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: 'CLIENT',
      clientId: user.clientId
    });

    reply
      .setCookie('token', jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60
      })
      .send({
        user: {
          id: user.id,
          email: user.email,
          role: 'CLIENT'
        },
        token: jwtToken
      });
  });

  // Client login
  fastify.post('/client/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    const user = await prisma.user.findFirst({
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
    await upgradeHashIfNeeded(user.id, password, user.password);

    if (!user.isActive) {
      return reply.status(401).send({ error: 'Account is inactive' });
    }

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: 'CLIENT',
      clientId: user.clientId
    });

    reply
      .setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60
      })
      .send({
        user: {
          id: user.id,
          email: user.email,
          role: 'CLIENT'
        },
        token
      });
  });

  // Forgot password
  fastify.post('/forgot-password', { ...authRateLimit }, async (request, reply) => {
    try {
      const { email } = request.body;

      if (!email) {
        return reply.status(400).send({ error: 'Email required' });
      }

      const user = await prisma.user.findUnique({
        where: { email }
      });

      // Always return success (don't leak if email exists)
      if (!user) {
        return { success: true };
      }

      // Generate reset token (valid for 24 hours)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: resetTokenHash,
          resetTokenExpiresAt: expiresAt
        }
      });

      // Send reset email via Mailgun
      const resetLink = `${process.env.HUB_URL || 'https://hub.ashbi.ca'}/reset-password?token=${resetToken}`;

      try {
        if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
          const mg = new Mailgun(FormData);
          const client = mg.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY
          });

          await client.messages.create(process.env.MAILGUN_DOMAIN, {
            from: `noreply@${process.env.MAILGUN_DOMAIN}`,
            to: email,
            subject: 'Reset Your Password - Agency Hub',
            html: `
              <h2>Password Reset Request</h2>
              <p>We received a request to reset your password. Click the link below to create a new password.</p>
              <p><a href="${resetLink}" style="background-color: #c9a84c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
              <p>Or copy this link: <code>${resetLink}</code></p>
              <p>This link will expire in 24 hours.</p>
              <p>If you didn't request this, you can safely ignore this email.</p>
            `
          });
          console.log(`Password reset email sent to ${email}`);
        } else {
          console.log(`Password reset link for ${email} (email not configured): ${resetLink}`);
        }
      } catch (err) {
        console.error('Failed to send reset email:', err);
        // Don't fail the request if email sending fails
      }

      return { success: true };
    } catch (err) {
      console.error('Forgot password error:', err);
      return reply.status(500).send({ error: 'Failed to process password reset request' });
    }
  });

  // Reset password with token
  fastify.post('/reset-password', async (request, reply) => {
    try {
      const { token, newPassword } = request.body;

      if (!token || !newPassword) {
        return reply.status(400).send({ error: 'Token and password required' });
      }

      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await prisma.user.findFirst({
        where: {
          resetToken: resetTokenHash,
          resetTokenExpiresAt: { gt: new Date() }
        }
      });

      if (!user) {
        return reply.status(400).send({ error: 'Invalid or expired reset token' });
      }

      // Update password and clear reset token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: await hashPassword(newPassword),
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
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    // Check admin role
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { clientId } = request.params;
    const { email } = request.body;

    if (!email) {
      return reply.status(400).send({ error: 'Email required' });
    }

    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId }
    });

    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    // Check if user already invited
    const existingInvite = await prisma.clientInvitation.findFirst({
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

    const invitation = await prisma.clientInvitation.create({
      data: {
        token,
        email,
        clientId,
        expiresAt
      }
    });

    // Send email (placeholder - integrate with Mailgun)
    const inviteLink = `${process.env.HUB_URL || 'https://hub.ashbi.ca'}/client/invite?token=${token}`;
    
    try {
      // TODO: Send via Mailgun
      console.log(`Client invitation link: ${inviteLink}`);
      // await sendInviteEmail(email, inviteLink);
    } catch (err) {
      console.error('Failed to send invitation email:', err);
      // Don't fail the request, invitation is still created
    }

    return {
      invitationId: invitation.id,
      email,
      expiresAt,
      inviteLink
    };
  });
}
