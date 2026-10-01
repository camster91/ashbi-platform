// Stored uploads without an attachment row (expense receipts, brand logos):
// name validation, safe opening, and no orphan file when the database write
// fails (src/utils/stored-upload.js and the upload routes that use it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const {
  brandLogoRelativePath, hashStoredUpload, openStoredUpload, receiptRelativePath, removeStoredBrandLogo, writeUploadThenPersist,
} = await import('../../utils/stored-upload.js');
const { default: brandRoutes, replaceLogoUrl } = await import('../../routes/brand.routes.js');
const { default: attachmentRoutes } = await import('../../routes/attachment.routes.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('stored-upload-test')]);

async function multipartBody(name, type, bytes, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'stored-upload-'));
}

test('only receipt and logo names the application writes are accepted', () => {
  const id = randomUUID();
  assert.equal(receiptRelativePath(`/uploads/receipt-${id}.pdf`), `receipt-${id}.pdf`);
  for (const bad of [
    null, '', 'https://example.com/r.png', `/uploads/../receipt-${id}.pdf`, `/uploads/brand/receipt-${id}.pdf`,
    `/uploads/receipt-${id}.pdf/x`, '/uploads/receipt-1.pdf', `/uploads/quarantine/receipt-${id}.pdf`, `/uploads/${id}.pdf`,
  ]) {
    assert.equal(receiptRelativePath(bad), null, String(bad));
  }
  assert.equal(brandLogoRelativePath(`/uploads/brand/logo-${id}.webp`), `brand/logo-${id}.webp`);
  for (const bad of [`/uploads/logo-${id}.png`, `/uploads/brand/logo-${id}.svg`, `/uploads/brand/../logo-${id}.png`, 'https://cdn.example.com/logo.png']) {
    assert.equal(brandLogoRelativePath(bad), null, bad);
  }
});

test('stored uploads are opened only as regular files inside the upload root', async () => {
  const root = await tempDir();
  const outside = await tempDir();
  try {
    const name = `receipt-${randomUUID()}.png`;
    await fs.writeFile(path.join(root, name), PNG);
    const hashed = await hashStoredUpload(name, root);
    assert.equal(hashed.size, PNG.length);
    assert.match(hashed.sha256, /^[0-9a-f]{64}$/);

    // A symbolic link (even to a real file) is refused.
    const secret = path.join(outside, 'secret.png');
    await fs.writeFile(secret, PNG);
    const linked = `receipt-${randomUUID()}.png`;
    await fs.symlink(secret, path.join(root, linked));
    assert.equal(await openStoredUpload(linked, root), null);
    assert.equal(await openStoredUpload(`receipt-${randomUUID()}.png`, root), null);
    assert.equal(await openStoredUpload('../secret.png', root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('writeUploadThenPersist removes the new file when the database write fails', async () => {
  const root = await tempDir();
  try {
    const failing = path.join(root, 'fails.png');
    await assert.rejects(writeUploadThenPersist(failing, PNG, async () => { throw new Error('db down'); }), /db down/);
    await assert.rejects(fs.access(failing), /ENOENT/);

    const kept = path.join(root, 'kept.png');
    assert.equal(await writeUploadThenPersist(kept, PNG, async () => 'row'), 'row');
    assert.deepEqual(await fs.readFile(kept), PNG);
    // Never overwrites an existing file.
    await assert.rejects(writeUploadThenPersist(kept, Buffer.from('x'), async () => 'row'), /EEXIST/);
    assert.deepEqual(await fs.readFile(kept), PNG);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removeStoredBrandLogo removes only application-written logo files', async () => {
  const root = await tempDir();
  try {
    await fs.mkdir(path.join(root, 'brand'));
    const name = `logo-${randomUUID()}.png`;
    await fs.writeFile(path.join(root, 'brand', name), PNG);
    await fs.writeFile(path.join(root, 'keep.png'), PNG);
    assert.equal(await removeStoredBrandLogo('/uploads/brand/../keep.png', root), false);
    assert.equal(await removeStoredBrandLogo('https://example.com/../../keep.png', root), false);
    await fs.access(path.join(root, 'keep.png'));
    assert.equal(await removeStoredBrandLogo(`/uploads/brand/${name}`, root), true);
    await assert.rejects(fs.access(path.join(root, 'brand', name)), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('brand logo upload: a failed settings write leaves no new file and keeps the old logo', async () => {
  const root = await tempDir();
  const app = Fastify({ logger: false });
  try {
    await fs.mkdir(path.join(root, 'brand'));
    const oldName = `logo-${randomUUID()}.png`;
    await fs.writeFile(path.join(root, 'brand', oldName), PNG);
    const settings = { id: 'brand-1', logoUrl: `/uploads/brand/${oldName}` };
    let failUpdate = true;
    app.decorate('prisma', {
      brandSettings: {
        findFirst: async () => settings,
        create: async () => settings,
        updateMany: async ({ data }) => {
          if (failUpdate) throw new Error('database unavailable');
          Object.assign(settings, data);
          return { count: 1 };
        },
      },
    });
    app.decorate('authenticate', async () => {});
    app.decorate('adminOnly', async () => {});
    await app.register(multipart);
    await app.register(brandRoutes, { prefix: '/api/brand', uploadsDir: root });

    const upload = async () => {
      const { payload, contentType } = await multipartBody('logo.png', 'image/png', PNG);
      return app.inject({ method: 'POST', url: '/api/brand/logo', payload, headers: { 'content-type': contentType } });
    };
    const failed = await upload();
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await fs.readdir(path.join(root, 'brand')), [oldName]);

    failUpdate = false;
    const ok = await upload();
    assert.equal(ok.statusCode, 200, ok.body);
    const newName = ok.json().logoUrl.slice('/uploads/brand/'.length);
    // The old logo is removed only after the row points at the new one.
    assert.deepEqual(await fs.readdir(path.join(root, 'brand')), [newName]);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('attachment upload: a failed attachment insert leaves no file behind', async () => {
  const uploadDir = path.join(process.cwd(), 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  const before = new Set(await fs.readdir(uploadDir));
  const app = Fastify({ logger: false });
  try {
    app.decorate('authenticate', async (request) => {
      request.user = { id: 'user-1', organizationId: 'org-1', role: 'ADMIN' };
      request.prisma = {
        project: { findFirst: async () => ({ id: 'project-1' }) },
        attachment: { create: async () => { throw new Error('insert failed'); } },
      };
    });
    await app.register(multipart);
    await app.register(attachmentRoutes, { prefix: '/api/attachments' });
    const { payload, contentType } = await multipartBody('file.png', 'image/png', PNG, { entityType: 'PROJECT', entityId: 'project-1' });
    const response = await app.inject({ method: 'POST', url: '/api/attachments', payload, headers: { 'content-type': contentType } });
    assert.equal(response.statusCode, 500);
    const added = (await fs.readdir(uploadDir)).filter((name) => !before.has(name));
    assert.deepEqual(added, []);
  } finally {
    await app.close();
  }
});

test('replaceLogoUrl swaps only the value it read and reports what it replaced', async () => {
  const row = { id: 'brand-1', logoUrl: '/uploads/brand/old.png' };
  let calls = 0;
  const prisma = {
    brandSettings: {
      // A concurrent upload wins the first swap.
      updateMany: async ({ where, data }) => {
        calls += 1;
        if (calls === 1) row.logoUrl = '/uploads/brand/concurrent.png';
        if (where.id !== row.id || where.logoUrl !== row.logoUrl) return { count: 0 };
        row.logoUrl = data.logoUrl;
        return { count: 1 };
      },
      findFirst: async () => ({ ...row }),
    },
  };
  const result = await replaceLogoUrl(prisma, { id: 'brand-1', logoUrl: '/uploads/brand/old.png' }, '/uploads/brand/mine.png');
  assert.equal(result.previousLogoUrl, '/uploads/brand/concurrent.png');
  assert.equal(result.updated.logoUrl, '/uploads/brand/mine.png');
  assert.equal(row.logoUrl, '/uploads/brand/mine.png');

  const stuck = { brandSettings: { updateMany: async () => ({ count: 0 }), findFirst: async () => ({ ...row }) } };
  await assert.rejects(replaceLogoUrl(stuck, row, '/uploads/brand/x.png'), (error) => error.statusCode === 409);
});
