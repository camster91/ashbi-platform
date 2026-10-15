/* global document */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { json, loginAdminThroughUi } from './support';

test('standalone typed records, formulas and reusable forms persist through real UI writes', async ({ page }) => {
  await loginAdminThroughUi(page);
  const api = page.request, suffix = Date.now(), name = `Shared records ${suffix}`;
  await page.goto('/collections');
  await page.getByText('New collection', { exact: true }).click();
  await page.getByLabel('Collection name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: /^Work portfolio/ }).selectOption('FREELANCE');
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const collectionId = page.url().split('/').at(-1);
  await page.getByRole('button', { name: 'Configure collection', exact: true }).click();
  for (const [fieldName, type] of [['Hours', 'NUMBER'], ['Approved', 'BOOLEAN'], ['Total', 'FORMULA']]) {
    await page.getByRole('button', { name: 'Add field', exact: true }).click();
    await page.getByLabel('Field name', { exact: true }).fill(fieldName);
    await page.getByRole('combobox', { name: /^Field type/ }).selectOption(type);
    if (type === 'NUMBER') await page.getByLabel('Require field', { exact: true }).check();
    if (type === 'FORMULA') {
      await page.getByRole('combobox', { name: /^Formula type/ }).selectOption('multiply');
      await page.getByRole('combobox', { name: /^Formula operand 1 type/ }).selectOption('field');
      await page.getByRole('combobox', { name: /^Formula operand 1 field/ }).selectOption({ label: 'Hours' });
      await page.getByLabel('Formula operand 2 number', { exact: true }).fill('50');
    }
  }
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Configure collection', exact: true })).toBeVisible();
  let collection = await json(await api.get(`/api/collections/${collectionId}`));
  expect(collection.portfolio).toBe('FREELANCE'); expect(collection.fields).toHaveLength(3);
  expect(collection.projectId).toBeUndefined(); expect(collection.clientId).toBeUndefined();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByLabel('Record title', { exact: true }).fill('Zero estimate');
  await page.getByLabel('Hours (required)', { exact: true }).fill('0');
  await page.getByRole('combobox', { name: /^Approved/ }).selectOption('false');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Zero estimate', exact: true })).toBeVisible();
  let rows = await json(await api.get(`/api/collections/${collectionId}/records`));
  expect(rows.items[0].values.field_1).toBe(0); expect(rows.items[0].values.field_2).toBe(false);
  expect(rows.items[0].computed.field_3.value).toBe(0);
  await page.getByRole('button', { name: 'Edit Zero estimate', exact: true }).click();
  await page.getByLabel('Hours (required)', { exact: true }).fill('4');
  const savedRecordResponse = page.waitForResponse(response =>
    response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === `/api/collections/${collectionId}/records/${rows.items[0].id}`);
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  const saveResponse = await savedRecordResponse;
  expect(saveResponse.status()).toBe(200);
  const savedRecord = await saveResponse.json();
  expect(savedRecord.values.field_1).toBe(4);
  expect(savedRecord.computed.field_3.value).toBe(200);
  await expect(page.getByRole('button', { name: 'Edit Zero estimate', exact: true })).toBeEnabled();
  rows = await json(await api.get(`/api/collections/${collectionId}/records`));
  expect(rows.items[0].computed.field_3.value).toBe(200);
  await page.reload();
  await expect(page.getByText('200', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New reusable form', exact: true }).click();
  await page.getByLabel('Form name', { exact: true }).fill('Work log');
  await page.getByRole('button', { name: 'Save form', exact: true }).click();
  await page.getByRole('button', { name: 'Use Work log', exact: true }).click();
  await page.getByLabel('Record title', { exact: true }).fill('Via form');
  await page.getByLabel('Hours (required)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Submit form', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Via form', exact: true })).toBeVisible();
  rows = await json(await api.get(`/api/collections/${collectionId}/records`));
  expect(rows.items).toHaveLength(2);
  // A real schema edit invalidates the pinned form until explicit review.
  await page.getByRole('button', { name: 'Configure collection', exact: true }).click();
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Field name', { exact: true }).fill('Brief');
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use Work log', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review Work log', exact: true }).click();
  await page.getByRole('button', { name: 'Save form', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use Work log', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Archive Zero estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Zero estimate', exact: true })).toHaveCount(0);
  await page.getByLabel('Show archived records', { exact: true }).check();
  await page.getByRole('button', { name: 'Restore Zero estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Zero estimate', exact: true })).toBeVisible();
  collection = await json(await api.get(`/api/collections/${collectionId}`));
  expect(collection.fields).toHaveLength(4);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
