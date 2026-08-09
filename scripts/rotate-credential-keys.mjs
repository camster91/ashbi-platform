import { rawPrisma } from '../src/config/db.js';
import { rotateCredentialKeys } from '../src/services/credential-key-rotation.service.js';

const targetIndex = process.argv.indexOf('--target');
const targetVersion = targetIndex >= 0 ? process.argv[targetIndex + 1] : null;
const apply = process.argv.includes('--apply');

if (!targetVersion) {
  console.error('Usage: npm run rotate:credential-keys -- --target <version> [--apply]');
  process.exitCode = 1;
} else {
  try {
    const result = await rotateCredentialKeys(rawPrisma, targetVersion, { apply });
    console.log(JSON.stringify({ ...result, mode: apply ? 'apply' : 'dry-run' }));
  } catch (error) {
    console.error(`Credential rotation failed: ${error.name}${error.code ? ` (${error.code})` : ''}`);
    process.exitCode = 1;
  } finally {
    await rawPrisma.$disconnect();
  }
}
