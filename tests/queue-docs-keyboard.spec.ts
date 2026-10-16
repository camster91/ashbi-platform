import { expect, test, type Page } from '@playwright/test';

async function mockReadOnlyUi(page: Page) {
  const project = { id: 'keyboard-project', name: 'Keyboard project', client: { id: 'keyboard-client', name: 'Synthetic client' } };
  const notes = [
    { id: 'keyboard-note', title: 'Keyboard document', content: 'Plain-text document content', revision: 0, type: 'DOC', projectId: project.id, project, updatedAt: '2026-10-16T12:00:00Z', permissions: { canEdit: true, canManage: false } },
    { id: 'empty-note', title: 'Empty document', content: '', revision: 0, type: 'DOC', projectId: project.id, project, updatedAt: '2026-10-16T12:00:00Z', permissions: { canEdit: true, canManage: false } },
  ];
  const unknown: string[] = [];
  await page.context().routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    const path = url.pathname;
    if (request.method() !== 'GET') { unknown.push(request.method() + ' ' + path); return json({error:'Read-only fixture'},405); }
    if (path === '/api/auth/me') return json({id:'keyboard-user',organizationId:'keyboard-org',name:'Synthetic staff',email:'keyboard@example.invalid',role:'ADMIN'});
    if (path === '/api/client-portal/me') return json({},401);
    if (path === '/api/projects') return json({projects:[project],total:1});
    if (path === '/api/clients') return json({clients:[project.client],total:1});
    if (path === '/api/notes') return json({notes,pagination:{page:1,pages:1}});
    if (path === '/api/notes/templates' || path === '/api/team') return json([]);
    if (path === '/api/onboarding/progress') return json({completed:true,dismissed:true});
    if (path === '/api/time-sessions/running') return json(null);
    if (path === '/api/inbox/stats') return json({total:0,unread:0});
    if (path.startsWith('/api/notifications')) return json({notifications:[],total:0,count:0});
    if (path === '/api/work-queue') return json({rows:[],counts:{needs_action:0,awaiting_approval:0,waiting_on_client:0,at_risk:0},partial:false,sources:[]});
    unknown.push(path); return json({error:'Unconfigured synthetic read'},501);
  });
  return unknown;
}

async function keyboardReach(page: Page, target: ReturnType<Page['getByRole']>, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  for (let i = 0; i < 45; i++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw Error(`Target was not reachable with ${key}`);
}

test('queue panel keeps a visible keyboard focus indicator after roving tabs', async ({page}, info) => {
  const unknown = await mockReadOnlyUi(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/queue');
  const first = page.getByRole('tab', {name:/Needs action/});
  await expect(first).toBeVisible();
  await keyboardReach(page, first);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', {name:/Awaiting approval/})).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toHaveAttribute('aria-selected','true');
  await expect(first).toHaveAttribute('tabindex','0');
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeFocused();
  const focus = await panel.evaluate(element => {
    const style = getComputedStyle(element);
    return {focusVisible:element.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor,boxShadow:style.boxShadow};
  });
  await info.attach('queue-panel-computed-focus', {body:JSON.stringify(focus,null,2),contentType:'application/json'});
  expect(focus.focusVisible).toBe(true);
  const outlined = focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) > 0 && !/transparent|rgba\(0, 0, 0, 0\)/.test(focus.outlineColor);
  const ringed = focus.boxShadow.split(/,(?![^(]*\))/).some(shadow => !/transparent|rgba\(0, 0, 0, 0\)/.test(shadow) && (shadow.match(/-?\d+(?:\.\d+)?px/g) || []).some(length => parseFloat(length) !== 0));
  expect(outlined || ringed, JSON.stringify(focus)).toBe(true);
  await info.attach('browser-version', {body:page.context().browser()!.version(),contentType:'text/plain'});
  await page.screenshot({path:info.outputPath('queue-keyboard-focus.png')});
  expect(unknown).toEqual([]);
});

test('document disclosures expose accurate state and existing controlled targets for content, empty and edit views', async ({page}, info) => {
  const unknown = await mockReadOnlyUi(page);
  await page.goto('/docs');
  const toggle = page.getByRole('button', {name:'Toggle note Keyboard document',exact:true});
  await expect(toggle).toBeVisible();
  await keyboardReach(page, toggle);
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).not.toHaveAttribute('aria-controls');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  const content = page.getByRole('region',{name:'Keyboard document content',exact:true});
  await expect(content).toBeVisible();
  const contentId = await toggle.getAttribute('aria-controls');
  expect(contentId).toBeTruthy();
  await expect(content).toHaveAttribute('id',contentId!);
  await page.screenshot({path:info.outputPath('docs-expanded-keyboard.png')});
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).not.toHaveAttribute('aria-controls');
  await expect(content).toHaveCount(0);
  await expect(toggle).toBeFocused();
  const empty = page.getByRole('button',{name:'Toggle note Empty document',exact:true});
  // Docs sorts Empty before Keyboard. Traverse backward within the page rather
  // than relying on forward Tab wrapping through the browser's chrome.
  await keyboardReach(page,empty,'Shift+Tab'); await expect(empty).toBeFocused(); await page.keyboard.press('Enter');
  await expect(empty).toHaveAttribute('aria-expanded','true');
  const emptyId = await empty.getAttribute('aria-controls'); expect(emptyId).toBeTruthy();
  await expect(page.getByText('No content. Click edit to add.',{exact:true})).toHaveAttribute('id',emptyId!);
  expect(emptyId).not.toBe(contentId); await page.keyboard.press('Space');
  await expect(empty).not.toHaveAttribute('aria-controls');
  const edit = page.getByRole('button',{name:'Edit Keyboard document',exact:true});
  await keyboardReach(page,edit); await expect(edit).toBeFocused(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true'); await expect(toggle).toHaveAttribute('aria-controls',contentId!);
  const title = page.getByLabel('Edit Keyboard document title',{exact:true}); await expect(title).toBeVisible();
  expect(await title.evaluate(element=>element.closest('form')?.id)).toBe(contentId);
  expect(unknown).toEqual([]);
});
