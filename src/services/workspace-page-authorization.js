const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export async function currentWikiStaff(prisma, actor) {
  if (!actor?.organizationId || !['ADMIN', 'TEAM'].includes(actor.role)) fail(403, 'Team access required');
  const current = await prisma.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, organizationId: true, role: true } });
  if (!current) fail(403, 'Team access required');
  return current;
}
export function pageAccessSelect(userId) {
  return { id: true, organizationId: true, parentId: true, authorId: true, accessMode: true, accessRevision: true, archivedAt: true, grants: { where: { userId }, select: { role: true } } };
}

// One request-local cache, bounded batches, no titles/content/other staff rosters.
// Every ancestor must permit reading; a child's grant never opens a private parent.
export async function pageAccessContext(prisma, actor) {
  const user = await currentWikiStaff(prisma, actor);
  const cache = new Map();
  async function load(ids, seed = []) {
    for (const row of seed) if (row.organizationId === user.organizationId) cache.set(row.id, row);
    let missing = [...new Set(ids)].filter(id => !cache.has(id));
    // Seed rows may already have parents which still need authorization.
    let parents = user.role === 'ADMIN' ? [] : seed.map(row => row.parentId).filter(id => id && !cache.has(id));
    missing = [...new Set([...missing, ...parents])];
    for (let depth = 0; missing.length && depth <= 200; depth++) {
      parents = [];
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        const rows = await prisma.workspacePage.findMany({ where: { id: { in: batch }, organizationId: user.organizationId }, select: pageAccessSelect(user.id), take: 100 });
        for (const id of batch) cache.set(id, null);
        for (const row of rows) {
          cache.set(row.id, row);
          if (user.role !== 'ADMIN' && row.parentId && !cache.has(row.parentId)) parents.push(row.parentId);
        }
      }
      missing = [...new Set(parents)].filter(id => !cache.has(id));
    }
  }
  function rights(id) {
    const page = cache.get(id);
    if (!page) return { canRead: false, canEdit: false, canManage: false };
    if (user.role === 'ADMIN') return { canRead: true, canEdit: true, canManage: true };
    const own = page.authorId === user.id;
    let canEdit = true;
    const seen = new Set(); let current = page;
    for (let depth = 0; current && depth <= 200; depth++) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      const allowed = current.accessMode === 'TEAM' || current.authorId === user.id || (current.accessMode === 'RESTRICTED' && current.grants?.some(grant => ['READ', 'EDIT'].includes(grant.role)));
      if (!allowed) break;
      canEdit = Boolean(canEdit && (current.accessMode === 'TEAM' || current.authorId === user.id || current.grants?.some(grant => grant.role === 'EDIT')));
      if (!current.parentId) return { canRead: true, canEdit, canManage: own && canEdit };
      current = cache.get(current.parentId);
    }
    return { canRead: false, canEdit: false, canManage: false };
  }
  return { user, load, rights, clear: () => cache.clear() };
}
export async function authorizeWorkspacePage(prisma, id, actor, { edit = false, manage = false, includeArchived = true } = {}) {
  const access = await pageAccessContext(prisma, actor);
  await access.load([id]);
  const permissions = access.rights(id);
  if (!permissions.canRead) fail(404, 'Knowledge page not found');
  if (edit && !permissions.canEdit) fail(403, 'This page is read only');
  if (manage && !permissions.canManage) fail(403, 'The page owner or an administrator manages hierarchy, archive and access');
  const page = await prisma.workspacePage.findFirst({ where: { id, organizationId: access.user.organizationId, ...(includeArchived ? {} : { archivedAt: null }) } });
  if (!page) fail(404, 'Knowledge page not found');
  return { page, user: access.user, permissions };
}
