import test from 'node:test';
import assert from 'node:assert/strict';
import {hubAuthFixture} from './hub-auth-fixture.mjs';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
test('existing Hub sessions authenticate the workspace without Access',async t=>{
 const f=await hubAuthFixture(createWorker);t.after(f.close);
 await t.test('public login and assets work; missing/forged sessions and Access headers grant no access',async()=>{
  assert.equal((await f.call('/')).status,303);assert.equal((await f.call('/login')).status,200);assert.equal((await f.call('/login.js')).status,200);assert.equal((await f.call('/app.css')).status,200);const sw=await f.call('/sw.js');assert.equal(sw.status,200);assert.equal(sw.headers.get('cache-control'),'no-store');assert.match(await sw.text(),/registration.unregister/);
  for(const options of [{},{headers:{'Cf-Access-Jwt-Assertion':'forged'}},{cookie:'token=forged'},{cookie:'token=fixture-session; token=forged'}])assert.equal((await f.call('/api/me',options)).status,401);
 });
 await t.test('login forwards only bounded same-origin JSON and secures its session cookie',async()=>{
  const before=f.calls.length;
  assert.equal((await f.call('/api/auth/login',{method:'POST',body:{email:'staff@example.invalid',password:'synthetic-password'},headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal(f.calls.length,before);assert.equal((await f.call('/api/auth/register',{method:'POST',body:{}})).status,404);
  assert.equal((await f.call('/api/auth/login?next=evil',{method:'POST',body:{}})).status,404);
  assert.equal((await f.call('/api/auth/login',{method:'POST',body:{password:'x'.repeat(66000)}})).status,413);
  const r=await f.call('/api/auth/login',{method:'POST',body:{email:'staff@example.invalid',password:'synthetic-password'}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal(r.headers.get('cache-control'),'no-store');
 });
 await t.test('current identity ignores forged headers and support-view cookies; role/org/MFA and actor changes deny access',async()=>{
  assert.equal((await f.call('/api/me',{cookie:f.cookie+'; impersonation=forged',headers:{Authorization:'Bearer forged'}})).status,200);
  assert.equal(f.calls.at(-1).headers.get('cookie'),f.cookie);assert.equal(f.calls.at(-1).headers.get('authorization'),null);
  const good=f.sessions.get(f.cookie);
  for(const change of [{role:'CLIENT'},{organizationId:'foreign'},{mfaEnrollmentRequired:true},{impersonation:{active:true}},{email:'unknown@example.invalid'}]){f.sessions.set(f.cookie,{...good,...change});assert.equal((await f.call('/api/me',{cookie:f.cookie})).status,403);}
  f.sessions.set(f.cookie,good);await f.DB.prepare("UPDATE actors SET active=0 WHERE id='native-staff'").run();assert.equal((await f.call('/api/me',{cookie:f.cookie})).status,403);await f.DB.prepare("UPDATE actors SET active=1 WHERE id='native-staff'").run();
 });
 await t.test('client sessions retain workspace client isolation',async()=>{
  f.sessions.set(f.cookie,{id:'hub-client',email:'client@example.invalid',organizationId:'hub-org',role:'CLIENT'});const r=await f.call('/api/clients',{cookie:f.cookie});assert.equal(r.status,200);assert.deepEqual((await r.json()).items.map(x=>x.id),['own']);assert.equal((await f.call('/api/clients/other',{cookie:f.cookie})).status,404);
 });
 await t.test('logout revokes the session and backend failures fail closed',async()=>{
  const r=await f.call('/api/auth/logout',{method:'POST',body:{},cookie:f.cookie});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await f.call('/api/me',{cookie:f.cookie})).status,401);
  f.login();for(const mode of ['offline','redirect']){f.setMode(mode);assert.equal((await f.call('/api/me',{cookie:f.cookie})).status,503);}f.setMode('password');
  const missing={...f.env,HUB_AUTH_ORGANIZATION_ID:''};assert.equal((await f.worker.fetch(new Request(f.env.APP_ORIGIN+'/api/me',{headers:{Cookie:f.cookie}}),missing)).status,503);
 });
});
