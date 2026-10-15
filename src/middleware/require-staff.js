export async function requireStaff(request, reply) {
  if (!request.user?.organizationId || !['ADMIN', 'TEAM'].includes(request.user?.role)) {
    return reply.code(403).send({ error: 'Staff access required', code: 'ROLE_DENIED' });
  }
}
