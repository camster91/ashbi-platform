import { describe, expect, it } from 'vitest';
import { attachmentKind, MAX_UPLOAD_BYTES, prepareUploadFile, UPLOAD_ACCEPT } from '../lib/upload';

const readBytes = (blob) => new Promise((resolve, reject) => {
  const reader = new globalThis.FileReader();
  reader.onload = () => resolve([...new Uint8Array(reader.result)]);
  reader.onerror = reject;
  reader.readAsArrayBuffer(blob);
});

describe('original file upload preparation', () => {
  it.each([['.HEIC', 'image/heic'], ['.heif', 'image/heif'], ['.psd', 'image/vnd.adobe.photoshop'], ['.json', 'application/json']])('accepts an untyped %s original without changing its name or bytes', async (ext, type) => {
    const original = new File([new Uint8Array([0, 255, 13, 10, 22])], `original.v1.2026${ext}`, { lastModified: 123456 });
    const { file, error } = prepareUploadFile(original);
    expect(error).toBeUndefined();
    expect(file.name).toBe(original.name);
    expect(file.type).toBe(type);
    expect(file.lastModified).toBe(original.lastModified);
    expect(await readBytes(file)).toEqual(await readBytes(original));
    expect(UPLOAD_ACCEPT).toContain(ext.toLowerCase());
  });

  it('uses the 64MiB boundary and permits the actual source MP4 and ZIP sizes', () => {
    expect(MAX_UPLOAD_BYTES).toBe(67108864);
    for (const size of [59509004, 53853540, 67108864]) {
      const file = new File(['x'], 'original.v1.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: size });
      expect(prepareUploadFile(file).error).toBeUndefined();
    }
    const file = new File(['x'], 'over.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 67108865 });
    expect(prepareUploadFile(file).error).toMatch(/64 MiB/);
  });

  it.each(['../file.pdf', 'folder/file.pdf', 'folder\\file.pdf', 'file\u0001.pdf', 'file\u202e.pdf', 'file:stream.pdf', 'file.pdf ', 'file.pdf.', 'file.js.pdf', 'file.php8.pdf', 'file.cgi.pdf'])('rejects unsafe names instead of rewriting %s', (name) => {
    expect(prepareUploadFile(new File(['x'], name, { type: 'application/pdf' })).error).toMatch(/filename/i);
  });

  it('keeps a safe typed original File object and rejects mismatched declared types', () => {
    const file = new File(['x'], 'Café.final.v2.PDF', { type: 'application/pdf' });
    expect(prepareUploadFile(file).file).toBe(file);
    expect(prepareUploadFile(new File(['x'], 'report.pdf', { type: 'text/html' })).error).toMatch(/type/i);
  });

  it('rejects over255 UTF8 byte names and preserves allowed MIME aliases', () => {
    expect(prepareUploadFile(new File(['x'], `${'é'.repeat(126)}.pdf`, {type:'application/pdf'})).error).toMatch(/filename/i);
    expect(prepareUploadFile(new File(['x'], 'layer.v2.psd', {type:'application/x-photoshop'})).file.type).toBe('application/x-photoshop');
    expect(prepareUploadFile(new File(['x'], 'data.v2.json', {type:'text/json'})).file.type).toBe('text/json');
  });

  it('never classifies HEIC/HEIF/PSD as an inline image', () => {
    for (const type of ['image/heic', 'image/heif', 'image/vnd.adobe.photoshop']) expect(attachmentKind(type)).toBe('file');
    expect(attachmentKind('image/png')).toBe('image');
  });
});
