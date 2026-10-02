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

/**
 * "Pat Lee, Northwind Studio" for a sign-off line; '' when neither is known,
 * so a prompt can leave the signature to the sender.
 * @param {{ name?: string } | null | undefined} user
 * @param {string} organizationName
 */
export function signOffName(user, organizationName) {
  return [user?.name, organizationName].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

/** The prompt line asking for that sign-off, or for none when nobody is known. */
export function signOffInstruction(user, organizationName, verb = 'Sign off as') {
  const signOff = signOffName(user, organizationName);
  return signOff ? `${verb} ${signOff}.` : 'Leave the signature for the sender to add.';
}
