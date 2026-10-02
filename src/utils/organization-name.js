// The display name of the signed-in person's organization, for AI prompts and
// email signatures that must not hard-code one agency's name.

/**
 * @param {{ user?: { organizationId?: string }, prisma?: any }} request
 * @returns {Promise<string>} '' when unknown
 */
export async function organizationNameFor(request) {
  if (!request?.user?.organizationId || !request.prisma?.organization) return '';
  try {
    const organization = await request.prisma.organization.findUnique({
      where: { id: request.user.organizationId },
      select: { name: true },
    });
    return typeof organization?.name === 'string' ? organization.name.trim() : '';
  } catch {
    return '';
  }
}

/**
 * "Pat Lee at Northwind Studio" style wording for prompts, skipping parts
 * that are missing.
 * @param {{ name?: string } | null | undefined} user
 * @param {string} organizationName
 */
export function senderDescription(user, organizationName) {
  const name = String(user?.name || '').trim();
  const org = String(organizationName || '').trim();
  if (name && org) return `${name} at ${org}`;
  return name || org || 'the agency team';
}
