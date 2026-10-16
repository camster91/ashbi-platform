import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { uploadFileWithProgress } from '../lib/upload';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'original' }) })); });
afterEach(() => { vi.unstubAllGlobals(); });

it('prepares the original and sends entity fields before file for the non-progress upload caller', async () => {
  await api.uploadAttachment(new File(['original'], 'design.final.v2.psd'), 'PROJECT', 'project-one');
  const form = fetch.mock.calls[0][1].body;
  expect([...form.keys()]).toEqual(['entityType', 'entityId', 'file']);
  expect(form.get('entityType')).toBe('PROJECT');
  expect(form.get('entityId')).toBe('project-one');
  expect(form.get('file').name).toBe('design.final.v2.psd');
  expect(form.get('file').type).toBe('image/vnd.adobe.photoshop');
  expect(form.get('file').size).toBe(8);
});

it('refuses unsafe original names before creating an upload request', async () => {
  await expect(api.uploadAttachment(new File(['x'], '../file.pdf', { type: 'application/pdf' }), 'PROJECT', 'p1')).rejects.toThrow(/filename/i);
  expect(fetch).not.toHaveBeenCalled();
});

it('progress upload prepares an untyped JSON original before XHR and preserves field order', async () => {
  let form;
  vi.stubGlobal('XMLHttpRequest', class {
    upload = {};
    open() {}
    send(body) { form = body; this.status = 201; this.responseText = '{}'; this.onload(); }
  });
  await uploadFileWithProgress('/api/attachments', new File(['{}'], 'data.original.v2.json'), { fields: { entityType: 'PROJECT', entityId: 'p1' } });
  expect([...form.keys()]).toEqual(['entityType', 'entityId', 'file']);
  expect(form.get('file').name).toBe('data.original.v2.json');
  expect(form.get('file').type).toBe('application/json');
});

it('progress upload refuses invalid names before opening XHR', async () => {
  const xhr = vi.fn();vi.stubGlobal('XMLHttpRequest', xhr);
  await expect(uploadFileWithProgress('/api/attachments', new File(['x'], 'bad.js.pdf', {type:'application/pdf'}))).rejects.toThrow(/filename/i);
  expect(xhr).not.toHaveBeenCalled();
});
