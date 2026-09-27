import { dummyPasswordCheck, hashPassword, upgradeLegacyHash, verifyPassword } from '../password.js';
import { isCurrentUserSession, signUserSession } from '../session.js';
import { createMfaChallenge, isMfaRequired, MFA_CHALLENGE_TTL_SECONDS } from '../mfa.js';

/** Sign-in refused: the credentials are right but the account has no workspace. */
export class AccountWithoutOrganizationError extends Error {
  constructor() {
    super('This account is not assigned to a workspace. Ask an administrator to add it to one.');
    this.name = 'AccountWithoutOrganizationError';
    this.code = 'ACCOUNT_WITHOUT_ORGANIZATION';
    this.statusCode = 403;
  }
}

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
      // Same bcrypt cost as a real check, so timing does not reveal whether
      // the email is registered (or the account inactive).
      await dummyPasswordCheck(password);
      throw new Error('Invalid credentials or inactive account');
    }

    const isValid = await this.verifyPassword(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // A legacy unsalted SHA-256 hash is accepted once: it is replaced with
    // bcrypt before any session is issued, and the sign-in fails if it
    // cannot be.
    await upgradeLegacyHash(this.prisma, user, password);

    // Every account belongs to an organization. An account without one is a
    // data error for an operator to fix; never guess a workspace for it.
    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new AccountWithoutOrganizationError();
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
    return hashPassword(password);
  }

  async verifyPassword(password, hash) {
    return verifyPassword(password, hash);
  }
}
