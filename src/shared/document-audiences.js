// Permission algebra for complete child-to-root metadata paths. Services must
// resolve fresh active staff and normalize each node's organization/project
// ownership before calling this module; no content or title is needed here.
const denied = Object.freeze({ canRead: false, canEdit: false, canManage: false });
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 80;
const intersect = (a, b) => a === null ? b : b === null ? a : new Set([...a].filter(id => b.has(id)));
const ids = value => value === null ? null : Array.isArray(value) && value.length <= 10000 && value.every(validId) ? new Set(value) : undefined;

function pathIsValid(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 200) return false;
  const seen = new Set();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node || !validId(node.id) || !validId(node.authorId) || !validId(node.organizationId) || seen.has(node.id) || node.organizationId !== nodes[0].organizationId || node.projectId !== nodes[0].projectId) return false;
    seen.add(node.id);
    if (index + 1 < nodes.length ? node.parentId !== nodes[index + 1].id : node.parentId != null) return false;
  }
  return true;
}

/** null audience means all current active organization staff, never anonymous
 * or client access. Explicit sets contain owner/grantee ids, not current admins:
 * administrator bypass is evaluated using the actor's current role on reads.
 */
export function composeDocumentAudience(nodes) {
  if (!pathIsValid(nodes)) throw new Error('A complete same-workspace document path is required.');
  let read = null, edit = null;
  for (const node of nodes) {
    if (!['TEAM', 'RESTRICTED'].includes(node.accessMode) || !Array.isArray(node.grants) || node.grants.length > 1000 || node.grants.some(grant => !validId(grant.userId) || !['READ', 'EDIT'].includes(grant.role))) throw new Error('Invalid document audience metadata.');
    if (node.accessMode === 'RESTRICTED') {
      read = intersect(read, new Set([node.authorId, ...node.grants.map(grant => grant.userId)]));
      edit = intersect(edit, new Set([node.authorId, ...node.grants.filter(grant => grant.role === 'EDIT').map(grant => grant.userId)]));
    }
    if (node.audienceBarrier != null) {
      const barrier = node.audienceBarrier;
      if (typeof barrier !== 'object' || Array.isArray(barrier) || Object.keys(barrier).some(key => !['readUserIds', 'editUserIds'].includes(key))) throw new Error('Invalid inherited audience barrier.');
      const readers = ids(barrier.readUserIds), editors = ids(barrier.editUserIds);
      if (readers === undefined || editors === undefined) throw new Error('Invalid inherited audience barrier.');
      read = intersect(read, readers); edit = intersect(edit, editors);
    }
  }
  // A malformed historical editor superset can never confer unreadable edit.
  edit = intersect(edit, read);
  return { readUserIds: read === null ? null : [...read].sort(), editUserIds: edit === null ? null : [...edit].sort() };
}

export function documentAudienceRights(nodes, actor) {
  const root = Array.isArray(nodes) ? nodes[0] : null;
  if (!actor || !validId(actor.id) || !validId(actor.organizationId) || actor.isActive === false || !['ADMIN', 'TEAM'].includes(actor.role) || root?.organizationId !== actor.organizationId) return denied;
  // Same-workspace administrators can repair damaged metadata. This does not
  // make foreign documents readable or let stale/deactivated roles through.
  if (actor.role === 'ADMIN') return { canRead: true, canEdit: true, canManage: true };
  try {
    const audience = composeDocumentAudience(nodes);
    const canRead = audience.readUserIds === null || audience.readUserIds.includes(actor.id);
    const canEdit = canRead && (audience.editUserIds === null || audience.editUserIds.includes(actor.id));
    return { canRead, canEdit, canManage: canEdit && root.authorId === actor.id };
  } catch { return denied; }
}
