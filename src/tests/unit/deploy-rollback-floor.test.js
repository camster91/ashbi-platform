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

const script = fs.readFileSync(new URL('../../../scripts/deploy-vps-direct.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
// Use the native Git-for-Windows runtime, not the WindowsApps WSL launcher.
const bashBinary = process.env.BASH_TEST_EXECUTABLE || (process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe') : 'bash');
const bashPath = value => process.platform === 'win32' ? value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : value;
const shellQuote = value => `'${bashPath(value).replaceAll("'", "'\\''")}'`;
const floorBlock = script.slice(script.indexOf('# --- rollback floor ---'), script.indexOf('# --- end rollback floor ---'));
const CHAT = '20260927030000_chat_message_visibility';
const OAUTH = '20261016060000_mcp_action_binding';
const INGEST = '20261016120000_gmail_ingest_identity';
const PULL = '20261016130000_openseo_saved_report_pull';

function bash(releaseDir, images, body) {
  // An image named broken:* makes the probe itself fail (docker exits 125).
  const stub = `docker() { [[ $1 == run && $3 == --entrypoint && $4 == test ]] || return 2; [[ $5 == broken:* ]] && return 125; grep -qxF "$5 $7" "$IMAGES"; }`;
  const program = `set -euo pipefail\nRELEASE_DIR=${shellQuote(releaseDir)}\nIMAGES=${shellQuote(images)}\n${stub}\n${floorBlock}\n${body}`;
  return execFileSync(bashBinary, ['-c', program], { encoding: 'utf8' });
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
  const restore = script.slice(script.indexOf('restore_previous() {'), script.indexOf('docker rename "$ROLLBACK_CONTAINER"', script.indexOf('restore_previous() {')));
  assert.match(restore, /image_meets_floor "\$PREVIOUS_IMAGE"[\s\S]*return 1/);
  const emergency = script.slice(script.indexOf('emergency_rollback() {'), script.indexOf('start_worker_container() {'));
  assert.match(emergency, /image_meets_floor "\$PREVIOUS_IMAGE"[\s\S]*rollback_floor_blocked[\s\S]*elif/);
});

test('a live image below the floor stops as soon as the migration is applied', () => {
  const afterMigrate = script.slice(script.indexOf('npx prisma migrate deploy'), script.indexOf('npx prisma migrate status'));
  assert.match(afterMigrate, /raise_rollback_floor "\$IMAGE"[\s\S]*LIVE_IMAGE=\$\(container_image "\$CONTAINER"\)[\s\S]*\$LIVE_IMAGE == unknown \]\] \|\| ! image_meets_floor "\$LIVE_IMAGE"[\s\S]*stop_below_floor "\$CONTAINER" 30 && stop_below_floor "\$WORKER_CONTAINER" 120 \|\| \{[\s\S]*die /);
});

test('a refused rollback also removes the rejected candidate', () => {
  const restore = script.slice(script.indexOf('restore_previous() {'), script.indexOf('return 1', script.indexOf('restore_previous() {')));
  assert.match(restore, /docker rm -f "\$CONTAINER"[\s\S]*docker rm -f "\$WORKER_CONTAINER"[\s\S]*rollback_floor_blocked/);
  const emergency = script.slice(script.indexOf('emergency_rollback() {'), script.indexOf('elif', script.indexOf('emergency_rollback() {')));
  assert.match(emergency, /docker rm -f "\$CONTAINER"[\s\S]*docker rm -f "\$WORKER_CONTAINER"[\s\S]*rollback_floor_blocked/);
});

function stopProbe(dockerBody) {
  const program = `set -euo pipefail\nRELEASE_DIR=/nonexistent\n${dockerBody}\n${floorBlock}\nif stop_below_floor api 30; then echo stopped; else echo still-running; fi\ncat "$LOG"`;
  return execFileSync(bashBinary, ['-c', program], { encoding: 'utf8', env: { ...process.env, LOG: bashPath(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-')), 'log')) } });
}

test('stop_below_floor force-removes a container whose stop did not take, and fails if it still runs', () => {
  // docker stop "fails" and the container keeps running until rm -f.
  const stubborn = `: > "$LOG"; RUNNING=true
docker() { echo "$1" >> "$LOG"; case $1 in stop) return 1 ;; rm) RUNNING=false ;; inspect) echo "$RUNNING" ;; esac; }`;
  const out = stopProbe(stubborn);
  assert.match(out, /^stopped\n/);
  assert.match(out, /stop\ninspect\nrm\ninspect/);
  // Neither stop nor rm takes effect: the caller must abort the release.
  const unkillable = `: > "$LOG"
docker() { echo "$1" >> "$LOG"; case $1 in stop|rm) return 1 ;; inspect) echo true ;; esac; }`;
  assert.match(stopProbe(unkillable), /^still-running\n/);
});

test('stop_below_floor fails closed when the container state cannot be read', () => {
  // Daemon unavailable: stop, rm and inspect all fail with a non-"No such" error.
  const daemonDown = `: > "$LOG"
docker() { echo "$1" >> "$LOG"; echo "Cannot connect to the Docker daemon" >&2; return 1; }`;
  assert.match(stopProbe(daemonDown), /^still-running\n/);
  // A confirmed missing container counts as stopped.
  const gone = `: > "$LOG"
docker() { echo "$1" >> "$LOG"; case $1 in inspect) echo "Error: No such object: api" >&2; return 1 ;; *) return 1 ;; esac; }`;
  assert.match(stopProbe(gone), /^stopped\n/);
  const goneDocker29 = gone.replace('Error: No such object:', 'error: no such object:');
  assert.match(stopProbe(goneDocker29), /^stopped\n/);
  // A normal stop that takes: no force-remove needed.
  const clean = `: > "$LOG"
docker() { echo "$1" >> "$LOG"; case $1 in inspect) echo false ;; esac; }`;
  const out = stopProbe(clean);
  assert.match(out, /^stopped\n/);
  assert.doesNotMatch(out, /\nrm\n/);
});

test('a probe that cannot run fails closed: the floor is still raised and the image is refused', () => {
  const { dir, images } = fixture();
  bash(dir, images, 'raise_rollback_floor broken:1');
  assert.equal(fs.readFileSync(path.join(dir, 'rollback-floor'), 'utf8'), `${CHAT}\n${OAUTH}\n20261016090000_workspace_account_manager_pilot\n${INGEST}\n${PULL}\n`, 'recorded despite the failed probe');
  assert.equal(bash(dir, images, 'if missing=$(image_meets_floor broken:1); then echo allowed; else echo "blocked $missing"; fi'), `blocked ${CHAT}\n`);
  assert.equal(bash(dir, images, 'image_has_migration broken:1 x && echo 0 || echo $?'), '2\n');
});

test('container_image distinguishes a missing container from an unreadable one', () => {
  const run = (dockerBody) => execFileSync(bashBinary, ['-c', `set -euo pipefail\nRELEASE_DIR=/nonexistent\n${dockerBody}\n${floorBlock}\nprintf '[%s]' "$(container_image api)"`], { encoding: 'utf8' });
  assert.equal(run('docker() { echo "ashbi:old"; }'), '[ashbi:old]');
  assert.equal(run('docker() { echo "Error: No such object: api" >&2; return 1; }'), '[]');
  assert.equal(run('docker() { echo "error: no such object: api" >&2; return 1; }'), '[]');
  assert.equal(run('docker() { echo "Error response from daemon: No such container: api" >&2; return 1; }'), '[]');
  assert.equal(run('docker() { echo "Cannot connect to the Docker daemon" >&2; return 1; }'), '[unknown]');
});


test('OAuth-bound receipt migration raises the confidentiality floor and excludes pre-binding rollback images', () => {
  const { dir, images } = fixture();
  fs.appendFileSync(images, `oauth:1 /app/prisma/migrations/${CHAT}\noauth:1 /app/prisma/migrations/${OAUTH}\n`);
  bash(dir, images, 'raise_rollback_floor oauth:1');
  assert.equal(fs.readFileSync(path.join(dir, 'rollback-floor'), 'utf8'), `${CHAT}\n${OAUTH}\n`);
  assert.equal(bash(dir, images, 'if missing=$(image_meets_floor new:1); then echo allowed; else echo "blocked $missing"; fi'), `blocked ${OAUTH}\n`);
  assert.equal(bash(dir, images, 'image_meets_floor oauth:1 && echo safe'), 'safe\n');
});

test('pilot confidentiality floor blocks otherwise chat-compatible older image', () => {
  const { dir, images } = fixture();const pilot = '20261016090000_workspace_account_manager_pilot';
  fs.appendFileSync(images, `pilot:1 /app/prisma/migrations/${CHAT}\npilot:1 /app/prisma/migrations/${pilot}\n`);
  bash(dir, images, 'raise_rollback_floor pilot:1');
  assert.equal(bash(dir, images, 'if missing=$(image_meets_floor new:1); then echo allowed; else echo "blocked $missing"; fi'), `blocked ${pilot}\n`);
  assert.equal(bash(dir, images, 'image_meets_floor pilot:1 && echo ok'), 'ok\n');
});


test('combined rollback floor requires chat, OAuth binding, private pilot Gmail receipt and saved-report provenance migrations in every serving image', () => {
  const { dir, images } = fixture();
  const all = [CHAT, OAUTH, '20261016090000_workspace_account_manager_pilot', INGEST, PULL];
  fs.appendFileSync(images, all.map(name => `complete:1 /app/prisma/migrations/${name}\n`).join(''));
  for (let index = 0; index < all.length; index++) {
    fs.appendFileSync(images, all.filter(name => name !== all[index]).map(name => `missing:${index} /app/prisma/migrations/${name}\n`).join(''));
  }
  bash(dir, images, 'raise_rollback_floor complete:1');
  assert.equal(fs.readFileSync(path.join(dir, 'rollback-floor'), 'utf8'), all.join('\n') + '\n');
  assert.equal(bash(dir, images, 'image_meets_floor complete:1 && echo safe'), 'safe\n');
  for (let index = 0; index < all.length; index++) {
    assert.equal(bash(dir, images, `if missing=$(image_meets_floor missing:${index}); then echo allowed; else echo "blocked $missing"; fi`), `blocked ${all[index]}\n`);
  }
});
