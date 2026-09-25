import bcrypt from 'bcrypt';
import crypto from 'crypto';
import env from '../../config/env.js';
import { isCurrentUserSession, signUserSession } from '../session.js';
import { createMfaChallenge, isMfaRequired, MFA_CHALLENGE_TTL_SECONDS } from '../mfa.js';

const BCRYPT_ROUNDS = 12;

/**
 * Local Auth Provider
 * 
 * Implements the Enterprise AuthProvider interface using 
 * local database users and bcrypt passwords.
 */
export class LocalAuthProvider {
  constructor(prisma, jwt) {
    this.prisma = prisma;
    this.jwt = jwt;
  }

  async login({ email, password }) {
    const user = await this.prisma.user.findUnique({
      where: { email }
    });

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials or inactive account');
    }

    const isValid = await this.verifyPassword(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Auto-upgrade legacy hashes if needed
    if (!user.password.startsWith('$2')) {
      const newHash = await this.hashPassword(password);
      await this.prisma.user.update({ where: { id: user.id }, data: { password: newHash } });
    }

    // Enterprise Graceful Migration: Ensure user has an organization
    let organizationId = user.organizationId;
    if (!organizationId) {
      const defaultOrg = await this.prisma.organization.upsert({
        where: { slug: 'ashbi-agency' },
        create: { name: 'Ashbi Agency', slug: 'ashbi-agency' },
        update: {}
      });
      organizationId = defaultOrg.id;
      await this.prisma.user.update({ where: { id: user.id }, data: { organizationId } });
    }

    // Staff accounts with MFA enabled get only a short-lived challenge here;
    // the session is issued by POST /api/auth/login/mfa after the second factor.
    if (isMfaRequired(user)) {
      return {
        mfaRequired: true,
        challengeToken: createMfaChallenge(user),
        expiresInSeconds: MFA_CHALLENGE_TTL_SECONDS,
      };
    }

    const token = signUserSession(this.jwt, { ...user, organizationId });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: organizationId
      },
      token
    };
  }

  async verifyToken(token) {
    const payload = this.jwt.verify(token);
    if (!(await isCurrentUserSession(this.prisma, payload))) {
      throw new Error('Session expired or revoked');
    }
    return payload;
  }

  async hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async verifyPassword(password, hash) {
    if (!hash.startsWith('$2')) {
      // SECURITY (audit 2026-07-09, swarm finding): legacy SHA-256 hashes
      // are unsalted — the real risk is rainbow-table attacks, not timing.
      // Auto-upgrade (lines 33-37 above) re-hashes with bcrypt on the
      // next successful login, so the window of exposure is "until each
      // user logs in once". Still, use timingSafeEqual for the legacy
      // path so the comparison doesn't leak the matching prefix length.
      const expected = crypto.createHash('sha256').update(password).digest();
      let actual;
      try {
        actual = Buffer.from(hash, 'hex');
      } catch {
        return false;
      }
      if (expected.length !== actual.length) return false;
      return crypto.timingSafeEqual(expected, actual);
    }
    return bcrypt.compare(password, hash);
  }
}
