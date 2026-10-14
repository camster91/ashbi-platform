import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createClientWithContact, json, loginAdminThroughUi } from './support';
test('project document sharing persists, enforces read-only staff and preserves privacy after parent archive',async({page})=>{
 await loginAdminThroughUi(page);const api=page.request,{client,suffix}=await createClientWithContact(api,'Note audience QA');const project=await json(await api.post('/api/projects',{data:{clientId:client.id,name:'Note audience '+suffix}}),201);
 const title='Private note '+suffix,note=await json(await api.post('/api/projects/'+project.id+'/notes',{data:{title,content:'Private draft'}}),201);
 const staffName='Note reader '+suffix,email=randomUUID()+'@e2e.example.test',password=randomUUID();const reader=await json(await api.post('/api/team',{data:{name:staffName,email,password,role:'TEAM'}}),201);
 const child=await json(await api.post('/api/projects/'+project.id+'/notes',{data:{title:'Nested '+suffix,content:'Nested draft',parentId:note.id}}),201);
 await page.goto('/docs');await page.getByPlaceholder('Search notes...').fill(title);await page.getByRole('button',{name:'Toggle note '+title,exact:true}).click();await page.getByRole('button',{name:'Manage document sharing'}).click();const sharing=page.getByRole('region',{name:'Document sharing'});
 await sharing.getByLabel('Audience',{exact:true}).selectOption('RESTRICTED');await sharing.getByLabel('Add teammate',{exact:true}).selectOption(reader.id);await sharing.getByRole('button',{name:'Add teammate',exact:true}).click();await sharing.getByRole('button',{name:'Save sharing'}).click();await expect(sharing.getByText('Sharing saved')).toBeVisible();
 const access=await json(await api.get('/api/notes/'+note.id+'/access'));expect(access.mode).toBe('RESTRICTED');expect(access.members.some((row:any)=>row.userId===reader.id&&row.role==='READ')).toBe(true);
 await page.reload();await page.getByRole('button',{name:'Toggle note '+title,exact:true}).click();await page.getByRole('button',{name:'Manage document sharing'}).click();await expect(sharing.getByLabel('Audience',{exact:true})).toHaveValue('RESTRICTED');
 for(const width of [390,320]){await page.setViewportSize({width,height:844});expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);}
 const context=await page.context().browser()!.newContext({baseURL:new URL(page.url()).origin});try{
 expect((await context.request.post('/api/auth/login',{data:{email,password}})).status()).toBe(200);const viewer=await context.newPage();await viewer.goto('/docs');await viewer.getByPlaceholder('Search notes...').fill(title);await expect(viewer.getByRole('button',{name:'Edit '+title,exact:true})).toBeDisabled();expect((await context.request.post('/api/notes/'+note.id+'/pin')).status()).toBe(403);
 await json(await api.delete('/api/notes/'+note.id));const promoted=await json(await context.request.get('/api/notes/'+child.id));expect(promoted.parentId).toBeNull();expect(promoted.permissions.canEdit).toBe(false);expect((await context.request.post('/api/notes/'+note.id+'/restore')).status()).toBe(403);
 await json(await api.post('/api/notes/'+note.id+'/restore'));expect((await json(await context.request.get('/api/notes/'+note.id))).permissions.canEdit).toBe(false);
 }finally{await context.close();}
});
