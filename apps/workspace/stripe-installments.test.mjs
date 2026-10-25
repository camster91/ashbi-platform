import test from 'node:test';
import assert from 'node:assert/strict';

const load=async()=> (await import('./stripe-installments.mjs')).allocateInstallments;
const half=(n,d)=>(n*2n+d)/(d*2n);
function fixture(amounts=[101,202],rate=1300,deposit=null){
 const subtotalMinor=amounts.reduce((a,b)=>a+b,0),taxMinor=Number(half(BigInt(subtotalMinor)*BigInt(rate),10000n)),totalMinor=subtotalMinor+taxMinor;
 return {version:1,currency:'CAD',tax:{type:rate?'TAX':'NONE',rateBps:rate},dueOn:'2028-03-01',lines:amounts.map((n,i)=>({kind:'FIXED',description:'Source '+i,quantity:1,unitMinor:n,totalMinor:n})),subtotalMinor,taxMinor,totalMinor,installments:deposit===null?[{kind:'FULL',dueOn:'2028-03-01',amountMinor:totalMinor}]:[{kind:'DEPOSIT',dueOn:'2028-02-29',amountMinor:deposit},{kind:'BALANCE',dueOn:'2028-03-01',amountMinor:totalMinor-deposit}]};
}
function conservation(snapshot,result){
 assert.equal(result.installments.length,snapshot.installments.length);
 for(const [i,child] of result.installments.entries()){
  assert.equal(child.kind,snapshot.installments[i].kind);assert.equal(child.dueOn,snapshot.installments[i].dueOn);
  assert.equal(child.totalMinor,snapshot.installments[i].amountMinor);
  assert.equal(child.subtotalMinor+child.taxMinor,child.totalMinor);
  assert.equal(child.lines.reduce((s,l)=>s+BigInt(l.amountMinor),0n),BigInt(child.subtotalMinor));
  assert.equal(child.lines.reduce((s,l)=>s+BigInt(l.taxMinor),0n),BigInt(child.taxMinor));
  assert.equal(child.lines.length,snapshot.lines.length);
  for(const [j,line] of child.lines.entries()){assert.equal(line.index,j);assert.equal(line.sourceIndex,j);assert.ok(Number.isSafeInteger(line.amountMinor)&&line.amountMinor>=0);assert.ok(Number.isSafeInteger(line.taxMinor)&&line.taxMinor>=0);}
 }
 for(const key of ['subtotalMinor','taxMinor','totalMinor'])assert.equal(result.installments.reduce((n,c)=>n+BigInt(c[key]),0n),BigInt(snapshot[key]));
 let cumulative=0n,previousTax=0n;
 for(const [i,line] of snapshot.lines.entries()){
  cumulative+=BigInt(line.totalMinor);const tax=half(cumulative*BigInt(snapshot.tax.rateBps),10000n);
  assert.equal(result.installments.reduce((n,c)=>n+BigInt(c.lines[i].amountMinor),0n),BigInt(line.totalMinor));
  assert.equal(result.installments.reduce((n,c)=>n+BigInt(c.lines[i].taxMinor),0n),tax-previousTax);previousTax=tax;
 }
}
test('FULL preserves cumulative tax, zero lines and fixed descriptions',async()=>{
 const allocate=await load(),s=fixture([1,1,0,2],5000),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines.map(l=>l.taxMinor),[1,0,0,1]);
 assert.equal(r.installments[0].lines[0].description,'Source 0 (quantity 1)');assert.deepEqual(r.holds,[]);
});
test('deposit uses cumulative gross allocation and exact residual balance',async()=>{
 const allocate=await load(),s=fixture([101,202],1300,100),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines.map(l=>[l.amountMinor,l.taxMinor]),[[29,4],[59,8]]);
 assert.deepEqual(r.installments[1].lines.map(l=>[l.amountMinor,l.taxMinor]),[[72,9],[143,18]]);
});
test('tax-only penny is retained and explicitly held for provider review',async()=>{
 const allocate=await load(),s=fixture([1],5000,1),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines[0],{index:0,description:'Source 0 (quantity 1)',sourceIndex:0,amountMinor:0,taxMinor:1});
 assert.deepEqual(r.holds,[{code:'TAX_ONLY_LINE_REVIEW_REQUIRED',kind:'DEPOSIT',sourceIndex:0}]);
});
test('time lineage and existing rounded time amounts are preserved',async()=>{
 const allocate=await load(),s=fixture([1],0);s.lines=[{kind:'TIME',description:'Approved work',totalMinor:1,source:{id:'time-1',seconds:1,rateMinor:1800}}];
 const r=allocate(s);conservation(s,r);assert.equal(r.installments[0].lines[0].description,'Approved work');
});
test('maximum safe totals use exact BigInt products without floating point loss',async()=>{
 const allocate=await load(),s=fixture([Number.MAX_SAFE_INTEGER-2,2],0,4503599627370495),r=allocate(s);conservation(s,r);
 assert.equal(r.installments[0].lines[0].amountMinor,4503599627370494);
});
test('all tiny schedules conserve each source subtotal and tax',async()=>{
 const allocate=await load();for(const rate of [0,1,500,1300,5000])for(let a=0;a<6;a++)for(let b=1;b<6;b++){
  const base=fixture([a,b],rate);for(let d=1;d<base.totalMinor;d++){const s=fixture([a,b],rate,d);conservation(s,allocate(s));}
 }
});
test('allocation is deterministic and leaves deeply frozen source snapshots unchanged',async()=>{
 const allocate=await load(),s=fixture([1,202],1300,35),before=JSON.stringify(s);
 const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};freeze(s);
 assert.deepEqual(allocate(s),allocate(s));assert.equal(JSON.stringify(s),before);
});
test('malformed snapshot totals, rates, lines, dates and schedules fail closed with 409',async()=>{
 const allocate=await load();const changes=[
  s=>s.version=2,s=>s.subtotalMinor++,s=>s.taxMinor++,s=>s.totalMinor++,s=>s.tax.rateBps=5001,s=>s.tax.rateBps=0.5,s=>s.tax.type='UNKNOWN',s=>s.tax.type='NONE',
  s=>s.lines=[],s=>s.lines[0].totalMinor=-1,s=>s.lines[0].totalMinor=1.2,s=>s.lines[0].unitMinor++,s=>s.lines[0].quantity=0,s=>s.lines[0].description='',s=>s.lines[0].kind='UNKNOWN',
  s=>s.dueOn='2027-02-29',s=>s.installments[0].dueOn='2028-03-02',s=>s.installments[0].amountMinor++,s=>s.installments.push({...s.installments[0]}),
  s=>s.lines[0]={kind:'TIME',description:'Work',totalMinor:101,source:{seconds:1,rateMinor:1}},s=>s.totalMinor=Number.MAX_SAFE_INTEGER+1
 ];
 for(const change of changes){const s=fixture();change(s);assert.throws(()=>allocate(s),e=>e===409,String(change));}
 for(const bad of [null,[],{},'snapshot'])assert.throws(()=>allocate(bad),e=>e===409);
 for(const change of [s=>s.installments.reverse(),s=>s.installments[0].amountMinor=0,s=>s.installments[1].amountMinor++,s=>s.installments[0].dueOn=s.dueOn,s=>s.installments[1].kind='FULL']){
  const s=fixture([101,202],1300,100);change(s);assert.throws(()=>allocate(s),e=>e===409);
 }
});
