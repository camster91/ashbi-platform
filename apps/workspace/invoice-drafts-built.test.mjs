// Run the same persistence/financial contracts against the deployable module.
process.env.WORKSPACE_TEST_BUILT_WORKER='1';
await import('./invoice-drafts.test.mjs');
