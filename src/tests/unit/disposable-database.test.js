import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';

test('mutating fixtures accept only explicitly named loopback test databases', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.doesNotThrow(() => assertDisposableDatabase({ NODE_ENV: 'test', DATABASE_URL: `postgresql://test:fixture@${host}:5432/testdb` }));
  }
  for (const env of [
    {}, { NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost/testdb' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://db.example.test/testdb' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/ashbihub' },
    { NODE_ENV: 'test', DATABASE_URL: 'not-a-url' },
    { NODE_ENV: 'test', DATABASE_URL: 'https://localhost/testdb' },
  ]) assert.throws(() => assertDisposableDatabase(env), /loopback disposable test database/);
});
