// Attribution is transaction-local, so pooled connections cannot carry an
// editor into a later request. Baselines and uninstrumented writers remain
// explicitly unattributed; never substitute the document's original author.
export async function attributeDocumentEdit(tx, actor) {
  if (typeof tx?.$executeRaw !== 'function' || !actor?.id) return false;
  await tx.$executeRaw`SELECT set_config('ashbi.actor_user_id', ${actor.id}, true)`;
  return true;
}
