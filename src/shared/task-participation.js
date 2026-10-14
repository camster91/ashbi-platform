export function taskParticipationWhere(userId) {
  return { OR: [{ assigneeId: userId }, { collaborators: { some: { userId } } }] };
}
