import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import RecordCollections from '../pages/RecordCollections';
import RecordCollection from '../pages/RecordCollection';
import { recordDisplayValue } from '../components/RecordValueInput';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: Object.fromEntries(['getRecordCollections', 'getRecordCollection', 'createRecordCollection', 'updateRecordCollection', 'getCollectionRecords', 'createCollectionRecord', 'updateCollectionRecord', 'getRecordRelationOptions', 'getCollectionForms', 'createCollectionForm', 'updateCollectionForm', 'submitCollectionForm'].map(key => [key, vi.fn()])) }));
const fields = [{ key: 'hours', name: 'Hours', type: 'NUMBER', required: true }, { key: 'approved', name: 'Approved', type: 'BOOLEAN' }, { key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT' }, { key: 'total', name: 'Total', type: 'FORMULA', expression: { field: 'hours' } }];
const collection = { id: 'col', name: 'Work records', description: 'Shared briefs', revision: 1, schemaRevision: 1, fields, archivedAt: null };
const record = { id: 'rec', title: 'Brief', revision: 3, definitionRevision: 1, values: { hours: 0, approved: false, client: ['old'] }, relations: { client: [{ id: 'old', name: 'Unavailable record', available: false }] }, computed: { total: { value: 0, error: null, type: 'NUMBER' } }, archivedAt: null };
const form = { id: 'form', revision: 4, needsReview: false, configuration: { name: 'Work log', definitionRevision: 1, fields: [{ key: 'hours', required: true, defaultValue: 0 }, { key: 'approved', required: false, defaultValue: false }] } };
function mount(url = '/collections/col') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[url]}><Routes><Route path="/collections" element={<RecordCollections />} /><Route path="/collections/:collectionId" element={<RecordCollection />} /></Routes></MemoryRouter></QueryClientProvider>);
  return cache;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getRecordCollection.mockResolvedValue(collection);
  api.getRecordCollections.mockResolvedValue({ items: [], nextCursor: null });
  api.getCollectionRecords.mockResolvedValue({ items: [record], nextCursor: null });
  api.getCollectionForms.mockResolvedValue({ items: [form], nextCursor: null });
  api.getRecordRelationOptions.mockResolvedValue({ items: [], nextCursor: null });
});
it('creates a standalone shared portfolio collection and navigates to its canonical ID', async () => {
  api.createRecordCollection.mockResolvedValue(collection);
  mount('/collections');
  fireEvent.click(screen.getByText('New collection'));
  fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Work records' } });
  fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: 'FREELANCE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
  await screen.findByRole('heading', { name: 'Work records' });
  expect(api.createRecordCollection).toHaveBeenCalledWith({ name: 'Work records', description: '', portfolio: 'FREELANCE' });
});
it('retains pinned revisions and drafts when background refresh and a stale save conflict', async () => {
  let current = collection;
  api.getRecordCollection.mockImplementation(async () => current);
  api.updateCollectionRecord.mockRejectedValue(new Error('Record changed. Your draft is retained.'));
  const cache = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Brief' }));
  fireEvent.change(screen.getByLabelText('Record title'), { target: { value: 'My draft' } });
  current = { ...collection, schemaRevision: 2, revision: 2 };
  await cache.invalidateQueries({ queryKey: ['recordCollection', 'col'] });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await screen.findByRole('alert');
  expect(api.updateCollectionRecord).toHaveBeenCalledWith('col', 'rec', { title: 'My draft', revision: 3, definitionRevision: 1 });
  expect(screen.getByLabelText('Record title')).toHaveValue('My draft');
});
it('creates typed false/zero input without submitting computed fields', async () => {
  api.createCollectionRecord.mockResolvedValue({ id: 'created' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'New record' }));
  fireEvent.change(screen.getByLabelText('Record title'), { target: { value: 'Zero estimate' } });
  fireEvent.change(screen.getByLabelText('Hours (required)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Approved'), { target: { value: 'false' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await waitFor(() => expect(api.createCollectionRecord).toHaveBeenCalledWith('col', { title: 'Zero estimate', definitionRevision: 1, values: { hours: 0, approved: false, client: null } }));
});
it('relation choices page past the first page and can clear an unavailable historical link', async () => {
  api.getRecordRelationOptions.mockImplementation(async (_id, _key, query) => ({ items: [{ id: query.after ? 'second' : 'first', name: query.after ? 'Second client' : 'First client' }], nextCursor: query.after ? null : 'next' }));
  api.updateCollectionRecord.mockResolvedValue(record);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Brief' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Load more Client choices' }));
  await screen.findByLabelText('Second client');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Client: Unavailable record' }));
  fireEvent.click(screen.getByLabelText('Second client'));
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await waitFor(() => expect(api.updateCollectionRecord).toHaveBeenCalledWith('col', 'rec', expect.objectContaining({ values: { client: ['second'] }, revision: 3, definitionRevision: 1 })));
});
it('submits form defaults with the exact form and definition revisions', async () => {
  api.submitCollectionForm.mockResolvedValue({ id: 'submitted' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Use Work log' }));
  fireEvent.change(screen.getByLabelText('Record title'), { target: { value: 'Form entry' } });
  expect(screen.getByLabelText('Hours (required)')).toHaveValue(0);
  expect(screen.getByLabelText('Approved')).toHaveValue('false');
  fireEvent.click(screen.getByRole('button', { name: 'Submit form' }));
  await waitFor(() => expect(api.submitCollectionForm).toHaveBeenCalledWith('col', 'form', { title: 'Form entry', revision: 4, definitionRevision: 1, values: { hours: 0, approved: false } }));
});
it('requires explicit stale form review and preserves typed defaults during review', async () => {
  api.getCollectionForms.mockResolvedValue({ items: [{ ...form, needsReview: true, configuration: { ...form.configuration, definitionRevision: 0 } }], nextCursor: null });
  api.updateCollectionForm.mockResolvedValue(form);
  mount();
  expect(await screen.findByRole('button', { name: 'Use Work log' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review Work log' }));
  expect(screen.getByLabelText('Include Hours (required)')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
  await waitFor(() => expect(api.updateCollectionForm).toHaveBeenCalledWith('col', 'form', { revision: 4, configuration: { name: 'Work log', definitionRevision: 1, fields: [{ key: 'hours', label: 'Hours', help: '', required: true, defaultValue: 0 }, { key: 'approved', label: 'Approved', help: '', required: false, defaultValue: false }] } }));
});
it('archived collections retain readable records without create/edit/restore controls', async () => {
  api.getRecordCollection.mockResolvedValue({ ...collection, archivedAt: '2026-10-14' });
  mount();
  await screen.findByText(/This collection is archived/);
  expect(screen.queryByRole('button', { name: 'New record' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Brief' })).not.toBeInTheDocument();
  await waitFor(() => expect(api.getCollectionRecords).toHaveBeenCalledWith('col', expect.objectContaining({ includeArchived: 'true' })));
});
it('renders missing, falsy and failed calculations distinctly', () => {
  expect(recordDisplayValue(fields[0], record)).toBe('0');
  expect(recordDisplayValue(fields[1], record)).toBe('false');
  expect(recordDisplayValue(fields[3], record)).toBe('0');
  expect(recordDisplayValue(fields[3], { ...record, computed: { total: { value: null, error: 'INCOMPLETE_RELATION' } } })).toBe('Cannot calculate: incomplete relation');
  expect(recordDisplayValue(fields[0], { values: {} })).toBe('—');
});

it('configures a new formula through typed controls with a pinned collection revision', async () => {
  api.updateRecordCollection.mockResolvedValue({ ...collection, revision: 2, schemaRevision: 2 });
  const cache = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Configure collection' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Estimate' } });
  fireEvent.change(screen.getByLabelText('Field type'), { target: { value: 'FORMULA' } });
  fireEvent.change(screen.getByLabelText('Formula type'), { target: { value: 'multiply' } });
  fireEvent.change(screen.getByLabelText('Formula operand 1 type'), { target: { value: 'field' } });
  fireEvent.change(screen.getByLabelText('Formula operand 1 field'), { target: { value: 'hours' } });
  api.getRecordCollection.mockResolvedValue({ ...collection, revision: 9, schemaRevision: 9 });
  await cache.invalidateQueries({ queryKey: ['recordCollection', 'col'] });
  fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
  await waitFor(() => expect(api.updateRecordCollection).toHaveBeenCalledWith('col', expect.objectContaining({ revision: 1, fields: expect.arrayContaining([expect.objectContaining({ name: 'Estimate', type: 'FORMULA', expression: { op: 'multiply', args: [{ field: 'hours' }, { literal: 0 }] } })]) })));
});

it('protects stored field types and preserves the field draft after a schema conflict', async () => {
  api.updateRecordCollection.mockRejectedValue(new Error('Collection changed. Reload before saving.'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Configure collection' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hours', exact: true }));
  expect(screen.getByLabelText('Field type')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Estimated hours' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Field name')).toHaveValue('Estimated hours');
});

it('restores archived forms with the exact revision while leaving stale forms under review', async () => {
  api.getCollectionForms.mockImplementation(async (_id, query) => ({ items: query.includeArchived === 'true' ? [{ ...form, archivedAt: '2026-10-14', needsReview: true }] : [], nextCursor: null }));
  api.updateCollectionForm.mockResolvedValue(form);
  mount();
  await screen.findByRole('heading', { name: 'Work records' });
  fireEvent.click(screen.getByLabelText('Show archived forms'));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore Work log' }));
  await waitFor(() => expect(api.updateCollectionForm).toHaveBeenCalledWith('col', 'form', { revision: 4, archived: false }));
});

it('retains and disables an open draft when its collection is archived during background refresh', async () => {
  const cache = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Brief' }));
  fireEvent.change(screen.getByLabelText('Record title'), { target: { value: 'Retain this draft' } });
  api.getRecordCollection.mockResolvedValue({ ...collection, archivedAt: '2026-10-14' });
  await cache.invalidateQueries({ queryKey: ['recordCollection', 'col'] });
  await screen.findByText(/This collection is archived/);
  expect(screen.getByLabelText('Record title')).toHaveValue('Retain this draft');
  expect(screen.getByRole('button', { name: 'Save record' })).toBeDisabled();
});

it('repairs required fields while restoring an archived record in one revision-checked save', async () => {
  api.getCollectionRecords.mockResolvedValue({ items: [{ ...record, values: { approved: false }, archivedAt: '2026-10-14' }], nextCursor: null });
  api.updateCollectionRecord.mockResolvedValue(record);
  mount();
  expect(await screen.findByRole('button', { name: 'Restore Brief', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore and edit Brief' }));
  fireEvent.change(screen.getByLabelText('Hours (required)'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await waitFor(() => expect(api.updateCollectionRecord).toHaveBeenCalledWith('col', 'rec', expect.objectContaining({ revision: 3, definitionRevision: 1, archived: false, values: { hours: 0 } })));
});
