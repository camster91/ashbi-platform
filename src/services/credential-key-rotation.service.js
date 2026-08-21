import {
  decrypt,
  encryptWithVersion,
  getCiphertextKeyVersion,
} from '../utils/crypto.js';

export async function planCredentialKeyRotation(prisma, targetVersion) {
  const [credentials, sites, monitoringSettings] = await Promise.all([
    prisma.credential.findMany({ select: { id: true, password: true, encryptionVersion: true } }),
    prisma.wPSite.findMany({
      where: { bridgeSecretEncrypted: { not: null } },
      select: { id: true, bridgeSecretEncrypted: true },
    }),
    prisma.monitoringIntegrationSettings.findMany({
      where: { minimaxApiKeyEncrypted: { not: null } },
      select: { id: true, minimaxApiKeyEncrypted: true },
    }),
  ]);
  const records = [
    ...credentials.map((record) => ({ model: 'credential', id: record.id, ciphertext: record.password })),
    ...sites.map((record) => ({ model: 'wPSite', id: record.id, ciphertext: record.bridgeSecretEncrypted })),
    ...monitoringSettings.map((record) => ({ model: 'monitoringIntegrationSettings', id: record.id, ciphertext: record.minimaxApiKeyEncrypted })),
  ];
  const versions = {};
  const planned = [];
  for (const record of records) {
    const currentVersion = getCiphertextKeyVersion(record.ciphertext);
    versions[currentVersion] = (versions[currentVersion] || 0) + 1;
    if (currentVersion === targetVersion) continue;
    const plaintext = decrypt(record.ciphertext);
    planned.push({
      model: record.model,
      id: record.id,
      ciphertext: encryptWithVersion(plaintext, targetVersion),
    });
  }
  return { targetVersion, scanned: records.length, rotate: planned.length, versions, planned };
}

export async function rotateCredentialKeys(prisma, targetVersion, { apply = false } = {}) {
  const plan = await planCredentialKeyRotation(prisma, targetVersion);
  if (!apply || plan.planned.length === 0) return { ...plan, applied: false, planned: undefined };
  await prisma.$transaction(async (tx) => {
    for (const record of plan.planned) {
      if (record.model === 'credential') {
        await tx.credential.update({
          where: { id: record.id },
          data: { password: record.ciphertext, encryptionVersion: targetVersion },
        });
      } else if (record.model === 'wPSite') {
        await tx.wPSite.update({
          where: { id: record.id },
          data: { bridgeSecretEncrypted: record.ciphertext },
        });
      } else {
        await tx.monitoringIntegrationSettings.update({
          where: { id: record.id },
          data: { minimaxApiKeyEncrypted: record.ciphertext, minimaxApiKeyKeyVersion: targetVersion },
        });
      }
    }
  });
  return { ...plan, applied: true, planned: undefined };
}
