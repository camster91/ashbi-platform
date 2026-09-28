// S3 (review of the security batch): route catch blocks must not send a raw
// error.message to clients (5xx bodies, or failures reported inside a 200).
// Server errors go through the sanitised handler or a fixed message. A few
// routes forward messages of their own caller-safe error classes; they are
// listed here with how many such lines they may contain, so a new raw
// `err.message` in a reply fails this test.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const ROUTES = new URL('../../routes/', import.meta.url);
const RAW_MESSAGE = /\b(?:message|detail|error|reason)\s*:\s*(?:err|error|e)\.message(?![.\w])/g;

// file -> [allowed occurrences, why the message is caller-safe]
const ALLOWED = {
  'ai-bridge.routes.js': [9, 'ToolError / AI control errors carry fixed, caller-safe messages'],
  'ai-tool.routes.js': [1, 'only ToolError instances reach the reply (anything else is rethrown)'],
  'ai-connection.routes.js': [1, 'AI connection validation errors with fixed messages (400)'],
  'auth.routes.js': [1, 'AccountWithoutOrganizationError has a fixed message (403)'],
  'review.routes.js': [1, 'ReviewSessionClosedError has a fixed message (409)'],
  'trash.routes.js': [2, 'only the trash service\'s own 4xx messages are forwarded'],
};

test('no route sends a raw error message outside the reviewed allowlist', () => {
  const found = {};
  for (const file of readdirSync(ROUTES).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, ROUTES), 'utf8');
    const count = (source.match(RAW_MESSAGE) || []).length;
    if (count) found[file] = count;
  }
  const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([file, [count]]) => [file, count]));
  assert.deepEqual(found, allowed);
});

test('5xx replies never interpolate an error message', () => {
  for (const file of readdirSync(ROUTES).filter((name) => name.endsWith('.js'))) {
    // ai-bridge's 503 is the AI kill switch, whose message is fixed and caller-safe.
    if (file === 'ai-bridge.routes.js') continue;
    const source = readFileSync(new URL(file, ROUTES), 'utf8');
    for (const match of source.matchAll(/status\(5\d\d\)\.send\(([\s\S]*?)\);/g)) {
      assert.doesNotMatch(match[1], /(?:err|error|e)\.message(?![.\w])/, `${file}: ${match[0].slice(0, 120)}`);
    }
  }
});
