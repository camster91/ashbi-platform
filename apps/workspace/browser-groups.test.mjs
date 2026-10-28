import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {browserGroups,selectBrowserSuites} from './browser-groups.mjs';

const expected={
 core:['runRegressions','runTaskBoardTests','runCommentTests','runDocumentTests','runDocumentTreeTests','runTimerTests','runTimeReviewTests','runFinanceTests','runProjectWorkspaceTests','runCompactListTests','runNavigationGroupTests','runSearchTests'],
 commerce:['runCommercialTests','runProposalReviewTests','runStripeTests','runInvoiceTests','runRecordLinkTests'],
 contracts:['runDashboardTests','runContractTests','runContractPdfTests','runStripeIssuanceTests'],
 delivery:['runStripeDeliveryTests'],
 overview_parts:['runOverviewPartTests'],
 journey:['runWorkspaceJourneyTests']
};
const all=Object.values(expected).flat();

test('browser groups preserve every registered coordinator suite exactly once in original order',async()=>{
 const coordinator=await readFile(new URL('./browser.test.mjs',import.meta.url),'utf8');
 const registered=Array.from(coordinator.matchAll(/\bawait\s+(run[A-Z]\w*)\s*\(/g),match=>match[1]);
 assert.deepEqual(registered,all,'The coordinator and group coverage must change together; no suite may silently disappear.');
 assert.deepEqual(browserGroups,expected);
 const grouped=Object.values(browserGroups).flat();
 assert.equal(grouped.length,new Set(grouped).size,'A suite must not run in more than one CI group.');
 assert.deepEqual(grouped,registered);
 const workflow=await readFile(new URL('../../.github/workflows/cloudflare-workspace.yml',import.meta.url),'utf8');
 const matrix=workflow.match(/group:\s*\[([^\]]+)\]/);
 assert.ok(matrix,'CI must select explicit browser groups.');
 assert.deepEqual(matrix[1].split(',').map(name=>name.trim()),Object.keys(expected),'Every browser group must run in CI; the final browser gate must not omit a suite.');
});

test('default and all selection retain the full ordered browser suite',()=>{
 assert.deepEqual(selectBrowserSuites(),all);
 assert.deepEqual(selectBrowserSuites(undefined),all);
 assert.deepEqual(selectBrowserSuites('all'),all);
});

test('each explicit browser group selects its complete ordered suite',()=>{
 for(const [name,suites] of Object.entries(expected))assert.deepEqual(selectBrowserSuites(name),suites,name);
});

test('unknown and malformed browser group values fail closed',()=>{
 for(const value of ['', 'unknown', 'ALL', 'core,commerce', ' core', 'core ', '__proto__', 'constructor', null, false, 0, [], {}]){
  assert.throws(()=>selectBrowserSuites(value),undefined,`Invalid group ${JSON.stringify(value)} must throw rather than skip browser checks.`);
 }
});

test('browser group definitions and returned selections cannot mutate future coverage',()=>{
 assert.equal(Object.isFrozen(browserGroups),true);
 for(const [name,suites] of Object.entries(browserGroups)){
  assert.equal(Object.isFrozen(suites),true,name);
  assert.throws(()=>suites.push('unregisteredSuite'),TypeError);
  assert.throws(()=>{suites[0]='unregisteredSuite';},TypeError);
 }
 assert.throws(()=>{browserGroups.extra=[];},TypeError);
 assert.throws(()=>{browserGroups.core=[];},TypeError);
 for(const name of [undefined,'all',...Object.keys(expected)]){
  const selected=selectBrowserSuites(name);
  try{selected.push('unregisteredSuite');}catch(error){assert.ok(error instanceof TypeError);}
  try{selected[0]='unregisteredSuite';}catch(error){assert.ok(error instanceof TypeError);}
  assert.deepEqual(selectBrowserSuites(name),name===undefined||name==='all'?all:expected[name]);
 }
 assert.deepEqual(browserGroups,expected);
});
