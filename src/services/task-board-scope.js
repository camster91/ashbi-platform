export const normalizeTaskBoardId = boardId => boardId === 'DEFAULT' ? null : boardId;

export async function activeTaskBoard(prisma, projectId, boardId, organizationId) {
  if (!boardId || boardId === 'DEFAULT') return null;
  const board = await prisma.projectBoard.findFirst({ where: { id: boardId, projectId, archivedAt: null, ...(organizationId ? { organizationId } : {}), project: { deletedAt: null } } });
  if (!board) throw Object.assign(new Error('Board is unavailable in this project.'), { statusCode: 404 });
  return board;
}
export const taskBoardWhere = boardId => ({ boardId: !boardId || boardId === 'DEFAULT' ? null : boardId });
