// Header-safe download names and byte ranges (#417 security review).
import assert from 'node:assert/strict';
import test from 'node:test';
import { contentDisposition, parseByteRange } from '../../utils/send-file.js';

test('download names are always valid header values', () => {
  const cases = {
    '日本.png': `inline; filename="__.png"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.png`,
    'brief\u2014v2.pdf': `inline; filename="brief_v2.pdf"; filename*=UTF-8''brief%E2%80%94v2.pdf`,
    'Café menu.pdf': `inline; filename="Cafe menu.pdf"; filename*=UTF-8''Caf%C3%A9%20menu.pdf`,
    'a"b\\c\r\nd.png': `inline; filename="a_b_c__d.png"; filename*=UTF-8''a%22b%5Cc%0D%0Ad.png`,
    "it's (1)*.png": `inline; filename="it's (1)*.png"; filename*=UTF-8''it%27s%20%281%29%2A.png`,
    '../../etc/passwd': `inline; filename="passwd"; filename*=UTF-8''passwd`,
    '': `inline; filename="download"; filename*=UTF-8''download`,
  };
  for (const [name, expected] of Object.entries(cases)) {
    const value = contentDisposition('inline', name);
    assert.equal(value, expected, name);
    assert.match(value, /^[\x20-\x7e]+$/, `${name} produced a non-ASCII header`);
  }
});

test('byte ranges: satisfiable, ignored or refused', () => {
  assert.equal(parseByteRange(undefined, 10), null);
  assert.equal(parseByteRange('bytes=0-1,3-4', 10), null);
  assert.deepEqual(parseByteRange('bytes=0-0', 10), { start: 0, end: 0 });
  assert.deepEqual(parseByteRange('bytes=4-', 10), { start: 4, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-40', 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange('bytes=8-100', 10), { start: 8, end: 9 });
  for (const bad of ['bytes=10-', 'bytes=3-2', 'bytes=-0', 'bytes=-', 'bytes=a-b', 'pages=1-2', 'bytes=1-2 ']) {
    assert.deepEqual(parseByteRange(bad, 10), bad === 'bytes=1-2 ' ? { start: 1, end: 2 } : { unsatisfiable: true }, bad);
  }
  assert.deepEqual(parseByteRange('bytes=0-1', 0), { unsatisfiable: true });
});
