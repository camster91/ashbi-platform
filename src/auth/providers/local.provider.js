import bcrypt from 'bcrypt';
import crypto from 'crypto';
import env from '../../config/env.js';

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

    const token = this.jwt.sign({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      organizationId: organizationId
    });

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
    return this.jwt.verify(token);
  }

  async hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async verifyPassword(password, hash) {
    if (!hash.startsWith('$2')) {
      const sha256 = crypto.createHash('sha256').update(password).digest('hex');
      return sha256 === hash;
    }
    return bcrypt.compare(password, hash);
  }
}
