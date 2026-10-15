import { z } from 'zod';
import { ACCOUNT_MANAGER_PLUGINS, clientBriefSchema, readClientAccountManagerBrief } from '../services/client-account-manager.service.js';

const read = (name, description, inputSchema, run) => ({
  name, description, class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema, timeoutMs: 10_000,
  resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
  run,
});

export const WORKSPACE_ACCOUNT_MANAGER_TOOLS = [
  read('list_account_manager_plugins',
    'List curated account-manager plugins implemented in this Hub build. This catalog does not grant access or establish external provider connections.',
    z.object({}).strict(), () => ({ plugins: ACCOUNT_MANAGER_PLUGINS })),
  read('get_client_account_manager_brief',
    'Read one client account-manager brief: project context, role-scoped work counts and source links. No model call, messages or mutations. Respect partial/truncated flags and hasMore; this is internal staff context, not an approved client update.',
    clientBriefSchema, ({ prisma, user, input }) => readClientAccountManagerBrief(prisma, user, input)),
];
