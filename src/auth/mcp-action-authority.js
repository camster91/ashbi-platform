import { isDeepStrictEqual } from 'node:util';
import { ToolError } from '../ai/tools/registry.js';
import { mustEnrollMfa } from './mfa-enforcement.js';
import { MCP_OAUTH_ACTION_SCOPES, normalizeMcpScopes } from './mcp-oauth-scopes.js';

const unavailable = () => new ToolError('NOT_FOUND', 'Workspace action unavailable', { statusCode: 404 });
export function oauthActionBinding(ctx, action) {
  if (!ctx.oauth) return null;
  const requiredScope = MCP_OAUTH_ACTION_SCOPES[action];
  if (!requiredScope) throw unavailable();
  return { kind: 'mcp_oauth', keyId: ctx.oauth.keyId, userId: ctx.user.id, organizationId: ctx.user.organizationId,
    sessionVersion: ctx.oauth.sessionVersion, clientId: ctx.oauth.clientId, requiredScope };
}
// Called before receipt exposure AND inside the publication/task transaction.
// A live bearer claim alone never substitutes for current persisted authority.
export async function assertMcpActionAuthority(prisma, ctx, action, receipt = null) {
  if (!ctx.oauth) { if (receipt?.authorizationBinding) throw unavailable(); return; }
  const binding = oauthActionBinding(ctx, action);
  if (receipt && (!isDeepStrictEqual(receipt.authorizationBinding, binding) || receipt.userId !== ctx.user.id || receipt.organizationId !== ctx.user.organizationId || receipt.source !== 'ai_bridge')) throw unavailable();
  const grant = ctx.oauth;
  if (!ctx.scopes?.includes(binding.requiredScope) || !grant.scopes?.includes(binding.requiredScope) || grant.expiresAt <= Date.now()) throw unavailable();
  const [key, user] = await Promise.all([
    prisma.apiKey.findUnique({ where: { id: grant.keyId } }),
    prisma.user.findUnique({ where: { id: ctx.user.id }, include: { organization: true } }),
  ]);
  const scopes = normalizeMcpScopes(key?.scopes);
  if (!key?.isActive || key.revokedAt || key.userId !== ctx.user.id || !key.expiresAt || new Date(key.expiresAt) <= new Date()
    || !scopes || !isDeepStrictEqual(scopes, normalizeMcpScopes(grant.scopes)) || !scopes.includes(binding.requiredScope)
    || !user?.isActive || user.role !== 'ADMIN' || user.organizationId !== binding.organizationId || user.sessionVersion !== binding.sessionVersion || mustEnrollMfa(user)) throw unavailable();
}
