// Synthetic offline source material only. No database, credentials or provider calls.
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {buildExclusions,EXPORT_FORMAT,EXPORT_FORMAT_VERSION} from '../../src/services/workspace-export.service.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp='2025-01-01T10:00:00-05:00';
const csv=(headers,rows)=>[headers,...rows].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
const posix=path=>path.split(sep).join('/');
async function inventory(root){const result=[];async function walk(dir){for(const entry of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else{const bytes=await readFile(path);result.push({path:posix(relative(root,path)),bytes:bytes.length,sha256:sha(bytes)});}}}await walk(root);return result;}

export async function makePilotFixture(parentDir){
 const root=await mkdtemp(join(parentDir,'pilot-source-'));for(const name of['notion','bonsai','legacy/data','legacy/files/attachments/legacy-attachment'])await mkdir(join(root,name),{recursive:true});
 await mkdir(join(root,'notion/Handbook'));
 const handbook='# Handbook — café\n\nLiteral "client" terms and Ελληνικά.\n\n- [x] Keep exact source bytes\n- [ ] Review permissions\n',onboarding='# Onboarding\n\nDo not render <script>literal</script> as HTML.\n\n1. Meet Bianca.\n2. Retain the original note.\n';
 await writeFile(join(root,'notion/Handbook.md'),handbook);await writeFile(join(root,'notion/Handbook/Onboarding.md'),onboarding);await writeFile(join(root,'notion/database.csv'),csv(['Name','Status'],[['Unsupported database row','Not imported']]));
 const bonsai={
  'clients.csv':[['Client','Contact Name','Contact Email','Phone Number','Website','Tags'],[['Fixture Co','Fixture Contact','contact@example.invalid','555-0100','https://example.invalid','synthetic']]],
  'addresses.csv':[['Client','Address 1','Address 2','City','Region','Postal Code','Country'],[['Fixture Co','1 Fixture Street','Suite "A"','Toronto','ON','M1M 1M1','Canada']]],
  'projects.csv':[['client_or_company_name','title','project_id','status','project_budget_amount','amount_paid','start_date','finish_date'],[['Fixture Co','Site','bonsai-project','active','1000','20','2025-01-01','']]],
  'invoices.csv':[['invoice_number','client_or_company_name','client_email','status','total_amount','calculated_tax_amount','calculated_tax_percent','paid_amount','currency','issued_date','due_date','paid_date','payment_method','contractor_invoice_link','contractor_project_name'],[['BON-CAD-1','Fixture Co','contact@example.invalid','sent','113','13','13','0','CAD','2025-01-01','2025-02-01','','','','Site'],['BON-USD-1','Fixture Co','contact@example.invalid','paid','20','0','0','20','USD','2025-01-01','2025-02-01','2025-01-02','BANK','','Site']]],
  'time-entries.csv':[['client_name','project_title','owner_name','date','formatted_time','rate','billing_status','notes'],[['Fixture Co','Site','Fixture Staff','2025-01-01','01:00:01','100','billed','Literal design "scope" — café']]],
  'expenses.csv':[['name','amount_after_tax','amount_pre_tax','currency','date','tags','billable','client','project'],[['Hosting','20','20','CAD','2025-01-01','software','false','Fixture Co','Site']]]
 };
 for(const[name,[headers,rows]]of Object.entries(bonsai))await writeFile(join(root,'bonsai',name),csv(headers,rows));
 const attachmentBytes=Buffer.from([0,255,13,10,67,97,102,195,169]),attachmentPath='files/attachments/legacy-attachment/original.bin';await writeFile(join(root,'legacy',attachmentPath),attachmentBytes);
 const base={organizationId:'legacy-org',createdAt:stamp,updatedAt:stamp,deletedAt:null},entities={
  clients:[{...base,id:'legacy-client',name:'Fixture Co',email:'contact@example.invalid'}],
  projects:[{...base,id:'legacy-project',clientId:'legacy-client',name:'Site',status:'ACTIVE'}],
  users:[{...base,id:'legacy-staff',name:'Fixture Staff',email:'staff@example.invalid',role:'TEAM',isActive:true}],
  tasks:[{...base,id:'legacy-task',projectId:'legacy-project',title:'Retained launch task',description:'Original task body',status:'PENDING',assigneeId:'legacy-staff',clientVisible:false}],
  notes:[{...base,id:'legacy-note',projectId:'legacy-project',authorId:'legacy-staff',title:'Private original note',content:'Private café note\n- [x] Original checklist',type:'NOTE',accessMode:'TEAM',accessRevision:0,accessGrants:[],audienceBarrier:null,parentId:null,revision:0}],
  time_entries:[{...base,id:'legacy-time',projectId:'legacy-project',userId:'legacy-staff',taskId:'legacy-task',description:'Historical design work',duration:61,hourlyRate:100,date:stamp,billable:true,invoiced:true,invoiceId:'legacy-invoice',reviewStatus:'APPROVED',reviewedById:'legacy-staff',reviewedAt:stamp,source:'MANUAL'}],
  invoices:[{...base,id:'legacy-invoice',clientId:'legacy-client',projectId:'legacy-project',invoiceNumber:'LEG-CAD-1',title:'Historical invoice',currency:'CAD',subtotal:100,tax:13,taxRate:13,taxType:'HST',discountAmount:0,total:113,status:'PAID',issueDate:stamp,dueDate:'2025-02-01T10:00:00-05:00',createdById:'legacy-staff',stripePaymentIntentId:null,stripeCheckoutSessionId:null}],
  invoice_payments:[{id:'legacy-payment',invoiceId:'legacy-invoice',amount:113,method:'BANK',transactionId:'historic-bank-reference',paidAt:stamp,createdAt:stamp}],
  attachments:[{...base,id:'legacy-attachment',filename:'original.bin',originalName:'Original café.bin',mimeType:'application/octet-stream',size:attachmentBytes.length,path:'/uploads/original.bin',entityType:'PROJECT',entityId:'legacy-project',uploadedById:'legacy-staff',clientVisible:false,checksumSha256:sha(attachmentBytes)}]
 };
 for(const[name,rows]of Object.entries(entities))await writeFile(join(root,'legacy/data',name+'.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 await writeFile(join(root,'legacy/README.md'),'# Synthetic workspace directory export\n\nOriginal rows and private attachment bytes; credentials excluded.\n');
 const mapping={version:1,target:{organizationId:'pilot-org',clientId:'canonical-client',projectId:'canonical-project'},sourceScope:{bonsai:{clientName:'Fixture Co',projectId:'bonsai-project',projectTitle:'Site'},legacy:{organizationId:'legacy-org',clientId:'legacy-client',projectId:'legacy-project'}},pins:{notion:[],bonsai:[],legacy:[]},legacyManifestSha256:'',legacyExclusionsSha256:'',actors:{'legacy:legacy-staff':'bianca','bonsai:Fixture Staff':'bianca'},authority:{client:'legacy:clients:legacy-client',project:'legacy:projects:legacy-project'},records:[]};
 const owners=new Map();
 function decision(key,file,canonicalId,{hold=null,time=false}={}){owners.set(key,file);mapping.records.push({key,fileSha256:'',canonicalId,clientVisible:false,authorActorId:'bianca',createdAt:stamp,updatedAt:stamp,...(time?{currency:'CAD'}:{}),disposition:hold?'HOLD':'MAP',...(hold?{reason:hold}:{})});}
 for(const path of['Handbook.md','Handbook/Onboarding.md','database.csv'])decision('notion:'+path,'notion/'+path,path==='database.csv'?'held-notion-database':path==='Handbook.md'?'notion-handbook':'notion-onboarding',{hold:path==='database.csv'?'Markdown export cannot establish database block semantics.':null});
 for(const[name,[,rows]]of Object.entries(bonsai))for(let i=0;i<rows.length;i++)decision('bonsai:'+name+':'+(i+2),'bonsai/'+name,name==='clients.csv'||name==='addresses.csv'?'canonical-client':name==='projects.csv'?'canonical-project':'bonsai-'+name.replace('.csv','')+'-'+i,{time:name==='time-entries.csv'});
 for(const[name,rows]of Object.entries(entities))for(const row of rows)decision('legacy:'+name+':'+row.id,'legacy/data/'+name+'.jsonl',name==='clients'?'canonical-client':name==='projects'?'canonical-project':'canonical-'+row.id,{hold:name==='users'?'Historical staff identity is provenance only; no account or grant is created.':null,time:name==='time_entries'});
 async function repin({decisions=false}={}){
  const descriptions=[];for(const name of Object.keys(entities)){const file='data/'+name+'.jsonl',bytes=await readFile(join(root,'legacy',file));descriptions.push({name,model:name,category:'synthetic',file,rows:bytes.toString('utf8').split('\n').filter(Boolean).length,bytes:bytes.length,sha256:sha(bytes)});}
  const bytes=await readFile(join(root,'legacy',attachmentPath)),files=[{source:'attachment',recordId:'legacy-attachment',exportPath:attachmentPath,originalName:'Original café.bin',mimeType:'application/octet-stream',size:bytes.length,sha256:sha(bytes),recordedSha256:sha(bytes)}],exclusions=buildExclusions();
  const manifest={format:EXPORT_FORMAT,formatVersion:EXPORT_FORMAT_VERSION,organization:{id:'legacy-org',name:'Synthetic legacy workspace'},organizationId:'legacy-org',generatedAt:stamp,generator:'synthetic-pilot-fixture',snapshot:'synthetic immutable directory',includeFiles:true,entities:descriptions,files,exclusions,exceptions:[],totals:{entities:descriptions.length,rows:descriptions.reduce((sum,row)=>sum+row.rows,0),files:files.length,fileBytes:bytes.length,exceptions:0}};
  await writeFile(join(root,'legacy/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const sums=[];for(const path of['README.md','manifest.json',...descriptions.map(v=>v.file),attachmentPath])sums.push(sha(await readFile(join(root,'legacy',path)))+'  '+path+'\n');await writeFile(join(root,'legacy/SHA256SUMS'),sums.join(''));
  for(const source of['notion','bonsai','legacy'])mapping.pins[source]=await inventory(join(root,source));mapping.legacyManifestSha256=sha(await readFile(join(root,'legacy/manifest.json')));mapping.legacyExclusionsSha256=sha(JSON.stringify(exclusions));
  if(decisions)for(const row of mapping.records)row.fileSha256=sha(await readFile(join(root,owners.get(row.key))));
  return mapping;
 }
 await repin({decisions:true});
 const expected={totals:{bonsai:{CAD:{invoiceTotalMinor:11300,invoicePaidMinor:0,invoiceTaxMinor:1300,invoiceSubtotalMinor:10000,expenseTotalMinor:2000},USD:{invoiceTotalMinor:2000,invoicePaidMinor:2000,invoiceTaxMinor:0,invoiceSubtotalMinor:2000,expenseTotalMinor:0}},legacy:{CAD:{invoiceTotalMinor:11300,invoicePaidMinor:11300,invoiceTaxMinor:1300,invoiceSubtotalMinor:10000}}},time:{bonsaiSeconds:3601,legacySeconds:3660,rateMinor:10000,currency:'CAD'},handbook,onboarding,attachmentBytes,attachmentSha256:sha(attachmentBytes),attachmentPath,legacyRows:entities,sourceIds:entities&&Object.fromEntries(Object.entries(entities).map(([name,rows])=>[name,rows.map(row=>row.id)])),recordCount:mapping.records.length,holdKeys:['notion:database.csv','legacy:users:legacy-staff']};
 return {root,mapping,expected,repin};
}
