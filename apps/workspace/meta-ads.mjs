const CHECKLIST_KEYS = Object.freeze([
 'partner_access','facebook_page','instagram_account','ad_account','dataset_pixel',
 'client_billing','website_tracking','domain_and_privacy','lead_destination','test_enquiry'
]);
const currencies = new Set(['CAD','USD','EUR','GBP']);
const objectives = new Set(['leads','traffic','engagement','sales','awareness']);
const conversions = new Set(['instant_form','website','messages']);
const campaignStates = new Set(['draft','awaiting_approval','approved','entered_in_meta','paused','completed']);
const creativeFormats = new Set(['feed_portrait','feed_square','story_reel','carousel']);
const creativeStates = new Set(['draft','awaiting_approval','approved','changes_requested']);
const ctas = new Set(['get_quote','learn_more','send_message','sign_up','book_now']);
const leadStages = new Set(['new','contacted','qualified','estimate_booked','won','lost']);
const shortId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const text = (value,max,required=false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const integer = (value,min=0,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const isoDate = value => value === null || value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value);
const now = () => Date.now();
const id = () => crypto.randomUUID();
function requireStaff(actor){if(actor.role!=='staff')throw 403;}
function validTimezone(value){
 if(!text(value,64,true))return false;
 try{new Intl.DateTimeFormat('en-CA',{timeZone:value}).format(0);return true;}catch{return false;}
}
function parseJson(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
function accountView(row){
 if(!row)return row;
 return {...row,service_areas:parseJson(row.service_areas_json,[]),checklist:parseJson(row.checklist_json,{})};
}
function activityStatement(actor,clientId,entityType,entityId,action,detail={}){
 return {statement: 'INSERT INTO meta_ad_activity(id,organization_id,client_id,actor_id,entity_type,entity_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
 values:[id(),actor.organization_id,clientId,actor.id,entityType,entityId,action,JSON.stringify(detail),now()]};
}

function conditionalActivityStatement(actor,clientId,entityType,entityId,action,detail){
 const event=activityStatement(actor,clientId,entityType,entityId,action,detail);
 event.statement=event.statement.replace('VALUES(?,?,?,?,?,?,?,?,?)','SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1');
 return event;
}

async function clientExists(db,actor,clientId){
 if(!shortId(clientId))throw 400;
 if(actor.role==='client'&&actor.client_id!==clientId)throw 404;
 const row=await db.prepare('SELECT id,name FROM clients WHERE id=? AND organization_id=?').bind(clientId,actor.organization_id).first();
 if(!row)throw 404;
 return row;
}
async function accountFor(db,actor,clientId){
 await clientExists(db,actor,clientId);
 const row=await db.prepare('SELECT * FROM meta_ad_accounts WHERE organization_id=? AND client_id=?').bind(actor.organization_id,clientId).first();
 if(!row)throw 404;
 return row;
}
function checklist(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!CHECKLIST_KEYS.includes(k)))return false;
 return Object.values(value).every(v=>['pending','complete','blocked'].includes(v));
}
function validateAccount(input,partial=false){
 const fields={
  businessName:v=>text(v,200),businessPortfolioId:v=>text(v,100),ashbiBusinessId:v=>text(v,100),facebookPageName:v=>text(v,200),facebookPageId:v=>text(v,100),
  instagramHandle:v=>text(v,100),instagramAccountId:v=>text(v,100),adAccountId:v=>text(v,100),datasetId:v=>text(v,100),
  websiteUrl:v=>text(v,2048)&&(!v||(()=>{try{return new URL(v).protocol==='https:';}catch{return false;}})()),
  serviceAreas:v=>Array.isArray(v)&&v.length<=20&&v.every(x=>text(x,80,true)),
  currency:v=>currencies.has(v),timezone:validTimezone,
  partnerAccessStatus:v=>['not_requested','requested','granted','blocked'].includes(v),
  checklist:checklist,notes:v=>text(v,4000)
 };
 const map={businessName:'business_name',businessPortfolioId:'business_portfolio_id',ashbiBusinessId:'ashbi_business_id',facebookPageName:'facebook_page_name',facebookPageId:'facebook_page_id',instagramHandle:'instagram_handle',instagramAccountId:'instagram_account_id',adAccountId:'ad_account_id',datasetId:'dataset_id',websiteUrl:'website_url',currency:'currency',timezone:'timezone',partnerAccessStatus:'partner_access_status',notes:'notes'};
 for(const [key,valid] of Object.entries(fields)){
  if(!Object.hasOwn(input,key)){if(!partial&&['currency','timezone','partnerAccessStatus','serviceAreas','checklist','notes'].includes(key))continue;continue;}
  if(!valid(input[key]))throw 400;
 }
 if(!partial&&(!currencies.has(input.currency||'CAD')||!validTimezone(input.timezone||'America/Toronto')))throw 400;
 return Object.fromEntries(Object.keys(input).filter(k=>Object.hasOwn(fields,k)).map(k=>[map[k]||k,input[k]]));
}
function validateCampaign(input,partial=false){
 const fields={
  name:v=>text(v,200,true),objective:v=>objectives.has(v),conversionLocation:v=>conversions.has(v),
  dailyBudgetMinor:v=>integer(v,0,100000000),currency:v=>currencies.has(v),serviceArea:v=>text(v,300),
  startDate:isoDate,endDate:isoDate,status:v=>campaignStates.has(v),clientVisible:v=>typeof v==='boolean',notes:v=>text(v,4000)
 };
 const map={conversionLocation:'conversion_location',dailyBudgetMinor:'daily_budget_minor',serviceArea:'service_area',startDate:'start_date',endDate:'end_date',clientVisible:'client_visible'};
 for(const [key,valid] of Object.entries(fields))if(Object.hasOwn(input,key)&&!valid(input[key]))throw 400;
 if(!partial)for(const key of ['name','objective','conversionLocation','dailyBudgetMinor','currency'])if(!Object.hasOwn(input,key))throw 400;
 if(input.startDate&&input.endDate&&input.endDate<input.startDate)throw 400;
 return Object.fromEntries(Object.keys(input).filter(k=>Object.hasOwn(fields,k)).map(k=>[map[k]||k,input[k]]));
}
function validateCreative(input,partial=false){
 const fields={
  name:v=>text(v,200,true),format:v=>creativeFormats.has(v),primaryText:v=>text(v,5000),headline:v=>text(v,255),
  description:v=>text(v,500),cta:v=>ctas.has(v),assetReference:v=>text(v,2048),
  status:v=>creativeStates.has(v),clientVisible:v=>typeof v==='boolean'
 };
 const map={primaryText:'primary_text',assetReference:'asset_reference',clientVisible:'client_visible'};
 for(const [key,valid] of Object.entries(fields))if(Object.hasOwn(input,key)&&!valid(input[key]))throw 400;
 if(!partial)for(const key of ['name','format'])if(!Object.hasOwn(input,key))throw 400;
 return Object.fromEntries(Object.keys(input).filter(k=>Object.hasOwn(fields,k)).map(k=>[map[k]||k,input[k]]));
}
function validateLead(input,partial=false){
 const fields={
  fullName:v=>text(v,160,true),email:v=>text(v,254)&&(!v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  phone:v=>text(v,40),city:v=>text(v,120),service:v=>text(v,160),stage:v=>leadStages.has(v),
  followUpOn:isoDate,clientVisible:v=>typeof v==='boolean',internalNotes:v=>text(v,2000),campaignId:v=>v===null||v===''||shortId(v)
 };
 const map={fullName:'full_name',followUpOn:'follow_up_on',clientVisible:'client_visible',internalNotes:'internal_notes',campaignId:'campaign_id'};
 for(const [key,valid] of Object.entries(fields))if(Object.hasOwn(input,key)&&!valid(input[key]))throw 400;
 if(!partial){if(!Object.hasOwn(input,'fullName')||(!input.email&&!input.phone))throw 400;}
 if(Object.hasOwn(input,'email')&&Object.hasOwn(input,'phone')&&!input.email&&!input.phone)throw 400;
 return Object.fromEntries(Object.keys(input).filter(k=>Object.hasOwn(fields,k)).map(k=>[map[k]||k,input[k]]));
}
function validateReport(input){
 const fields={
  reportDate:isoDate,spendMinor:v=>integer(v),revenueMinor:v=>integer(v),currency:v=>currencies.has(v),
  impressions:v=>integer(v),reach:v=>integer(v),clicks:v=>integer(v),leads:v=>integer(v),
  qualifiedLeads:v=>integer(v),estimatesBooked:v=>integer(v),jobsWon:v=>integer(v),
  clientVisible:v=>typeof v==='boolean',notes:v=>text(v,2000),campaignId:shortId
 };
 const required=['reportDate','spendMinor','revenueMinor','currency','impressions','reach','clicks','leads','qualifiedLeads','estimatesBooked','jobsWon','campaignId'];
 for(const key of required)if(!Object.hasOwn(input,key)||!fields[key](input[key]))throw 400;
 for(const key of Object.keys(fields))if(Object.hasOwn(input,key)&&!fields[key](input[key]))throw 400;
 const map={reportDate:'report_date',spendMinor:'spend_minor',revenueMinor:'revenue_minor',qualifiedLeads:'qualified_leads',estimatesBooked:'estimates_booked',jobsWon:'jobs_won',clientVisible:'client_visible'};
 return Object.fromEntries(Object.keys(input).filter(k=>Object.hasOwn(fields,k)&&k!=='campaignId').map(k=>[map[k]||k,input[k]]));
}
function safeLead(row,actor){
 if(actor.role==='staff')return row;
 const {internal_notes,...visible}=row;return visible;
}
export async function metaAdsRoute(request,db,actor,readBody,json){
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/meta-ads\/?/,'').split('/').filter(Boolean),method=request.method;
 if(url.searchParams.getAll('clientId').length>1)throw 400;
 if(path.length===0){
  if(method==='GET'){
   const rows=actor.role==='staff'
    ?(await db.prepare('SELECT a.*,c.name AS client_name FROM meta_ad_accounts a JOIN clients c ON c.id=a.client_id AND c.organization_id=a.organization_id WHERE a.organization_id=? ORDER BY a.updated_at DESC LIMIT 100').bind(actor.organization_id).all()).results
    :(await db.prepare('SELECT a.*,c.name AS client_name FROM meta_ad_accounts a JOIN clients c ON c.id=a.client_id AND c.organization_id=a.organization_id WHERE a.organization_id=? AND a.client_id=? ORDER BY a.updated_at DESC LIMIT 10').bind(actor.organization_id,actor.client_id).all()).results;
   return json({items:rows.map(accountView)});
  }
  if(method==='POST'){
   requireStaff(actor);const input=await readBody(request),client=await clientExists(db,actor,input.clientId);
   const body=validateAccount(input);
   const timestamp=now(),accountId=id(),checklistJson=JSON.stringify(input.checklist||{});
   const columns=['business_name','business_portfolio_id','ashbi_business_id','facebook_page_name','facebook_page_id','instagram_handle','instagram_account_id','ad_account_id','dataset_id','website_url','service_areas_json','currency','timezone','partner_access_status','checklist_json','notes'];
   const values=[body.business_name||'',body.business_portfolio_id||'',body.ashbi_business_id||'',body.facebook_page_name||'',body.facebook_page_id||'',body.instagram_handle||'',body.instagram_account_id||'',body.ad_account_id||'',body.dataset_id||'',body.website_url||'',JSON.stringify(input.serviceAreas||[]),body.currency||'CAD',body.timezone||'America/Toronto',body.partner_access_status||'not_requested',checklistJson,body.notes||''];
   const activity=activityStatement(actor,client.id,'account',accountId,'created',{});
   const statements=[
    db.prepare('INSERT INTO meta_ad_accounts(id,organization_id,client_id,'+columns.join(',')+',revision,created_by,created_at,updated_at) VALUES('+Array(23).fill('?').join(',')+')').bind(accountId,actor.organization_id,client.id,...values,0,actor.id,timestamp,timestamp),
    db.prepare(activity.statement).bind(...activity.values)
   ];
   await db.batch(statements);
   const row=await db.prepare('SELECT * FROM meta_ad_accounts WHERE id=? AND organization_id=?').bind(accountId,actor.organization_id).first();
   return json(accountView(row),201);
  }
  throw 405;
 }
 if(path.length===1&&shortId(path[0])){
  const clientId=path[0];
  if(method==='GET'){const row=await accountFor(db,actor,clientId);const client=await clientExists(db,actor,clientId);return json({...accountView(row),client_name:client.name});}
  if(method==='PATCH'){
   requireStaff(actor);await clientExists(db,actor,clientId);const input=await readBody(request);
   if(!integer(input.revision))throw 400;
   const body=validateAccount(input,true);delete body.client_id;
   if(!Object.keys(body).length)throw 400;
   if('serviceAreas' in body){body.service_areas_json=JSON.stringify(body.serviceAreas);delete body.serviceAreas;}
   if('checklist' in body){body.checklist_json=JSON.stringify(body.checklist);delete body.checklist;}
   const current=await accountFor(db,actor,clientId);
   if(body.currency&&body.currency!==current.currency){const existing=await db.prepare('SELECT COUNT(*) AS n FROM meta_ad_campaigns WHERE organization_id=? AND client_id=?').bind(actor.organization_id,clientId).first();if(existing.n>0)throw 400;}
   const keys=Object.keys(body),columns=keys.map(k=>k);
   const statement=db.prepare('UPDATE meta_ad_accounts SET '+columns.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE organization_id=? AND client_id=? AND revision=?')
    .bind(...columns.map(k=>body[k]),now(),actor.organization_id,clientId,input.revision);
   const activity=conditionalActivityStatement(actor,clientId,'account',current.id,'updated',{fields:columns});
   const results=await db.batch([statement,db.prepare(activity.statement).bind(...activity.values)]);
   if(results[0].meta.changes!==1)throw 409;
   return json(accountView(await accountFor(db,actor,clientId)));
  }
  throw 405;
 }
 if(path.length===2&&shortId(path[0])&&path[1]==='campaigns'){
  const clientId=path[0];await accountFor(db,actor,clientId);
  if(method==='GET'){
   const rows=actor.role==='staff'
    ?(await db.prepare('SELECT * FROM meta_ad_campaigns WHERE organization_id=? AND client_id=? ORDER BY updated_at DESC LIMIT 100').bind(actor.organization_id,clientId).all()).results
    :(await db.prepare('SELECT * FROM meta_ad_campaigns WHERE organization_id=? AND client_id=? AND client_visible=1 ORDER BY updated_at DESC LIMIT 100').bind(actor.organization_id,clientId).all()).results;
   return json({items:rows});
  }
  if(method==='POST'){
   requireStaff(actor);const input=await readBody(request),body=validateCampaign(input);
   const account=await accountFor(db,actor,clientId);if(body.currency!==account.currency||body.status==='awaiting_approval'&&!body.client_visible)throw 400;
   const timestamp=now(),recordId=id(),columns=Object.keys(body).map(k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()));
   const values=Object.values(body).map(v=>typeof v==='boolean'?Number(v):v);
   const activity=activityStatement(actor,clientId,'campaign',recordId,'created',{name:body.name});
   await db.batch([
    db.prepare('INSERT INTO meta_ad_campaigns(id,organization_id,client_id,'+columns.join(',')+',created_by,created_at,updated_at) VALUES('+Array(values.length+6).fill('?').join(',')+')').bind(recordId,actor.organization_id,clientId,...values,actor.id,timestamp,timestamp),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   return json(await db.prepare('SELECT * FROM meta_ad_campaigns WHERE id=? AND organization_id=?').bind(recordId,actor.organization_id).first(),201);
  }
  throw 405;
 }
 const campaignPath=path[0]==='campaigns'&&shortId(path[1]);
 if(campaignPath&&path.length===2){
  const campaign=await db.prepare('SELECT * FROM meta_ad_campaigns WHERE id=? AND organization_id=?').bind(path[1],actor.organization_id).first();
  if(!campaign||actor.role==='client'&&(campaign.client_id!==actor.client_id||!campaign.client_visible))throw 404;
  if(method==='PATCH'){
   requireStaff(actor);const input=await readBody(request);if(!integer(input.revision))throw 400;
   const body=validateCampaign(input,true);delete body.client_id;if(!Object.keys(body).length)throw 400;
   if(body.status==='awaiting_approval'&&!(Object.hasOwn(body,'client_visible')?body.client_visible:Boolean(campaign.client_visible)))throw 400;
   const columns=Object.fromEntries(Object.keys(body).map(k=>[k,k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase())]));
   if(body.currency&&body.currency!==campaign.currency)throw 400;
   const sets=Object.keys(body).map(k=>columns[k]+'=?');
   const activity=conditionalActivityStatement(actor,campaign.client_id,'campaign',campaign.id,'updated',{fields:Object.keys(body)});
   const results=await db.batch([
    db.prepare('UPDATE meta_ad_campaigns SET '+sets.join(',')+',revision=revision+1,updated_at=? WHERE organization_id=? AND id=? AND revision=?').bind(...Object.keys(body).map(k=>typeof body[k]==='boolean'?Number(body[k]):body[k]),now(),actor.organization_id,campaign.id,input.revision),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   if(results[0].meta.changes!==1)throw 409;
   return json(await db.prepare('SELECT * FROM meta_ad_campaigns WHERE id=? AND organization_id=?').bind(campaign.id,actor.organization_id).first());
  }
  if(method==='GET')return json(campaign);
  throw 405;
 }
 if(path[0]==='campaigns'&&shortId(path[1])&&path[2]==='creatives'&&path.length===3){
  const campaign=await db.prepare('SELECT * FROM meta_ad_campaigns WHERE id=? AND organization_id=?').bind(path[1],actor.organization_id).first();
  if(!campaign||actor.role==='client'&&campaign.client_id!==actor.client_id||actor.role==='client'&&!campaign.client_visible)throw 404;
  if(method==='GET'){
   const rows=actor.role==='staff'
    ?(await db.prepare('SELECT * FROM meta_ad_creatives WHERE organization_id=? AND client_id=? AND campaign_id=? ORDER BY updated_at DESC LIMIT 100').bind(actor.organization_id,campaign.client_id,campaign.id).all()).results
    :(await db.prepare('SELECT * FROM meta_ad_creatives WHERE organization_id=? AND client_id=? AND campaign_id=? AND client_visible=1 ORDER BY updated_at DESC LIMIT 100').bind(actor.organization_id,campaign.client_id,campaign.id).all()).results;
   return json({items:rows});
  }
  if(method==='POST'){
   requireStaff(actor);const input=await readBody(request),body=validateCreative(input);
   if(body.client_visible&&!campaign.client_visible)throw 400;
   const timestamp=now(),recordId=id(),columns=Object.keys(body).map(k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()));
   const values=Object.values(body).map(v=>typeof v==='boolean'?Number(v):v);
   if(body.status==='awaiting_approval'&&!body.client_visible)throw 400;
   const activity=activityStatement(actor,campaign.client_id,'creative',recordId,'created',{name:body.name});
   await db.batch([
    db.prepare('INSERT INTO meta_ad_creatives(id,organization_id,client_id,campaign_id,'+columns.join(',')+',created_by,created_at,updated_at) VALUES('+Array(values.length+7).fill('?').join(',')+')').bind(recordId,actor.organization_id,campaign.client_id,campaign.id,...values,actor.id,timestamp,timestamp),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   return json(await db.prepare('SELECT * FROM meta_ad_creatives WHERE id=? AND organization_id=?').bind(recordId,actor.organization_id).first(),201);
  }
  throw 405;
 }
 if(path[0]==='creatives'&&shortId(path[1])&&path.length===2){
  const creative=await db.prepare('SELECT * FROM meta_ad_creatives WHERE id=? AND organization_id=?').bind(path[1],actor.organization_id).first();
  if(!creative||actor.role==='client'&&creative.client_id!==actor.client_id)throw 404;
  if(method==='PATCH'){
   requireStaff(actor);const input=await readBody(request);if(!integer(input.revision))throw 400;
   const body=validateCreative(input,true);if(!Object.keys(body).length)throw 400;
   if(body.client_visible){const parent=await db.prepare('SELECT client_visible FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(creative.campaign_id,actor.organization_id,creative.client_id).first();if(!parent||!parent.client_visible)throw 400;}
   const columns=Object.keys(body).map(k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()));
   if(body.status==='awaiting_approval'&&!(Object.hasOwn(body,'client_visible')?body.client_visible:Boolean(creative.client_visible)))throw 400;
   const activity=conditionalActivityStatement(actor,creative.client_id,'creative',creative.id,'updated',{fields:Object.keys(body)});
   const results=await db.batch([
    db.prepare('UPDATE meta_ad_creatives SET '+columns.map(k=>k+'=?').join(',')+',reviewed_by=NULL,reviewed_at=NULL,revision=revision+1,updated_at=? WHERE organization_id=? AND id=? AND revision=?').bind(...Object.values(body).map(v=>typeof v==='boolean'?Number(v):v),now(),actor.organization_id,creative.id,input.revision),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   if(results[0].meta.changes!==1)throw 409;
   return json(await db.prepare('SELECT * FROM meta_ad_creatives WHERE id=? AND organization_id=?').bind(creative.id,actor.organization_id).first());
  }
  if(method==='GET'){if(actor.role==='client'){const parent=await db.prepare('SELECT client_visible FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(creative.campaign_id,actor.organization_id,actor.client_id).first();if(!creative.client_visible||!parent||!parent.client_visible)throw 404;}return json(creative);}
  throw 405;
 }
 if(path[0]==='creatives'&&shortId(path[1])&&path[2]==='decision'&&path.length===3&&method==='POST'){
  if(actor.role!=='client')throw 403;
  const input=await readBody(request);if(!['approved','changes_requested'].includes(input.decision)||!text(input.feedback||'',2000))throw 400;
  const creative=await db.prepare('SELECT * FROM meta_ad_creatives WHERE id=? AND organization_id=? AND client_id=? AND client_visible=1').bind(path[1],actor.organization_id,actor.client_id).first();
  if(!creative||creative.status!=='awaiting_approval')throw 404;
  const parent=await db.prepare('SELECT client_visible FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(creative.campaign_id,actor.organization_id,actor.client_id).first();if(!parent||!parent.client_visible)throw 404;
  const timestamp=now(),approvalId=id(),newRevision=creative.revision+1;
  const approval=db.prepare('INSERT INTO meta_ad_approvals(id,organization_id,client_id,creative_id,actor_id,decision,feedback,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(approvalId,actor.organization_id,actor.client_id,creative.id,actor.id,input.decision,input.feedback||'',timestamp);
  const update=db.prepare('UPDATE meta_ad_creatives SET status=?,reviewed_by=?,reviewed_at=?,revision=revision+1,updated_at=? WHERE id=? AND organization_id=? AND client_id=? AND revision=? AND status=? AND client_visible=1')
   .bind(input.decision,actor.id,timestamp,timestamp,creative.id,actor.organization_id,actor.client_id,creative.revision,'awaiting_approval');
  const activity=conditionalActivityStatement(actor,actor.client_id,'creative',creative.id,input.decision,{revision:newRevision,feedback:input.feedback||''});
  const results=await db.batch([update,approval,db.prepare(activity.statement).bind(...activity.values)]);
  if(results[0].meta.changes!==1)throw 409;
  return json(await db.prepare('SELECT * FROM meta_ad_creatives WHERE id=? AND organization_id=?').bind(creative.id,actor.organization_id).first());
 }
 if(path.length===2&&shortId(path[0])&&path[1]==='leads'){
  const clientId=path[0];await accountFor(db,actor,clientId);
  if(method==='GET'){
   const rows=actor.role==='staff'
    ?(await db.prepare('SELECT * FROM meta_ad_leads WHERE organization_id=? AND client_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(actor.organization_id,clientId).all()).results
    :(await db.prepare('SELECT id,organization_id,client_id,campaign_id,full_name,email,phone,city,service,stage,follow_up_on,client_visible,created_at,updated_at FROM meta_ad_leads WHERE organization_id=? AND client_id=? AND client_visible=1 ORDER BY created_at DESC,id DESC LIMIT 100').bind(actor.organization_id,clientId).all()).results;
   return json({items:rows.map(row=>safeLead(row,actor))});
  }
  if(method==='POST'){
   requireStaff(actor);const input=await readBody(request),body=validateLead(input);
   if(body.campaign_id){const campaign=await db.prepare('SELECT id FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(body.campaign_id,actor.organization_id,clientId).first();if(!campaign)throw 404;}
   const timestamp=now(),recordId=id(),columns=Object.keys(body),values=Object.values(body).map(v=>typeof v==='boolean'?Number(v):v);
   const activity=activityStatement(actor,clientId,'lead',recordId,'created',{stage:body.stage||'new'});
   await db.batch([
    db.prepare('INSERT INTO meta_ad_leads(id,organization_id,client_id,'+columns.join(',')+',created_by,created_at,updated_at) VALUES('+Array(values.length+6).fill('?').join(',')+')').bind(recordId,actor.organization_id,clientId,...values,actor.id,timestamp,timestamp),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   const row=await db.prepare('SELECT * FROM meta_ad_leads WHERE id=? AND organization_id=?').bind(recordId,actor.organization_id).first();
   return json(safeLead(row,actor),201);
  }
  throw 405;
 }
 if(path[0]==='leads'&&shortId(path[1])&&path.length===2){
  const lead=await db.prepare('SELECT * FROM meta_ad_leads WHERE id=? AND organization_id=?').bind(path[1],actor.organization_id).first();
  if(!lead||actor.role==='client'&&lead.client_id!==actor.client_id)throw 404;
  if(method==='PATCH'){
   requireStaff(actor);const input=await readBody(request);if(!integer(input.revision))throw 400;
   const body=validateLead(input,true);if(!Object.keys(body).length)throw 400;
   const columns=Object.keys(body).map(k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()));
   if(body.campaign_id){const campaign=await db.prepare('SELECT id FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(body.campaign_id,actor.organization_id,lead.client_id).first();if(!campaign)throw 404;}
   const activity=conditionalActivityStatement(actor,lead.client_id,'lead',lead.id,'updated',{fields:Object.keys(body)});
   const results=await db.batch([
    db.prepare('UPDATE meta_ad_leads SET '+columns.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE organization_id=? AND id=? AND revision=?').bind(...Object.values(body).map(v=>typeof v==='boolean'?Number(v):v),now(),actor.organization_id,lead.id,input.revision),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   if(results[0].meta.changes!==1)throw 409;
   return json(safeLead(await db.prepare('SELECT * FROM meta_ad_leads WHERE id=? AND organization_id=?').bind(lead.id,actor.organization_id).first(),actor));
  }
  if(method==='GET')return actor.role==='staff'||lead.client_visible?json(safeLead(lead,actor)):json({error:'Not found'},404);
  throw 405;
 }
 if(path.length===2&&shortId(path[0])&&path[1]==='reports'){
  const clientId=path[0];await accountFor(db,actor,clientId);
  if(method==='GET'){
   const rows=actor.role==='staff'
    ?(await db.prepare('SELECT * FROM meta_ad_reports WHERE organization_id=? AND client_id=? ORDER BY report_date DESC,id DESC LIMIT 180').bind(actor.organization_id,clientId).all()).results
    :(await db.prepare('SELECT * FROM meta_ad_reports WHERE organization_id=? AND client_id=? AND client_visible=1 ORDER BY report_date DESC,id DESC LIMIT 180').bind(actor.organization_id,clientId).all()).results;
   return json({items:rows});
  }
  if(method==='POST'){
   requireStaff(actor);const input=await readBody(request),body=validateReport(input);
   const campaign=await db.prepare('SELECT currency FROM meta_ad_campaigns WHERE id=? AND organization_id=? AND client_id=?').bind(input.campaignId,actor.organization_id,clientId).first();
   if(!campaign||body.currency!==campaign.currency)throw 400;
   const timestamp=now(),recordId=id(),columns=Object.keys(body).map(k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()));
   const values=Object.values(body).map(v=>typeof v==='boolean'?Number(v):v);
   const activity=activityStatement(actor,clientId,'report',recordId,'created',{reportDate:body.report_date});
   await db.batch([
    db.prepare('INSERT INTO meta_ad_reports(id,organization_id,client_id,campaign_id,'+columns.join(',')+',created_by,created_at) VALUES('+Array(values.length+6).fill('?').join(',')+')').bind(recordId,actor.organization_id,clientId,input.campaignId,...values,actor.id,timestamp),
    db.prepare(activity.statement).bind(...activity.values)
   ]);
   return json(await db.prepare('SELECT * FROM meta_ad_reports WHERE id=? AND organization_id=?').bind(recordId,actor.organization_id).first(),201);
  }
  throw 405;
 }
 if(path.length===2&&shortId(path[0])&&path[1]==='activity'&&method==='GET'){
  requireStaff(actor);const clientId=path[0];await accountFor(db,actor,clientId);
  const rows=await db.prepare('SELECT id,entity_type,entity_id,action,detail_json,created_at FROM meta_ad_activity WHERE organization_id=? AND client_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(actor.organization_id,clientId).all();
  return json({items:rows.results.map(row=>({...row,detail:parseJson(row.detail_json,{})}))});
 }
 throw 404;
}
