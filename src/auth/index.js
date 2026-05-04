import { LocalAuthProvider } from './providers/local.provider.js';

let authProvider = null;

/**
 * Enterprise Auth Factory
 * 
 * Returns the active authentication provider.
 * Easily switch between Local, Clerk, Auth0, etc.
 */
export function getAuthProvider(fastify) {
  if (!authProvider) {
    // Large company would check env.AUTH_PROVIDER here
    authProvider = new LocalAuthProvider(fastify.prisma, fastify.jwt);
  }
  return authProvider;
}
