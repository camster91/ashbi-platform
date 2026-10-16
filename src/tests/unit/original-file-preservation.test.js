import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { storeValidatedUpload } from '../../services/chat-attachment.service.js';
import { validateUploadedFile, validateUploadMetadata, MAX_UPLOAD_SIZE } from '../../security/file-upload-policy.js';
import { heicFixture as heic, psdFixture as psd, utf16Fixture as utf16 } from '../fixtures/original-upload-files.js';

const box = (type, body) => { const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4); return Buffer.concat([header, body]); };
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

test('original HEIC/HEIF, PSD and JSON accepted without altering original bytes or digest', () => {
  for (const [name, mime, bytes] of [['photo.original.heic', 'image/heic', heic()], ['photo.original.heif', 'image/heif', heic('mif1')], ['design.v2.final.psd', 'image/vnd.adobe.photoshop', psd()], ['board.export.v1.json', 'application/json', Buffer.from('{"title":"Original","rows":[1,true,null]}')]]) {
    const before = Buffer.from(bytes), digest = hash(bytes);
    assert.equal(validateUploadedFile(name, mime, bytes).valid, true, name); assert.deepEqual(bytes, before); assert.equal(hash(bytes), digest);
  }
  assert.equal(validateUploadedFile('design.psd', 'application/x-photoshop', psd()).valid, true);
  assert.equal(validateUploadedFile('source.json', 'text/json', Buffer.from('\ufeff{"title":"BOM preserved"}')).valid, true);
});
test('strict BOM UTF16 LE/BE CSV preserved while malformed encoding and active spoofing refused', () => {
  for (const be of [false, true]) {
    const bytes = utf16('Name,Description\r\nCafé,"Toronto 😀"\r\n', be), digest = hash(bytes);
    assert.equal(validateUploadedFile('data.export.csv', 'text/csv', bytes).valid, true); assert.equal(hash(bytes), digest);
    for (const bad of [Buffer.concat([bytes, Buffer.from([0])]), utf16('Name\n<script>alert(1)</script>', be), utf16('<html>spoof</html>', be), utf16('x\0y', be)]) assert.equal(validateUploadedFile('bad.csv', 'text/csv', bad).valid, false);
  }
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x00, 0xd8]), Buffer.from([0xfe, 0xff, 0xdc, 0x00]), Buffer.from([0xff, 0xfe, 0x00])]) assert.equal(validateUploadedFile('bad.csv', 'text/csv', bytes).valid, false);
  assert.equal(validateUploadedFile('bad.csv', 'text/csv', Buffer.from('x'.repeat(9000) + '<iframe>spoof</iframe>')).valid, false, 'active markup after the old sample window remains refused');
  assert.equal(validateUploadedFile('bad.txt', 'text/plain', Buffer.from([0xc0, 0xaf])).valid, false, 'plain text must use a valid UTF8 encoding');
});
test('ordinary multi-period basenames remain unchanged; path/control/executable disguises rejected', () => {
  for (const name of ['brief.v1.final.pdf', '2026.10.16.export.json', 'photo.original.heic', 'design.final.v2.psd']) assert.equal(validateUploadMetadata(name, { '.pdf': 'application/pdf', '.json': 'application/json', '.heic': 'image/heic', '.psd': 'image/vnd.adobe.photoshop' }[name.slice(name.lastIndexOf('.'))]).valid, true, name);
  for (const name of ['../file.pdf', 'folder/file.pdf', 'folder\\file.pdf', 'C:photo.heic', 'file\n.pdf', 'evil\u202e.pdf', 'file.exe.pdf', 'file.PS1.PDF', 'file.html.png', 'file.php7.jpg', 'file.js.json', 'file.pdf ', 'file.pdf.', '..', 'x'.repeat(260) + '.pdf']) assert.equal(validateUploadMetadata(name, 'application/pdf').valid, false, name);
});
test('new types reject MIME mismatches, malformed signatures, lengths and active JSON spoofing', () => {
  for (const [name, mime, bytes] of [
    ['x.heic', 'image/heic', Buffer.from('ftypheic')], ['x.heif', 'image/heif', box('ftyp', Buffer.from('avif\0\0\0\0avif'))], ['x.heic', 'image/heic', heic().subarray(0, -1)],
    ['x.psd', 'image/vnd.adobe.photoshop', Buffer.from('8BPS')], ['x.psd', 'image/vnd.adobe.photoshop', psd().subarray(0, 30)],
    ['x.json', 'application/json', Buffer.from('{"truncated":')], ['x.json', 'application/json', Buffer.from('<script/>')], ['x.json', 'application/json', Buffer.from([0xc0, 0xaf])],
    ['x.heic', 'image/png', heic()], ['x.psd', 'application/octet-stream', psd()],
  ]) assert.equal(validateUploadedFile(name, mime, bytes).valid, false, name);
  const header = psd(); header.writeUInt32BE(0, 14); assert.equal(validateUploadedFile('x.psd', 'image/vnd.adobe.photoshop', header).valid, false);
  const badSection = psd(); badSection.writeUInt32BE(0xffffffff, 26); assert.equal(validateUploadedFile('x.psd', 'image/vnd.adobe.photoshop', badSection).valid, false);
  const highBitSignature = psd(); highBitSignature[0] |= 0x80; assert.equal(validateUploadedFile('x.psd', 'image/vnd.adobe.photoshop', highBitSignature).valid, false);
  const oversizedBox = heic(); oversizedBox.writeUInt32BE(0xffffffff); assert.equal(validateUploadedFile('x.heic', 'image/heic', oversizedBox).valid, false);
  assert.equal(validateUploadedFile('x.heic', 'image/heic', Buffer.concat([heic(), ...Array.from({ length: 513 }, () => box('free', Buffer.alloc(0)))])).valid, false);
  for (const value of ['{"description":"<html>source markup</html>"}', '"<script>as data</script>"', 'true', '42', 'null']) assert.equal(validateUploadedFile('source.json', 'application/json', Buffer.from(value)).valid, true);
});
test('canonical64MiB cap covers captured originals and is used by production multipart', () => {
  assert.equal(MAX_UPLOAD_SIZE, 64 * 1024 * 1024);
  for (const size of [1693219, 1199335, 59509004, 53853540, MAX_UPLOAD_SIZE]) {
    const buffer = Buffer.alloc(size); buffer.write('PK\x03\x04', 'binary'); assert.equal(validateUploadedFile('original.archive.zip', 'application/zip', buffer).valid, true, String(size));
  }
  assert.equal(validateUploadedFile('too-big.zip', 'application/zip', Buffer.alloc(MAX_UPLOAD_SIZE + 1)).code, 'TOO_LARGE');
  const index = readFileSync(new URL('../../index.js', import.meta.url), 'utf8'); assert.match(index, /fileSize:\s*MAX_UPLOAD_SIZE/);
});
test('multipart accepts above former50MiB cap and stores exact bytes/name/SHA in a private temporary directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-original-roundtrip-'));
  const app = Fastify();
  try {
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_SIZE } });
    app.post('/upload', async request => {
      const result = await storeValidatedUpload(await request.file(), { uploadDir: root });
      assert.equal(result.error, undefined); return result.stored;
    });
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 1); bytes.write('PK\x03\x04', 'binary');
    const name = 'original.archive.v2.zip', form = new FormData(); form.append('file', new Blob([bytes], { type: 'application/zip' }), name);
    const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
    const response = await app.inject({ method: 'POST', url: '/upload', headers: { 'content-type': encoded.headers.get('content-type') }, payload: Buffer.from(await encoded.arrayBuffer()) });
    assert.equal(response.statusCode, 200, response.body);
    const stored = response.json(); assert.equal(stored.originalName, name); assert.equal(stored.size, bytes.length); assert.equal(stored.checksumSha256, hash(bytes));
    const persisted = await fs.readFile(path.join(root, stored.filename)); assert.deepEqual(persisted, bytes); assert.equal(hash(persisted), hash(bytes));
  } finally { await app.close(); assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); }
});
