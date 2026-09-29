// Once a confidentiality migration is applied, no image lacking it may serve
// again (Codex P1 on #480: rolling back to an image that does not filter chat
// visibility would expose internal project chat to clients). These tests run
// the rollback-floor functions from scripts/deploy-vps-direct.sh in bash with
// `docker` stubbed by a table of which image carries which migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const script = fs.readFileSync(new URL('../../../scripts/deploy-vps-direct.sh', import.meta.url), 'utf8');
const floorBlock = script.slice(script.indexOf('# --- rollback floor ---'), script.indexOf('# --- end rollback floor ---'));
const CHAT = '20260927030000_chat_message_visibility';

function bash(releaseDir, images, body) {
  const stub = `docker() { [[ $1 == run && $3 == --entrypoint && $4 == test ]] || return 2; grep -qxF "$5 $7" "$IMAGES"; }`;
  const program = `set -euo pipefail\nRELEASE_DIR=${JSON.stringify(releaseDir)}\nIMAGES=${JSON.stringify(images)}\n${stub}\n${floorBlock}\n${body}`;
  return execFileSync('bash', ['-c', program], { encoding: 'utf8' });
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-floor-'));
  const images = path.join(dir, 'images');
  // new:1 carries the chat migration; old:1 predates it.
  fs.writeFileSync(images, `new:1 /app/prisma/migrations/${CHAT}\n`);
  return { dir, images };
}

test('the floor block is present in the release script', () => {
  assert.ok(floorBlock.includes('image_meets_floor') && floorBlock.includes(CHAT));
});

test('before any floor is recorded every image may serve', () => {
  const { dir, images } = fixture();
  assert.equal(bash(dir, images, 'image_meets_floor old:1 && echo ok'), 'ok\n');
});

test('deploying an image that carries the migration raises the floor, which then blocks the older image', () => {
  const { dir, images } = fixture();
  bash(dir, images, 'raise_rollback_floor new:1; raise_rollback_floor new:1');
  assert.equal(fs.readFileSync(path.join(dir, 'rollback-floor'), 'utf8'), `${CHAT}\n`, 'recorded once');
  assert.equal(bash(dir, images, 'image_meets_floor new:1 && echo ok'), 'ok\n');
  assert.equal(bash(dir, images, 'if missing=$(image_meets_floor old:1); then echo allowed; else echo "blocked $missing"; fi'), `blocked ${CHAT}\n`);
});

test('deploying an older image does not raise the floor', () => {
  const { dir, images } = fixture();
  bash(dir, images, 'raise_rollback_floor old:1');
  assert.equal(fs.existsSync(path.join(dir, 'rollback-floor')), false);
});

test('the release refuses the older image before migrating, and automatic rollback fails closed', () => {
  const guardBeforeMigrate = script.indexOf('image_meets_floor "$IMAGE"');
  assert.ok(guardBeforeMigrate > 0 && guardBeforeMigrate < script.indexOf('npx prisma migrate deploy'));
  const restore = script.slice(script.indexOf('restore_previous() {'), script.indexOf('docker rm -f "$CONTAINER"', script.indexOf('restore_previous() {')));
  assert.match(restore, /image_meets_floor "\$PREVIOUS_IMAGE"[\s\S]*return 1/);
  const emergency = script.slice(script.indexOf('emergency_rollback() {'), script.indexOf('start_worker_container() {'));
  assert.match(emergency, /image_meets_floor "\$PREVIOUS_IMAGE"[\s\S]*rollback_floor_blocked[\s\S]*elif/);
});
