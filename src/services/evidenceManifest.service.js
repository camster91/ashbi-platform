import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isContainedOrEqual(root, target) {
  return root === target || isContained(root, target);
}

function identity(filePath) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

export function resolveEvidenceDirectory(evidenceDirectory) {
  if (!evidenceDirectory) throw new Error('Evidence directory is required');
  const root = fs.realpathSync(path.resolve(String(evidenceDirectory ?? '')));
  if (!fs.statSync(root).isDirectory()) throw new Error('Evidence directory must be a directory');
  return root;
}

export function resolveContainedEvidenceFile(evidenceDirectory, relativePath, artifactId = 'evidence') {
  const root = resolveEvidenceDirectory(evidenceDirectory);
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Artifact ${artifactId} must use a relative path`);
  const resolved = fs.realpathSync(path.resolve(root, relativePath));
  if (!isContained(root, resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Artifact ${artifactId} must be a file inside the evidence directory`);
  }
  return resolved;
}

export function checksumContainedArtifacts({ evidenceDirectory, requiredIds, artifactPaths } = {}) {
  const root = resolveEvidenceDirectory(evidenceDirectory);
  const seen = new Set();
  return requiredIds.map((id) => {
    const resolved = resolveContainedEvidenceFile(root, artifactPaths?.[id], id);
    const fileIdentity = identity(resolved);
    if (seen.has(fileIdentity)) throw new Error(`Artifact ${id} duplicates another evidence file`);
    seen.add(fileIdentity);
    const content = fs.readFileSync(resolved);
    return {
      id,
      path: path.relative(root, resolved).split(path.sep).join('/'),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
}

export function resolveNewEvidenceOutput(evidenceDirectory, outputPath) {
  const root = resolveEvidenceDirectory(evidenceDirectory);
  if (!outputPath) throw new Error('Manifest output is required');
  const output = path.resolve(String(outputPath ?? ''));
  const parent = fs.realpathSync(path.dirname(output));
  if (!isContained(root, output) || !isContainedOrEqual(root, parent)) {
    throw new Error('Manifest output must be inside the evidence directory');
  }
  return output;
}
