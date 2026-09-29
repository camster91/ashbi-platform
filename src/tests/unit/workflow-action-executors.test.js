// Regression: the CREATE_TASK and UPDATE_DEAL_STAGE workflow executors read
// `workflow.name` from a variable that was never in scope. The DB write
// succeeded, then the activity log threw a ReferenceError, so the action was
// recorded as failed (run status PARTIAL) even though it had taken effect.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { executeWorkflow } = await import('../../services/automation.service.js');
const { requestStorage } = await import('../../utils/request-context.js');

function createFakeDb() {
  const calls = { activities: [], tasks: [], deals: [], runUpdates: [] };
  const db = {
    workflowRun: {
      create: async ({ data }) => ({ ...data }),
      update: async ({ data }) => { calls.runUpdates.push(data); return data; },
    },
    workflow: { update: async ({ data }) => data },
    project: { findUnique: async ({ where }) => ({ id: where.id }) },
    task: {
      create: async ({ data }) => {
        const task = { id: `task-${calls.tasks.length + 1}`, ...data };
        calls.tasks.push(task);
        return task;
      },
    },
    pipelineDeal: {
      update: async ({ where, data }) => {
        const deal = { id: where.id, title: 'Big deal', ...data };
        calls.deals.push(deal);
        return deal;
      },
    },
    user: { findFirst: async () => ({ id: 'admin-1' }) },
    activity: {
      create: async ({ data }) => { calls.activities.push(data); return data; },
    },
  };
  return { db, calls };
}

function run(db, workflow, triggerData) {
  return requestStorage.run({ prisma: db, organizationId: 'org-1' }, () => executeWorkflow(workflow, triggerData));
}

describe('workflow action executors', () => {
  it('CREATE_TASK succeeds and logs the owning workflow name', async () => {
    const { db, calls } = createFakeDb();
    const result = await run(db, {
      id: 'wf-1',
      name: 'Onboard client',
      actions: [{ type: 'CREATE_TASK', config: { title: 'Kickoff for {{clientName}}', projectId: 'proj-1' } }],
    }, { clientName: 'Acme' });

    assert.equal(result.status, 'SUCCESS', JSON.stringify(result.results));
    assert.equal(result.results[0].success, true);
    assert.equal(calls.tasks.length, 1);
    assert.equal(calls.tasks[0].title, 'Kickoff for Acme');
    assert.equal(calls.activities.length, 1);
    const metadata = JSON.parse(calls.activities[0].metadata);
    assert.equal(metadata.workflowName, 'Onboard client');
    assert.equal(metadata.actionType, 'CREATE_TASK');
  });

  it('UPDATE_DEAL_STAGE succeeds and logs the owning workflow name', async () => {
    const { db, calls } = createFakeDb();
    const result = await run(db, {
      id: 'wf-2',
      name: 'Advance deal',
      // The pre-execution validator requires `deal_id`; the executor reads
      // `dealId`. Supply both so this test exercises the executor itself.
      actions: [{ type: 'UPDATE_DEAL_STAGE', config: { deal_id: 'deal-1', dealId: 'deal-1', stage: 'WON' } }],
    });

    assert.equal(result.status, 'SUCCESS', JSON.stringify(result.results));
    assert.deepEqual(result.results[0].result, { dealId: 'deal-1', newStage: 'WON' });
    assert.equal(calls.deals.length, 1);
    const metadata = JSON.parse(calls.activities[0].metadata);
    assert.equal(metadata.workflowName, 'Advance deal');
    assert.equal(metadata.newStage, 'WON');
  });
});
