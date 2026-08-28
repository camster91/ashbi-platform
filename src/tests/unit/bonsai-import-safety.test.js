import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fullImporter = new URL('../../../scripts/import-bonsai-full.js', import.meta.url);
const legacyImporter = new URL('../../../scripts/import-bonsai.js', import.meta.url);

test('Bonsai full importer requires an explicit tenant and scopes imported records', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /--organization-id/);
  assert.match(source, /--approved-summary/);
  assert.match(source, /--summary-file/);
  assert.match(source, /--tasks-json/);
  assert.match(source, /--tasks-csv/);
  assert.match(source, /--connections-csv/);
  assert.match(source, /--projects-csv/);
  assert.match(source, /--projects-json/);
  assert.match(source, /--invoices-csv/);
  assert.match(source, /--time-entries-csv/);
  assert.match(source, /--expenses-csv/);
  assert.match(source, /--addresses-csv/);
  assert.match(source, /IMPORT_ORGANIZATION_ID/);
  assert.match(source, /organizationId: ORGANIZATION_ID/);
  const expenseCreate = source.slice(source.indexOf('await prisma.expense.create'), source.indexOf('stats.expenses.created'));
  assert.match(expenseCreate, /organizationId: ORGANIZATION_ID/);
  const expenseLookup = source.slice(source.indexOf('const existing = await prisma.expense.findFirst'), source.indexOf('await prisma.expense.create'));
  assert.match(expenseLookup, /organizationId: ORGANIZATION_ID/);
  assert.match(source, /Organization not found/);
  assert.match(source, /assessMigrationSandboxTarget/);
  assert.match(source, /sandboxTarget\.targetFingerprint/);
  assert.match(source, /verifyBonsaiProjectCsvSnapshotBinding/);
  assert.match(source, /registerOperatingSource\('PROJECT'/);
  assert.match(source, /registerOperatingSource\('TASK'/);
  assert.doesNotMatch(source, /password:\s*'imported-no-login'/);
  assert.match(source, /mappedToImporter/);
});

test('confirmed Bonsai imports are atomic and reject unresolved reconciliation errors', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /prisma\.\$transaction\(/);
  assert.match(source, /prisma\.operatingSourceRecord\.create/);
  assert.match(source, /assessBonsaiOperatingSourceRecord/);
  assert.match(source, /Live import cannot complete with unresolved reconciliation findings/);
  assert.match(source, /if \(!DRY_RUN && stats\.errors\.length > 0\)/);
  assert.match(source, /requireMutationAuthorization: CONFIRM_LIVE/);
});

test('Bonsai Connections export promotes only evidence-linked clients and preserves all mapped contacts', async () => {
  const source = await readFile(fullImporter, 'utf8');
  const clientBlock = source.slice(source.indexOf('// STEP 1: CLIENTS'), source.indexOf('// STEP 2: PROJECTS'));
  assert.match(source, /mapBonsaiConnections/);
  assert.match(clientBlock, /connectionMapping\.findings/);
  assert.match(clientBlock, /for \(const sourceContact of data\.contacts\)/);
  assert.match(clientBlock, /source contacts resolve to multiple Hub clients/);
  assert.doesNotMatch(clientBlock, /for \(const row of clientsRaw\)[\s\S]*row\.Name[\s\S]*clientDataMap\.set/);
});

test('Bonsai importer treats tasks as source-bound evidence and never guesses project or owner identity', async () => {
  const source = await readFile(fullImporter, 'utf8');
  const taskBlock = source.slice(source.indexOf('// STEP 3: TASKS'), source.indexOf('// STEP 4: INVOICES'));
  assert.match(taskBlock, /bonsaiTaskId/);
  assert.match(taskBlock, /no exact Bonsai project ID match/);
  assert.match(taskBlock, /no exact organization owner match/);
  assert.match(taskBlock, /archived source task requires an explicit retention decision/);
  assert.match(taskBlock, /Existing Hub record differs/);
  assert.match(taskBlock, /bonsaiLegacyTaskId/);
  assert.match(taskBlock, /parent destination is unavailable/);
  assert.match(taskBlock, /prisma\.task\.update/);
  assert.doesNotMatch(taskBlock, /prisma\.project\.findFirst/);
  assert.doesNotMatch(taskBlock, /prisma\.user\.create/);
});

test('Bonsai importer uses exact CSV number parsing and retains malformed money as findings', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /import \{ parseBonsaiMoney, parseBonsaiDecimal \}/);
  assert.doesNotMatch(source, /parseFloat\(|function parseFloat2/);
  assert.match(source, /project budget is malformed/);
  assert.match(source, /invoice totals are malformed/);
  assert.match(source, /time-entry rate is malformed/);
  assert.match(source, /expense amount is malformed/);
});

test('Bonsai importer does not treat near-matching time or expense rows as reconciled', async () => {
  const source = await readFile(fullImporter, 'utf8');
  const timeBlock = source.slice(source.indexOf('// STEP 5: TIME ENTRIES'), source.indexOf('// STEP 6: EXPENSES'));
  assert.match(timeBlock, /sourceDifferences\(timeEntryData, existing/);
  assert.match(timeBlock, /description', 'billable', 'hourlyRate', 'source'/);
  assert.match(timeBlock, /Existing Hub record differs/);
  const expenseBlock = source.slice(source.indexOf('// STEP 6: EXPENSES'));
  assert.match(expenseBlock, /currency,/);
  assert.match(expenseBlock, /projectId: projectId \|\| null/);
  assert.match(expenseBlock, /sourceDifferences\(expenseData, existing/);
  assert.match(expenseBlock, /category', 'billable'/);
});

test('Bonsai importer never drops unresolved client or project identity', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /missing immutable Bonsai project ID/);
  assert.match(source, /multiple exact Bonsai projects require consolidation/);
  const timeBlock = source.slice(source.indexOf('// STEP 5: TIME ENTRIES'), source.indexOf('// STEP 6: EXPENSES'));
  assert.doesNotMatch(timeBlock, /Try to find any project with this title/);
  assert.doesNotMatch(timeBlock, /prisma\.project\.findFirst/);
  assert.match(timeBlock, /no exact client\/project match/);
  const expenseBlock = source.slice(source.indexOf('// STEP 6: EXPENSES'));
  assert.match(expenseBlock, /no client match/);
  assert.match(expenseBlock, /no exact client\/project match/);
});

test('Bonsai reconciliation reports are owner-only, never overwrite evidence, and follow a committed import', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /fs\.openSync\(summaryDestination, 'wx', 0o600\)/);
  assert.match(source, /const reconciliation = DRY_RUN\s*\? await runImport\(prisma\)\s*:\s*await prisma\.\$transaction/);
  assert.match(source, /writeSummary\(reconciliation\)/);
  assert.match(source, /state: 'RESERVED'/);
  assert.match(source, /return reconciliation;/);
});

test('legacy Bonsai importer fails closed instead of writing unscoped records', async () => {
  const source = await readFile(legacyImporter, 'utf8');
  assert.match(source, /legacy importer is disabled/);
  assert.match(source, /process\.exitCode = 2/);
  assert.match(source, /import-bonsai-full\.js/);
});
