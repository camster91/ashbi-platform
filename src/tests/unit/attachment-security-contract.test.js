import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const read = relative => readFile(new URL(`../../../${relative}`, import.meta.url), 'utf8');

describe('attachment security contract', () => {
  it('routes every upload entry point through the content-aware policy', async () => {
    for (const route of [
      'src/routes/attachment.routes.js',
      'src/routes/client-portal.routes.js',
      'src/routes/brand.routes.js',
      'src/routes/expense.routes.js',
    ]) {
      const source = await read(route);
      assert.match(source, /validateUpload\s*\(\s*\{[\s\S]*?buffer[\s\S]*?\}\s*\)/, route);
    }
    const brand = await read('src/routes/brand.routes.js');
    assert.match(brand, /logo-\$\{randomUUID\(\)\}/);
  });

  it('stores attachment tenant ownership explicitly', async () => {
    const schema = await read('prisma/schema.prisma');
    const model = schema.match(/model Attachment \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(model, /organizationId\s+String/);
    assert.match(model, /@@index\(\[organizationId\]\)/);
    const proxy = await read('src/utils/prisma-tenant-proxy.js');
    assert.match(proxy, /['"]attachment['"]/);
  });

  it('tenant-scopes downloads and forces safe headers', async () => {
    const source = await read('src/routes/attachment.routes.js');
    assert.match(source, /where:\s*\{\s*filename:\s*safeName,\s*organizationId:\s*request\.user\.organizationId\s*\}/);
    assert.match(source, /safeDownloadHeaders\(attachment\.originalName\)/);
    const portal = await read('src/routes/client-portal.routes.js');
    assert.match(portal, /client-portal\/documents\/:docId\/download/);
    assert.match(portal, /safeDownloadHeaders\(doc\.originalName\)/);
    assert.match(portal, /where:\s*\{\s*id:\s*doc\.entityId,\s*clientId\s*\}/);
  });
});
