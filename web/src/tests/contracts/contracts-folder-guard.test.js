import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The contracts project runs in Node with isolate: false (vitest.config.js),
// so files here share module state. Mocks, stubbed globals and fake timers
// would leak into the next file: tests that need them belong in src/tests.
const dir = resolve(process.cwd(), 'src/tests/contracts');
const LEAKY = /\bvi\.(mock|doMock|hoisted|stubGlobal|stubEnv|spyOn|useFakeTimers)\(|@testing-library/;

describe('contracts folder', () => {
  it('holds only tests that need no mocks, stubs, fake timers or DOM', () => {
    const offenders = readdirSync(dir)
      .filter((file) => /\.test\.jsx?$/.test(file) && file !== 'contracts-folder-guard.test.js')
      .filter((file) => LEAKY.test(readFileSync(resolve(dir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
