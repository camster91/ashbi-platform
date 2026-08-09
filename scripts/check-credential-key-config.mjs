const failProduction = process.argv.includes('--production');
let keyring = {};
try {
  keyring = process.env.CREDENTIALS_KEYRING ? JSON.parse(process.env.CREDENTIALS_KEYRING) : {};
  if (!keyring || Array.isArray(keyring) || typeof keyring !== 'object') throw new Error('invalid keyring');
} catch {
  console.error('CREDENTIALS_KEYRING is not valid JSON');
  process.exitCode = 1;
}
if (process.env.CREDENTIALS_KEY) keyring.legacy ??= process.env.CREDENTIALS_KEY;
const activeVersion = process.env.CREDENTIALS_ACTIVE_KEY_VERSION || 'legacy';
const versions = Object.keys(keyring).sort();
const result = {
  activeVersion,
  configuredVersions: versions,
  activeKeyConfigured: typeof keyring[activeVersion] === 'string' && keyring[activeVersion].length > 0,
  ownerConfigured: Boolean(process.env.CREDENTIALS_KEY_OWNER),
};
console.log(JSON.stringify(result));
if (!result.activeKeyConfigured || (failProduction && !result.ownerConfigured)) process.exitCode = 1;
