import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), 'src', 'pages', file), 'utf8');

describe('administrative confirmation adoption', () => {
  it.each([
    ['Credentials.jsx', ['Delete credential']],
    ['Settings.jsx', ['Restart onboarding', 'Revoke API key']],
    ['WPSites.jsx', ['Remove WordPress site', 'Revoke magic-login token']],
  ])('%s uses shared pending-safe dialogs instead of native confirmation', (file, titles) => {
    const source = read(file);

    expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
    expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/);
    for (const title of titles) {
      expect(source).toContain(`title="${title}"`);
    }
  });

  it('names affected credentials and explains permanent deletion', () => {
    const source = read('Credentials.jsx');
    expect(source).toContain('credentialToDelete.label');
    expect(source).toContain('cannot be undone');
    expect(source).toContain('pending={deleteMutation.isPending}');
    expect(source).toContain('error={deleteMutation.error?.message}');
  });

  it('explains API-key and WordPress access consequences', () => {
    const settings = read('Settings.jsx');
    const wordpress = read('WPSites.jsx');
    expect(settings).toContain('integrations using it will stop working');
    expect(wordpress).toContain('disconnects monitoring, backups, reports, and managed operations');
    expect(wordpress).toContain('The user will no longer be able to use this link');
  });
});
