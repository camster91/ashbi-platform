/** BullMQ 6 cannot process legacy v5 repeat metadata. Inspect without cleanup:
 * getJobSchedulers() may delete stale keys, so use the supported backend read
 * methods instead. Legacy definitions must be removed by the prior v5 release.
 */
export async function assertSchedulerMigration(queues) {
  for (const queue of queues) {
    const backend = queue.getBackend();
    const entries = await backend.getJobSchedulersRange(0, 200, true);
    if (!Array.isArray(entries) || entries.length % 2 || entries.length > 400) {
      throw new Error(`Scheduler migration check exceeded its bound for ${queue.name}`);
    }
    for (let index = 0; index < entries.length; index += 2) {
      // Both hashed legacy IDs and old colon-delimited IDs lack scheduler ic.
      // Do not guess from job names: new schedules deliberately use them too.
      if (!await backend.isJobScheduler(entries[index])) {
        throw new Error(`Legacy or incomplete repeat metadata in ${queue.name}; migrate with BullMQ v5 before starting v6`);
      }
    }
  }
}
