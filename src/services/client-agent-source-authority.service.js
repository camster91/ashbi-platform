import { recordNotFound } from '../ai/tools/registry.js';
import { authorizeWorkspaceChatMember } from './workspace-chat.service.js';

export const conversationAudience = conversation => conversation.sourceChannelId ? 'WORKSPACE_CHANNEL' : 'SHARED_STAFF';
// Ordinary assistant pickers enumerate shared conversations only. Channel-bound
// history lives in the explicit workspace pilot surface, never a shared picker.
export const sharedConversationWhere = () => ({ sourceChannelId: null, sourceBindingId: null });

export async function authorizeSourceConversation(prisma, actor, conversation, { lock = false, active = false } = {}) {
  if (!conversation.sourceChannelId && !conversation.sourceBindingId) return null;
  if (!conversation.sourceChannelId || !conversation.sourceBindingId) throw recordNotFound();
  const { channel } = await authorizeWorkspaceChatMember(prisma, actor, conversation.sourceChannelId, { lock });
  const binding = await prisma.workspaceAccountManagerBinding.findFirst({ where: {
    id: conversation.sourceBindingId, organizationId: actor.organizationId, channelId: channel.id, clientId: conversation.clientId,
  } });
  if (!binding || binding.channelId !== channel.id || binding.clientId !== conversation.clientId || binding.organizationId !== actor.organizationId
    || !['CLIENT', 'PROJECT'].includes(channel.kind) || channel.clientId !== conversation.clientId || binding.projectId !== channel.projectId
    || (active && !binding.enabled)) throw recordNotFound();
  return { binding, channel };
}
