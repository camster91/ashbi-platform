import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CREDENTIALS_KEY = 'rotation-old-key';
process.env.CREDENTIALS_KEYRING = JSON.stringify({ legacy: 'rotation-old-key', v2: 'rotation-new-key' });

const { decrypt, encryptWithVersion, getCiphertextKeyVersion } = await import('../../utils/crypto.js');
const { rotateCredentialKeys } = await import('../../services/credential-key-rotation.service.js');

function fakePrisma({ failUpdate = false } = {}) {
  const state = {
    credentials: [{ id: 'cred-1', password: encryptWithVersion('credential-secret', 'legacy'), encryptionVersion: 'legacy' }],
    sites: [{ id: 'site-1', bridgeSecretEncrypted: encryptWithVersion('bridge-secret', 'legacy') }],
    aiConnections: [{ id: 'ai-1', encryptedApiKey: encryptWithVersion('sk-byok-secret', 'legacy') }],
  };
  const client = {
    credential: {
      findMany: async () => structuredClone(state.credentials),
      update: async ({ where, data }) => {
        if (failUpdate) throw new Error('simulated write failure');
        Object.assign(state.credentials.find((row) => row.id === where.id), data);
      },
    },
    wPSite: {
      findMany: async () => structuredClone(state.sites),
      update: async ({ where, data }) => Object.assign(state.sites.find((row) => row.id === where.id), data),
    },
    aiProviderConnection: {
      findMany: async () => structuredClone(state.aiConnections),
      update: async ({ where, data }) => Object.assign(state.aiConnections.find((row) => row.id === where.id), data),
    },
  };
  client.$transaction = async (callback) => {
    const snapshot = structuredClone(state);
    try { return await callback(client); } catch (error) {
      state.credentials = snapshot.credentials;
      state.sites = snapshot.sites;
      state.aiConnections = snapshot.aiConnections;
      throw error;
    }
  };
  return { client, state };
}

test('old and new keys coexist through rotation and rollback', async () => {
  const { client, state } = fakePrisma();
  const dryRun = await rotateCredentialKeys(client, 'v2');
  assert.equal(dryRun.rotate, 3);
  assert.equal(getCiphertextKeyVersion(state.credentials[0].password), 'legacy');

  const applied = await rotateCredentialKeys(client, 'v2', { apply: true });
  assert.equal(applied.applied, true);
  assert.equal(getCiphertextKeyVersion(state.credentials[0].password), 'v2');
  assert.equal(decrypt(state.credentials[0].password), 'credential-secret');
  assert.equal(decrypt(state.sites[0].bridgeSecretEncrypted), 'bridge-secret');
  assert.equal(getCiphertextKeyVersion(state.aiConnections[0].encryptedApiKey), 'v2');
  assert.equal(decrypt(state.aiConnections[0].encryptedApiKey), 'sk-byok-secret');

  await rotateCredentialKeys(client, 'legacy', { apply: true });
  assert.equal(getCiphertextKeyVersion(state.credentials[0].password), 'legacy');
  assert.equal(decrypt(state.credentials[0].password), 'credential-secret');
});

test('a failed staged rotation rolls every record back', async () => {
  const { client, state } = fakePrisma({ failUpdate: true });
  await assert.rejects(() => rotateCredentialKeys(client, 'v2', { apply: true }), /simulated write failure/);
  assert.equal(getCiphertextKeyVersion(state.credentials[0].password), 'legacy');
  assert.equal(getCiphertextKeyVersion(state.sites[0].bridgeSecretEncrypted), 'legacy');
});
