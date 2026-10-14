import { prisma } from '../config/db.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';
import { processRecurringTasks, processCompletionRepeats } from '../services/task-recurrence.service.js';

export async function processRecurringTasksForAllOrganizations() {
  return processForAllOrganizations(processRecurringTasks);
}

export async function processCompletionRepeatsForAllOrganizations() {
  return processForAllOrganizations(processCompletionRepeats);
}

async function processForAllOrganizations(processor) {
  const results = [];
  const failures = [];
  for (const organizationId of await resolveTenantOrganizationIds(prisma)) {
    try { results.push({ organizationId, ...await runTenantJob(prisma, organizationId, processor) }); }
    catch (error) { failures.push({ organizationId, code: error.code ?? 'RECURRENCE_FAILED' }); }
  }
  if (failures.length) throw Object.assign(new Error('Recurring task generation failed for some organizations'), { failures });
  return { organizations: results };
}
