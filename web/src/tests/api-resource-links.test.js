import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
beforeEach(()=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({})})));
afterEach(()=>vi.unstubAllGlobals());
it('uses bounded exact resource routes, preserves URL payload and caller revisions/intent',async()=>{
  const body={entityType:'TASK',entityId:'t1',title:'Brief',url:'https://example.com/a?x=1#part',clientVisible:false,createIntentId:'711ab336-e252-4090-a4fd-bac8cf004b37'};
  await api.listResourceLinks({entityType:'TASK',entityId:'t/1',limit:100,includeArchived:true});
  await api.createResourceLink(body); await api.updateResourceLink('r/1',{expectedRevision:2,title:'New'});
  await api.archiveResourceLink('r/1',{expectedRevision:3,archived:true});
  await api.reorderResourceLinks({entityType:'TASK',entityId:'t1',ordered:[{id:'r1',expectedRevision:4}]});
  expect(fetch.mock.calls.map(([url])=>url)).toEqual(['/api/resource-links?entityType=TASK&entityId=t%2F1&limit=100&includeArchived=true','/api/resource-links','/api/resource-links/r%2F1','/api/resource-links/r%2F1/archive','/api/resource-links/reorder']);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body); expect(fetch.mock.calls[2][1].method).toBe('PATCH');
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({expectedRevision:3,archived:true});
});
it('loads client resources with current-client token and configured API base',async()=>{
  await api.portalProjectResourceLinks('p/1','portal-session',{limit:100,after:'opaque+cursor'});
  expect(fetch).toHaveBeenCalledWith('/api/client-portal/projects/p%2F1/resource-links?limit=100&after=opaque%2Bcursor',expect.objectContaining({credentials:'include',headers:expect.objectContaining({Authorization:'Bearer portal-session'})}));
});
