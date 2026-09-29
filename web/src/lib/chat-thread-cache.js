// Chat history is a list of threads (top-level messages), each carrying its
// replies. Live edit/delete events can target either level, so the cached
// list is updated at both.

/** Replace an edited message, at the top level or among a thread's replies. */
export function applyChatEdit(threads = [], edited) {
  return threads.map((thread) => {
    if (thread.id === edited.id) return { ...thread, ...edited, replies: edited.replies ?? thread.replies };
    if (!Array.isArray(thread.replies) || !thread.replies.some((reply) => reply.id === edited.id)) return thread;
    return { ...thread, replies: thread.replies.map((reply) => (reply.id === edited.id ? { ...reply, ...edited } : reply)) };
  });
}

/** Remove a hard-deleted message, at the top level or among a thread's replies
 * (keeping the thread's replyCount in step). */
export function applyChatDelete(threads = [], messageId) {
  return threads
    .filter((thread) => thread.id !== messageId)
    .map((thread) => (Array.isArray(thread.replies) && thread.replies.some((reply) => reply.id === messageId)
      ? {
        ...thread,
        replies: thread.replies.filter((reply) => reply.id !== messageId),
        ...(typeof thread.replyCount === 'number' ? { replyCount: Math.max(0, thread.replyCount - 1) } : {}),
      }
      : thread));
}
