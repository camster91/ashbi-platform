import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { rawPrisma } from '../src/config/db.js';
import { rotateCredentialKeys } from '../src/services/credential-key-rotation.service.js';
import { revealCredentialSecret } from '../src/services/credential-vault.service.js';
import { decrypt, encryptWithVersion, getCiphertextKeyVersion } from '../src/utils/crypto.js';

const confirmed = process.argv.includes('--confirm-disposable');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!confirmed || !['127.0.0.1', 'localhost'].includes(url.hostname) || process.env.NODE_ENV === 'production') {
  console.error('Rotation drill requires --confirm-disposable, a localhost database, and non-production NODE_ENV');
  process.exitCode = 1;
} else {
  try {
    const suffix = Date.now().toString(36);
    const disposableCredentialSecret = crypto.randomBytes(32).toString('hex');
    const disposableBridgeSecret = crypto.randomBytes(32).toString('hex');
    const organization = await rawPrisma.organization.create({
      data: { name: `Rotation Drill ${suffix}`, slug: `rotation-drill-${suffix}` },
    });
    const user = await rawPrisma.user.create({
      data: {
        organizationId: organization.id,
        email: `rotation-${suffix}@example.invalid`,
        name: 'Rotation Drill',
        password: 'non-reusable-test-hash',
        role: 'ADMIN',
      },
    });
    const client = await rawPrisma.client.create({
      data: { organizationId: organization.id, name: `Rotation Client ${suffix}` },
    });
    const otherOrganization = await rawPrisma.organization.create({
      data: { name: `Other Rotation Org ${suffix}`, slug: `other-rotation-${suffix}` },
    });
    const otherClient = await rawPrisma.client.create({
      data: { organizationId: otherOrganization.id, name: `Other Client ${suffix}` },
    });
    await assert.rejects(
      rawPrisma.credential.create({
        data: {
          organizationId: organization.id,
          clientId: otherClient.id,
          label: 'Cross-organization credential',
          password: encryptWithVersion(crypto.randomBytes(32).toString('hex'), 'legacy'),
        },
      }),
      /different organization/,
    );
    const credential = await rawPrisma.credential.create({
      data: {
        organizationId: organization.id,
        clientId: client.id,
        label: 'Disposable credential',
        password: encryptWithVersion(disposableCredentialSecret, 'legacy'),
        encryptionVersion: 'legacy',
      },
    });
    const legacyWriterId = `legacy-writer-${suffix}`;
    const legacyWriterCiphertext = encryptWithVersion(crypto.randomBytes(32).toString('hex'), 'legacy');
    await rawPrisma.$executeRaw`
      INSERT INTO credentials (id, label, password, "clientId", "updatedAt")
      VALUES (${legacyWriterId}, 'Legacy rollback writer', ${legacyWriterCiphertext}, ${client.id}, NOW())
    `;
    const legacyWriterCredential = await rawPrisma.credential.findUniqueOrThrow({ where: { id: legacyWriterId } });
    assert.equal(legacyWriterCredential.organizationId, organization.id);
    const site = await rawPrisma.wPSite.create({
      data: {
        organizationId: organization.id,
        name: 'Disposable site',
        url: `https://${suffix}.example.invalid`,
        bridgeSecretEncrypted: encryptWithVersion(disposableBridgeSecret, 'legacy'),
      },
    });

    const plaintext = await revealCredentialSecret({
      prisma: rawPrisma,
      credential,
      context: {
        organizationId: organization.id,
        actorUserId: user.id,
        purpose: 'rotation drill',
        route: 'rotation-drill',
        traceId: `drill-${suffix}`,
      },
    });
    assert.equal(plaintext, disposableCredentialSecret);

    const audit = await rawPrisma.credentialAccessAudit.findFirstOrThrow({
      where: { credentialId: credential.id },
    });
    await assert.rejects(
      rawPrisma.$executeRawUnsafe('UPDATE credential_access_audits SET purpose = $1 WHERE id = $2', 'tampered', audit.id),
      /immutable/,
    );

    const forward = await rotateCredentialKeys(rawPrisma, 'v2', { apply: true });
    const rotatedCredential = await rawPrisma.credential.findUniqueOrThrow({ where: { id: credential.id } });
    const rotatedSite = await rawPrisma.wPSite.findUniqueOrThrow({ where: { id: site.id } });
    assert.equal(getCiphertextKeyVersion(rotatedCredential.password), 'v2');
    assert.equal(getCiphertextKeyVersion(rotatedSite.bridgeSecretEncrypted), 'v2');
    assert.equal(decrypt(rotatedCredential.password), disposableCredentialSecret);
    assert.equal(decrypt(rotatedSite.bridgeSecretEncrypted), disposableBridgeSecret);

    const rollback = await rotateCredentialKeys(rawPrisma, 'legacy', { apply: true });
    const restored = await rawPrisma.credential.findUniqueOrThrow({ where: { id: credential.id } });
    assert.equal(getCiphertextKeyVersion(restored.password), 'legacy');
    assert.equal(decrypt(restored.password), disposableCredentialSecret);

    console.log(JSON.stringify({
      status: 'pass',
      immutableAudit: true,
      crossOrganizationWriteRejected: true,
      legacyWriterOwnershipDerived: true,
      forwardRotated: forward.rotate,
      rollbackRotated: rollback.rotate,
      finalVersion: 'legacy',
    }));
  } finally {
    await rawPrisma.$disconnect();
  }
}
