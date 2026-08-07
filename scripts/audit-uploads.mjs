import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../src/config/db.js';
import { validateUploadedFile } from '../src/security/file-upload-policy.js';

const applyQuarantine = process.argv.includes('--quarantine');
const uploadRoot = path.resolve(process.cwd(), 'uploads');
const quarantineRoot = path.join(uploadRoot, 'quarantine');
const attachments = await prisma.attachment.findMany({ orderBy: { createdAt: 'asc' } });
const findings = [];

for (const attachment of attachments) {
  const absolutePath = path.resolve(process.cwd(), attachment.path.replace(/^[/\\]+/, ''));
  if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    findings.push({ id: attachment.id, name: attachment.originalName, reason: 'path escapes upload root' });
    continue;
  }
  try {
    const buffer = await fs.readFile(absolutePath);
    const validation = validateUploadedFile(attachment.originalName, attachment.mimeType, buffer);
    if (validation.valid) continue;
    findings.push({ id: attachment.id, name: attachment.originalName, reason: validation.error });
    if (applyQuarantine) {
      await fs.mkdir(quarantineRoot, { recursive: true });
      const destination = path.join(quarantineRoot, path.basename(attachment.filename));
      await fs.rename(absolutePath, destination);
      await prisma.attachment.update({
        where: { id: attachment.id },
        data: { path: `/uploads/quarantine/${path.basename(attachment.filename)}` }
      });
    }
  } catch (error) {
    findings.push({ id: attachment.id, name: attachment.originalName, reason: error.code === 'ENOENT' ? 'file missing' : error.message });
  }
}

console.log(JSON.stringify({ mode: applyQuarantine ? 'quarantine' : 'dry-run', scanned: attachments.length, findings }, null, 2));
await prisma.$disconnect();
if (findings.length > 0 && !applyQuarantine) process.exitCode = 2;
