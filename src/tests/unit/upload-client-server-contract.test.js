import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE, validateUploadMetadata } from '../../security/file-upload-policy.js';
import { MAX_UPLOAD_BYTES, prepareUploadFile, UPLOAD_TYPES } from '../../../web/src/lib/upload.js';

test('staff and portal file preparation agrees with the server policy for original names and MIME', () => {
  assert.equal(MAX_UPLOAD_BYTES, MAX_UPLOAD_SIZE);
  assert.deepEqual(Object.keys(UPLOAD_TYPES).sort(), [...ALLOWED_UPLOAD_EXTENSIONS].sort());
  for (const [ext, type] of Object.entries(UPLOAD_TYPES)) {
    const name = `original.v2.final${ext}`;
    for (const declaredType of ['', type]) {
      const prepared = prepareUploadFile(new File(['original bytes'], name, { type: declaredType }));
      assert.equal(prepared.error, undefined, name);
      assert.equal(prepared.file.name, name);
      assert.equal(validateUploadMetadata(prepared.file.name, prepared.file.type).valid, true, name);
    }
  }
  for (const [name, type] of [['original.v1.psd', 'application/x-photoshop'], ['original.v1.json', 'text/json'], ['original.v1.csv', 'text/plain'], ['original.v1.zip', 'application/x-zip-compressed']]) {
    const prepared = prepareUploadFile(new File(['original bytes'], name, { type }));
    assert.equal(prepared.error, undefined, name);
    assert.equal(validateUploadMetadata(prepared.file.name, prepared.file.type).valid, true, name);
  }
});

test('unsafe original names cannot be rewritten into an accepted upload by the UI', () => {
  for (const name of ['../brief.pdf', 'folder\\brief.pdf', 'x.cgi.pdf', 'x.js.pdf', 'x.svg.pdf', 'x\u202e.pdf', 'brief.pdf ', 'brief.pdf.', 'brief\u0000.pdf']) {
    assert.equal(validateUploadMetadata(name, 'application/pdf').valid, false, name);
    const prepared = prepareUploadFile(new File(['original bytes'], name, { type: 'application/pdf' }));
    assert(prepared.error, name);
    assert.equal(prepared.file, undefined, name);
  }
});
