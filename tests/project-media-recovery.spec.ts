import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockAuthenticatedApi, unmockedRequests } from './fixtures/authenticated-api';

// Synthetic recorder output, deliberately binary. This suite exercises the real
// Project page, recording controller, multipart upload and browser Blob download;
// it does not claim to test device permissions, codecs or server persistence.
const recordingBytes = [0x1a, 0x45, 0xdf, 0xa3, 0, 255, 13, 10, 65, 83, 72, 66, 73];

async function mediaFixture(page: Page, baseURL: string | undefined, browserName: string) {
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL!).origin;
  expect(new URL(origin).hostname).toMatch(/^(127\.0\.0\.1|localhost|\[::1\])$/);
  const unexpectedNetwork: string[] = [];
  // Install before navigation: no application request may leave loopback or
  // reach an API/proxy accidentally. Later specific mocks take precedence.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) {
      unexpectedNetwork.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.routeWebSocket(/.*/, socket => {
    const url = new URL(socket.url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) unexpectedNetwork.push(socket.url());
    // No connectToServer: Vite HMR and Socket.IO remain local test sockets.
    socket.close();
  });
  await mockAuthenticatedApi(page);
  const uploads: Array<{ name: string; bytes: number[]; entityType: string; entityId: string }> = [];
  let failUpload = true;
  let failRefresh = false;
  let holdUpload: Promise<void> | undefined;
  let releaseUpload: (() => void) | undefined;
  await page.route('**/api/attachments?**', route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('entityType')).toBe('PROJECT');
    expect(url.searchParams.get('entityId')).toBe('project-a');
    return route.fulfill({ status: failRefresh ? 503 : 200, json: failRefresh ? { error: 'Synthetic list unavailable' } : [] });
  });
  await page.route('**/api/attachments', async route => {
    expect(route.request().method()).toBe('POST');
    const request = route.request();
    const form = await new Request(request.url(), {
      method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer()!,
    }).formData();
    const file = form.get('file') as File;
    const intercepted = { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())], entityType: String(form.get('entityType')), entityId: String(form.get('entityId')) };
    // WebKit's interception protocol omits Blob bytes (Playwright #6479).
    // Observe the actual FormData passed to native fetch on every engine;
    // additionally verify serialized wire bytes where the protocol exposes them.
    const submitted = await page.evaluate(async () => {
      const bodies = (window as any).__mediaRecoveryProbe.submitted as FormData[];
      const body = bodies[bodies.length - 1];
      const submittedFile = body.get('file') as File;
      return { name: submittedFile.name, bytes: [...new Uint8Array(await submittedFile.arrayBuffer())], entityType: String(body.get('entityType')), entityId: String(body.get('entityId')) };
    });
    expect(intercepted.name).toBe(submitted.name);
    expect(intercepted.entityType).toBe(submitted.entityType);
    expect(intercepted.entityId).toBe(submitted.entityId);
    if (browserName !== 'webkit') expect(intercepted).toEqual(submitted);
    uploads.push(submitted);
    if (holdUpload) await holdUpload;
    await route.fulfill({ status: failUpload ? 503 : 201, json: failUpload ? { error: 'Synthetic upload unavailable' } : { id: 'recording-a', originalName: file.name } });
  });
  await page.addInitScript(({ bytes }) => {
    const probe = { revoked: [] as string[], files: [] as File[], submitted: [] as FormData[], captures: 0, stopped: 0 };
    (window as any).__mediaRecoveryProbe = probe;
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === '/api/attachments' && init?.method === 'POST' && init.body instanceof FormData) probe.submitted.push(init.body);
      return originalFetch.call(this, input, init);
    };
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { probe.revoked.push(url); originalRevoke(url); };
    // Observe the app's original File at the native boundary. Reading it back
    // from FormData cannot establish identity: append(..., filename) wraps it.
    const originalAppend = FormData.prototype.append;
    FormData.prototype.append = function (name: string, value: string | Blob, filename?: string) {
      if (name === 'file' && value instanceof File) probe.files.push(value);
      if (filename !== undefined) return originalAppend.call(this, name, value as Blob, filename);
      return originalAppend.call(this, name, value as string);
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getDisplayMedia: async () => {
        probe.captures++;
        const track = { kind: 'video', readyState: 'live', addEventListener() {}, removeEventListener() {}, stop() { this.readyState = 'ended'; probe.stopped++; } };
        return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
      },
    } });
    class SyntheticRecorder {
      static isTypeSupported(type: string) { return type === 'video/webm'; }
      state = 'inactive';
      mimeType = 'video/webm';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) }); this.onstop?.(); });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: SyntheticRecorder });
  }, { bytes: recordingBytes });
  await page.goto('/project/project-a');
  await expect(page.getByRole('heading', { name: 'Live calls & recordings' })).toBeVisible();
  return {
    uploads,
    succeedUploads() { failUpload = false; },
    failRefresh() { failRefresh = true; },
    hold() { holdUpload = new Promise(resolve => { releaseUpload = resolve; }); },
    release() { releaseUpload?.(); holdUpload = undefined; },
    async check() {
      expect(unmockedRequests(page)).toEqual([]);
      expect(unexpectedNetwork).toEqual([]);
      expect(await page.evaluate(() => (window as any).__mediaRecoveryProbe.stopped)).toBeGreaterThan(0);
    },
  };
}

async function recordAndStop(page: Page) {
  await page.getByRole('button', { name: 'Record a project screen share', exact: true }).click();
  await page.getByRole('button', { name: 'Stop and upload screen recording', exact: true }).click();
}

test('failed recording can download original bytes then retry the same File once and clear recovery', async ({ page, baseURL, browserName }, testInfo) => {
  const fixture = await mediaFixture(page, baseURL, browserName);
  await recordAndStop(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Upload could not be confirmed' })).toBeVisible();
  expect(fixture.uploads).toHaveLength(1);
  const original = fixture.uploads[0];
  expect(original).toMatchObject({ bytes: recordingBytes, entityType: 'PROJECT', entityId: 'project-a' });
  expect(original.name).toMatch(/^screen-recording-\d{4}-\d{2}-\d{2}T[\d-]+Z\.webm$/);
  const save = page.getByRole('link', { name: 'Save recording', exact: true });
  await expect(save).toHaveAttribute('download', original.name);
  const blobUrl = await save.getAttribute('href');
  const recoveryScreenshot = testInfo.outputPath('recording-upload-recovery.png');
  await save.locator('..').evaluate(element => element.scrollIntoView({ block: 'center' }));
  await save.locator('..').screenshot({ path: recoveryScreenshot });
  await testInfo.attach('recording-upload-recovery', { path: recoveryScreenshot, contentType: 'image/png' });
  const downloadEvent = page.waitForEvent('download');
  await save.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(original.name);
  expect(await download.failure()).toBeNull();
  const savedPath = testInfo.outputPath(original.name);
  await download.saveAs(savedPath);
  expect([...await readFile(savedPath)]).toEqual(recordingBytes);
  await testInfo.attach('saved-original-recording', { path: savedPath, contentType: 'video/webm' });
  expect(fixture.uploads).toHaveLength(1); // Saving never submits or clears the take.
  await expect(save).toBeVisible();
  fixture.succeedUploads();
  fixture.hold();
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect.poll(() => fixture.uploads.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard recording', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Record a project screen share', exact: true })).toBeDisabled();
  // Programmatic repeated DOM activation also cannot bypass the in-flight guard.
  await page.getByRole('button', { name: 'Retry upload', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  fixture.release();
  await expect(save).toHaveCount(0);
  expect(fixture.uploads).toEqual([original, original]);
  expect(await page.evaluate(() => { const probe = (window as any).__mediaRecoveryProbe; return probe.files.length === 2 && probe.files[0] === probe.files[1]; })).toBe(true);
  expect(await page.evaluate(url => (window as any).__mediaRecoveryProbe.revoked.includes(url), blobUrl)).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record a project screen share', exact: true })).toBeEnabled();
  await fixture.check();
});

test('confirmed upload with failed list refresh has no retry or retained download', async ({ page, baseURL, browserName }) => {
  const fixture = await mediaFixture(page, baseURL, browserName);
  fixture.succeedUploads();
  fixture.failRefresh();
  await recordAndStop(page);
  await expect(page.getByRole('status').filter({ hasText: 'Recording uploaded. The file list could not refresh' })).toBeVisible({ timeout: 20_000 });
  expect(fixture.uploads).toHaveLength(1);
  await expect(page.getByRole('link', { name: 'Save recording', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard recording', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record a project screen share', exact: true })).toBeEnabled();
  await fixture.check();
});

test('explicit discard releases the failed take and permits another recording without retrying it', async ({ page, baseURL, browserName }) => {
  const fixture = await mediaFixture(page, baseURL, browserName);
  await recordAndStop(page);
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeEnabled();
  const save = page.getByRole('link', { name: 'Save recording', exact: true });
  const blobUrl = await save.getAttribute('href');
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await expect(save).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0);
  expect(await page.evaluate(url => (window as any).__mediaRecoveryProbe.revoked.includes(url), blobUrl)).toBe(true);
  expect(fixture.uploads).toHaveLength(1);
  await page.getByRole('button', { name: 'Record a project screen share', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop and upload screen recording', exact: true })).toBeVisible();
  expect(fixture.uploads).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__mediaRecoveryProbe.captures)).toBe(2);
  await fixture.check();
});
