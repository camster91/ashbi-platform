import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

function command(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    // Classify diagnostics into fixed messages; never forward raw remote text.
    let diagnostic = '';
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8192); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 900000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Backup transport failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error('Production backup gate failed');
        error.safeReason = /Permission denied/.test(diagnostic) ? 'SSH authentication rejected'
          : /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(diagnostic) ? 'SSH host identity rejected'
            : /invalid format|error in libcrypto/.test(diagnostic) ? 'Stored SSH key format rejected'
              : /Connection timed out|Connection refused|No route to host/.test(diagnostic) ? 'SSH connection unavailable'
                : `${file === 'scp' ? 'Encrypted backup transfer' : 'Remote backup verification'} failed`;
        reject(error);
      }
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function validateBackupProof(proof, sha, nonce, now = Date.now()) {
  const age = now - Date.parse(proof?.completedAt);
  if (proof?.status !== 'ok' || proof.releaseSha !== sha || proof.nonce !== nonce
    || proof.manifestVerified !== true || proof.databaseCatalogVerified !== true
    || !/^\/opt\/ashbi-platform\/backups\/encrypted\/ashbi-full-\d{8}_\d{6}-[a-z0-9]{7}\.tar\.age$/.test(proof.archive || '')
    || !/^[a-f0-9]{64}$/.test(proof.sha256 || '') || !Number.isSafeInteger(proof.bytes) || proof.bytes <= 0
    || !Number.isFinite(age) || age < -60000 || age > 300000) {
    throw new Error('Production backup proof is missing, stale or mismatched');
  }
}

export async function productionBackup(env) {
  if (!env.VPS_SSH_KEY || !env.ASHBI_VPS_KNOWN_HOSTS || !env.RUNNER_TEMP) {
    const error = new Error('Missing verified backup SSH configuration');
    error.safeReason = 'Required backup SSH configuration missing';
    throw error;
  }
  const sha = env.RELEASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Backup requires a full release SHA');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-backup-ssh-'));
  const nonce = randomBytes(16).toString('hex');
  const key = path.join(temporary, 'key');
  const hosts = path.join(temporary, 'known_hosts');
  try {
    await fs.writeFile(key, env.VPS_SSH_KEY + '\n', { mode: 0o600 });
    await fs.writeFile(hosts, env.ASHBI_VPS_KNOWN_HOSTS + '\n', { mode: 0o600 });
    const options = ['-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${hosts}`, '-o', 'ConnectTimeout=15'];
    const script = await fs.readFile(new URL('./verify-production-backup.py', import.meta.url), 'utf8');
    const proof = JSON.parse(await command('ssh', [...options, 'root@187.77.26.99', `python3 - ${sha} ${nonce}`], script));
    validateBackupProof(proof, sha, nonce);
    const destination = path.join(env.RUNNER_TEMP, 'ashbi-release-backup');
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    const copy = path.join(destination, path.basename(proof.archive));
    await command('scp', ['-O', ...options, `root@187.77.26.99:${proof.archive}`, copy]);
    const bytes = await fs.readFile(copy);
    if (bytes.length !== proof.bytes || createHash('sha256').update(bytes).digest('hex') !== proof.sha256) throw new Error('Off-server backup copy verification failed');
    await fs.writeFile(path.join(destination, 'proof.json'), JSON.stringify({ ...proof, offServerCopyVerified: true, workflowRunId: env.GITHUB_RUN_ID }), { mode: 0o600 });
    return { ...proof, offServerCopyVerified: true };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function verifiedProductionBackup(env) {
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID) throw new Error('Missing backup workflow identity');
  const directory = path.join(env.RUNNER_TEMP, 'ashbi-release-backup');
  const proof = JSON.parse(await fs.readFile(path.join(directory, 'proof.json'), 'utf8'));
  validateBackupProof(proof, env.RELEASE_SHA, proof.nonce);
  if (!/^[a-f0-9]{32}$/.test(proof.nonce || '') || proof.workflowRunId !== env.GITHUB_RUN_ID || proof.offServerCopyVerified !== true) throw new Error('Backup is not from this release workflow');
  const bytes = await fs.readFile(path.join(directory, path.basename(proof.archive)));
  if (bytes.length !== proof.bytes || createHash('sha256').update(bytes).digest('hex') !== proof.sha256) throw new Error('Verified backup copy changed');
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  productionBackup(process.env).then(() => console.log('Encrypted production backup and off-server copy verified')).catch(error => {
    console.error(`Production backup gate failed: ${error.safeReason || 'proof or copy verification failed'}`); process.exitCode = 1;
  });
}
