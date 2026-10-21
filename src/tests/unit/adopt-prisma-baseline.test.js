import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  BASELINE,
  SHADOW_ENV,
  adoptBaseline,
  checkConfiguration,
  stageBaselineMigrations,
} from '../../../scripts/adopt-prisma-baseline.mjs';
import { committedMigrations, migrationRecordFailures } from '../../../scripts/assert-baseline-adoption.mjs';

const validEnv = {
  DATABASE_URL: 'postgresql://ci:pw@db.internal:5432/ashbi',
  ALLOW_BASELINE_ADOPTION: BASELINE,
  [SHADOW_ENV]: 'postgresql://ci:pw@db.internal:5432/ashbi_baseline_shadow',
};

const silent = { log() {}, error() {} };

// Fake dependencies: records every Prisma invocation and returns scripted
// exit codes keyed by the Prisma subcommand.
function harness({ env = validEnv, target = { hasMigrationsTable: false, relationCount: 79, serverIdentity: 'start/16384/target' },
  shadow = { hasMigrationsTable: false, relationCount: 0, serverIdentity: 'start/16385/shadow' }, codes = {} } = {}) {
  const calls = [];
  const inspected = [];
  let cleaned = 0;
  const run = () => adoptBaseline({
    env,
    log: silent,
    inspect: async (url) => {
      inspected.push(url);
      return url === env.DATABASE_URL ? target : shadow;
    },
    stage: () => ({ configPath: '/stage/prisma.config.mjs', migrationsPath: '/stage/migrations', cleanup: () => { cleaned += 1; } }),
    prisma: (args) => {
      calls.push(args);
      const key = args[1] === 'diff' ? (args.includes('--from-migrations') ? 'baselineDiff' : 'finalDiff') : args[1];
      return codes[key] ?? 0;
    },
  });
  return { run, calls, inspected, cleaned: () => cleaned };
}

const writesMetadata = (calls) => calls.some((args) => ['resolve', 'deploy'].includes(args[1]));

describe('baseline adoption configuration', () => {
  it('requires DATABASE_URL', () => {
    assert.match(checkConfiguration({ ...validEnv, DATABASE_URL: '' }).message, /DATABASE_URL is required/);
  });

  it('refuses without the exact confirmation', () => {
    for (const value of [undefined, '', 'yes', '20260808120000_fail_closed_tenancy']) {
      const result = checkConfiguration({ ...validEnv, ALLOW_BASELINE_ADOPTION: value });
      assert.equal(result.code, 1);
      assert.match(result.message, /ALLOW_BASELINE_ADOPTION=20260808040000_baseline/);
    }
  });

  it('requires a separate shadow database', () => {
    assert.match(checkConfiguration({ ...validEnv, [SHADOW_ENV]: '' }).message, new RegExp(SHADOW_ENV));
    for (const same of [
      validEnv.DATABASE_URL,
      'postgresql://other:pw@DB.internal/ashbi?schema=public',
      'postgres://ci:pw@db.internal:5432/ashbi',
    ]) {
      assert.match(checkConfiguration({ ...validEnv, [SHADOW_ENV]: same }).message, /different database/);
    }
    assert.match(checkConfiguration({ ...validEnv, [SHADOW_ENV]: 'not a url' }).message, /postgresql:\/\/ URLs/);
  });

  it('accepts a complete configuration', () => {
    assert.equal(checkConfiguration(validEnv), null);
  });
});

describe('baseline adoption decisions', () => {
  it('refuses on missing confirmation before touching any database', async () => {
    const h = harness({ env: { ...validEnv, ALLOW_BASELINE_ADOPTION: undefined } });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.inspected, []);
    assert.deepEqual(h.calls, []);
  });

  it('refuses a database that already has migration history', async () => {
    const h = harness({ target: { hasMigrationsTable: true, relationCount: 80 } });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.calls, []);
  });

  it('refuses an empty database (fresh databases use migrate deploy)', async () => {
    const h = harness({ target: { hasMigrationsTable: false, relationCount: 0 } });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.calls, []);
  });

  it('refuses a shadow database that is not empty, because Prisma resets it', async () => {
    for (const shadow of [{ hasMigrationsTable: false, relationCount: 3, serverIdentity: 's/2' }, { hasMigrationsTable: true, relationCount: 1, serverIdentity: 's/2' }]) {
      const h = harness({ shadow });
      assert.equal(await h.run(), 1);
      assert.deepEqual(h.calls, []);
    }
  });

  it('refuses on drift from the baseline schema and writes no migration metadata', async () => {
    const h = harness({ codes: { baselineDiff: 2 } });
    assert.equal(await h.run(), 2);
    assert.equal(h.calls.length, 1);
    assert.equal(writesMetadata(h.calls), false);
    assert.equal(h.cleaned(), 1);
  });

  it('refuses when the baseline comparison itself errors', async () => {
    const h = harness({ codes: { baselineDiff: 1 } });
    assert.equal(await h.run(), 1);
    assert.equal(writesMetadata(h.calls), false);
    assert.equal(h.cleaned(), 1);
  });

  it('compares against the staged baseline-only migrations, then marks only the baseline applied', async () => {
    const h = harness();
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.calls, [
      ['migrate', 'diff', '--config', '/stage/prisma.config.mjs', '--exit-code', '--from-migrations', '/stage/migrations', '--to-config-datasource'],
      ['migrate', 'resolve', '--applied', BASELINE],
      ['migrate', 'deploy'],
      ['migrate', 'diff', '--exit-code', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma'],
    ]);
    const resolves = h.calls.filter((args) => args[1] === 'resolve');
    assert.equal(resolves.length, 1);
    assert.ok(!resolves[0].includes('--rolled-back'));
    assert.equal(h.cleaned(), 1);
  });

  it('stops when recording the baseline fails', async () => {
    const h = harness({ codes: { resolve: 1 } });
    assert.equal(await h.run(), 1);
    assert.ok(!h.calls.some((args) => args[1] === 'deploy'));
  });

  it('fails when migrate deploy fails and skips the final comparison', async () => {
    const h = harness({ codes: { deploy: 1 } });
    assert.equal(await h.run(), 1);
    assert.equal(h.calls.at(-1)[1], 'deploy');
  });

  it('fails when the migrated database drifts from schema.prisma', async () => {
    const h = harness({ codes: { finalDiff: 2 } });
    assert.equal(await h.run(), 2);
  });
});

describe('baseline staging', () => {
  const dirs = [];
  afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

  it('stages exactly the committed baseline migration with no credentials on disk', () => {
    const staged = stageBaselineMigrations();
    dirs.push(path.dirname(staged.configPath));
    assert.ok(staged.configPath.startsWith(os.tmpdir()));
    assert.deepEqual(fs.readdirSync(staged.migrationsPath).sort(), [BASELINE, 'migration_lock.toml']);
    assert.deepEqual(
      fs.readFileSync(path.join(staged.migrationsPath, BASELINE, 'migration.sql')),
      fs.readFileSync(path.resolve('prisma', 'migrations', BASELINE, 'migration.sql')),
    );
    assert.match(fs.readFileSync(path.join(staged.migrationsPath, 'migration_lock.toml'), 'utf8'), /provider = "postgresql"/);
    const config = fs.readFileSync(staged.configPath, 'utf8');
    assert.match(config, /url: process\.env\.DATABASE_URL/);
    assert.match(config, new RegExp(`shadowDatabaseUrl: process\\.env\\.${SHADOW_ENV}`));
    assert.doesNotMatch(config, /postgres(ql)?:\/\//);
    staged.cleanup();
    assert.equal(fs.existsSync(path.dirname(staged.configPath)), false);
  });

  it('fails closed when the baseline migration is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-no-baseline-'));
    dirs.push(root);
    assert.throws(() => stageBaselineMigrations(root), /Baseline migration not found/);
  });
});

describe('baseline adoption rehearsal assertion', () => {
  const expected = [BASELINE, '20260808120000_fail_closed_tenancy', '20260809023000_revenue_flow_integrity'];
  const row = (migration_name, applied_steps_count = 1, extra = {}) => ({
    migration_name, applied_steps_count, finished: true, rolled_back: false, ...extra,
  });
  const adopted = () => [row(BASELINE, 0), row(expected[1]), row(expected[2])];

  it('accepts a baseline recorded without execution and every later migration deployed', () => {
    assert.deepEqual(migrationRecordFailures(expected, adopted()), []);
  });

  it('lists every committed migration directory', () => {
    const names = committedMigrations();
    assert.equal(names[0], BASELINE);
    assert.ok(names.includes('20260808120000_fail_closed_tenancy'));
    assert.ok(names.every((name) => /^\d{14}_/.test(name)));
  });

  for (const [label, rows, pattern] of [
    ['a missing migration', adopted().slice(0, 2), /revenue_flow_integrity is not recorded/],
    ['an executed baseline', [row(BASELINE, 1), row(expected[1]), row(expected[2])], /was executed instead of recorded/],
    ['a later migration only marked applied', [row(BASELINE, 0), row(expected[1], 0), row(expected[2])], /recorded without being executed/],
    ['an unfinished migration', [...adopted().slice(0, 2), row(expected[2], 1, { finished: false })], /did not finish/],
    ['a rolled-back migration', [...adopted().slice(0, 2), row(expected[2], 1, { rolled_back: true })], /rolled back/],
    ['an unknown migration', [...adopted(), row('20990101000000_unknown')], /recorded but not committed/],
    ['a duplicate record', [...adopted(), row(expected[2])], /more than once/],
  ]) {
    it(`fails on ${label}`, () => {
      assert.ok(migrationRecordFailures(expected, rows).some((failure) => pattern.test(failure)));
    });
  }
});

describe('baseline adoption shadow identity', () => {
  it('refuses when the shadow URL reaches the same database through another host alias', async () => {
    const same = 'start/16384/testdb';
    const h = harness({
      env: { ...validEnv, DATABASE_URL: 'postgresql://u:p@localhost:5432/testdb', BASELINE_SHADOW_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/testdb' },
      target: { hasMigrationsTable: false, relationCount: 79, serverIdentity: same },
      shadow: { hasMigrationsTable: false, relationCount: 0, serverIdentity: same },
    });
    assert.equal(await h.run(), 1);
    assert.equal(h.calls.length, 0);
  });

  it('refuses when either database identity cannot be read', async () => {
    for (const [target, shadow] of [
      [{ hasMigrationsTable: false, relationCount: 79, serverIdentity: null }, undefined],
      [undefined, { hasMigrationsTable: false, relationCount: 0, serverIdentity: null }],
    ]) {
      const h = harness({ ...(target && { target }), ...(shadow && { shadow }) });
      assert.equal(await h.run(), 1);
      assert.equal(h.calls.length, 0);
    }
  });
});
