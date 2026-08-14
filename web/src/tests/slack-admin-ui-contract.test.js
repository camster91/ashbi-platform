import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');
const settings = readFileSync(resolve(process.cwd(), 'src/pages/Settings.jsx'), 'utf8');

describe('Slack administrator workflow contract', () => {
  it('exposes the tenant-safe installation lifecycle through Settings', () => {
    expect(api).toContain('slackOAuthStartUrl');
    expect(api).toContain('getSlackInstallations: ()');
    expect(api).toContain('disconnectSlackInstallation: (installationId)');
    expect(settings).toContain('Connect Slack workspace');
    expect(settings).toContain('Disconnect immediately stops processing and clears the stored token.');
    expect(settings).toContain('api.slackOAuthStartUrl()');
  });

  it('requires an explicit project/channel mapping and displays its enabled directions', () => {
    expect(api).toContain('createSlackChannelMapping: (installationId, data)');
    expect(settings).toContain('Map a project channel');
    expect(settings).toContain('Receive inbound messages');
    expect(settings).toContain('Allow confirmed outbound posts');
    expect(settings).toContain('Save channel mapping');
  });
});
