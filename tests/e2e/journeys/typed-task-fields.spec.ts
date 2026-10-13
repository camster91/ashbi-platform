import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('typed fields and canonical relations persist through editing, reload and archival', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdminThroughUi(page);
  const admin = page.request;
  const { client, suffix } = await createClientWithContact(admin, 'Typed fields QA');
  const project = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Typed fields ${suffix}` } }), 201);
  const task = await json(await admin.post(`/api/tasks/${project.id}/quick`, { data: { title: `Typed values ${suffix}` } }));
  await page.goto(`/project/${project.id}/fields`);
  for (const [name, type] of [['Next action', 'TEXT'], ['Estimate', 'NUMBER'], ['Review date', 'DATE'], ['Approval required', 'BOOLEAN'], ['Reference', 'URL'], ['Outcome', 'SELECT'], ['Services', 'MULTI_SELECT'], ['Related client', 'RELATION']]) {
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel(/^Field \d+ name$/).last().fill(name);
    await page.getByLabel(/^Field \d+ type$/).last().selectOption(type);
    if (['SELECT', 'MULTI_SELECT'].includes(type)) await page.getByLabel(/^Field \d+ choices$/).last().fill('Design\nDevelopment');
    if (type === 'RELATION') await page.getByLabel(/^Field \d+ relation$/).last().selectOption('CLIENT');
  }
  await page.getByRole('button', { name: 'Save field definitions' }).click();
  await expect(page.getByRole('status')).toHaveText('Field definitions saved.');
  const definitions = await json(await admin.get(`/api/projects/${project.id}/task-fields`));
  expect(definitions.fields).toHaveLength(8);
  await page.goto(`/task/${task.id}`);
  await page.getByLabel('Next action', { exact: true }).fill('Send design for review');
  await page.getByLabel('Estimate', { exact: true }).fill('0');
  await page.getByLabel('Review date', { exact: true }).fill('2028-02-29');
  await page.getByLabel('Approval required', { exact: true }).selectOption('false');
  await page.getByLabel('Reference', { exact: true }).fill('https://example.com/design');
  await page.getByLabel('Outcome', { exact: true }).selectOption('Design');
  await page.getByLabel('Services', { exact: true }).selectOption(['Design', 'Development']);
  await page.getByLabel('Search Related client relations').fill(client.name);
  await expect(page.getByRole('option', { name: client.name, exact: true })).toBeAttached();
  await page.getByLabel('Related client', { exact: true }).selectOption({ label: client.name });
  await page.getByRole('button', { name: 'Save custom fields' }).click();
  await expect(page.getByText('Custom fields saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Next action', { exact: true })).toHaveValue('Send design for review');
  await expect(page.getByLabel('Estimate', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Approval required', { exact: true })).toHaveValue('false');
  await expect(page.getByLabel('Related client', { exact: true })).toHaveValue(client.id);
  const values = await json(await admin.get(`/api/tasks/${task.id}/fields`));
  expect(values.values[definitions.fields.find((field: any) => field.name === 'Services').key]).toEqual(['Design', 'Development']);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const result = await new AxeBuilder({ page }).include('[aria-label="Custom task fields"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
  await page.goto(`/project/${project.id}/views`);
  await page.getByRole('checkbox', { name: 'Estimate', exact: true }).check();
  await page.getByLabel('Task view name').fill('Estimates');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Estimate', exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByRole('cell', { name: '0', exact: true })).toBeVisible();
  const view = await json(await admin.get(`/api/projects/${project.id}/task-views`));
  expect(view.views[0].columns).toEqual([definitions.fields.find((field: any) => field.name === 'Estimate').key]);
  await page.goto(`/project/${project.id}/fields`);
  await page.getByRole('checkbox', { name: 'Archived', exact: true }).first().check();
  await page.getByRole('button', { name: 'Save field definitions' }).click();
  await expect(page.getByRole('status')).toHaveText('Field definitions saved.');
  await page.goto(`/task/${task.id}`);
  await expect(page.getByRole('region', { name: 'Custom task fields' })).toBeVisible();
  await expect(page.getByLabel('Next action', { exact: true })).toHaveCount(0);
  const archived = await json(await admin.get(`/api/tasks/${task.id}/fields`));
  expect(archived.values[definitions.fields[0].key]).toBe('Send design for review');
});
