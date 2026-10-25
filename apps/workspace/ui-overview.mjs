export const overviewUiScript=String.raw`
 let overviewPreferences,overviewFocusSerial=0;
 document.addEventListener('focusin',()=>++overviewFocusSerial);
 function denyOverview(state){
  if(!current(state))return;state.linkDenied=true;overviewPreferences=null;state.overviewInvalidate?.();main.removeAttribute('aria-busy');
  const reload=node('button','Reload Overview');reload.type='button';reload.onclick=()=>{if(reload.isConnected&&location.hash===state.routeKey)load(true);};
  main.replaceChildren(node('h1','Overview'),node('p','Access changed. Reload Overview to check your access.','notice'),reload);if(document.activeElement===document.body)reload.focus();
 }
 function overviewPage(state){
  const identity=actor.id+'/'+actor.role+'/'+Boolean(actor.features.finance);
  if(overviewPreferences?.identity!==identity)overviewPreferences={identity,values:{tasks:{},reviews:{},invoices:{}}};
  const preferences=overviewPreferences.values,controllers={},operations=[],wakeups=new Set();
  const changed=()=>{for(const wake of wakeups)wake();wakeups.clear();};
  state.overviewInvalidate=()=>{for(const op of operations){++op.epoch;op.pending=null;if(op.rows)op.rows=[];op.cursor=null;}changed();};
  const alive=()=>current(state)&&root.isConnected;
  const root=node('div');root.dataset.overview='';main.append(root);
  root.append(node('p','Your agency work, in one place.','muted'),node('p','Private pilot: use synthetic records until recovery and migration checks are complete.','notice'));
  const totals=node('section');totals.setAttribute('aria-label','Workspace totals');totals.append(node('h2','Workspace totals'));const stats=node('div',undefined,'stats');totals.append(stats);root.append(totals);
  function control(text,action){const b=node('button',text,'secondary');b.type='button';b.onclick=()=>{if(alive())action(b);};return b;}
  const denied=e=>[401,403].includes(e.status)||e.message==='Session ended. Sign out and sign in again.';
  const ownedFocus=(opener,serial,target)=>{if(opener&&alive()&&overviewFocusSerial===serial&&document.activeElement===document.body&&target?.isConnected&&!target.hidden&&!target.disabled)target.focus();};
  function options(select,entries,empty){const old=select.value;select.replaceChildren();for(const [value,label]of [['',empty],...entries]){const option=node('option',label);option.value=value;select.append(option);}select.value=[...select.options].some(o=>o.value===old)?old:'';return old!==select.value;}
  function updateMetadata(type,rows){
   for(const c of Object.values(controllers)){let changed=false;
    for(const [key,select]of Object.entries(c.selects)){if(type==='clients'&&key==='clientId')changed=options(select,rows.map(r=>[r.id,r.name]),'All clients')||changed;if(type==='projects'&&key==='projectId')changed=options(select,rows.map(r=>[r.id,r.name]),'All projects')||changed;if(type==='staff'&&key==='owner')changed=options(select,[['mine','Mine'],['unassigned','Unassigned'],...rows.map(r=>[r.id,r.name])],'All owners')||changed;}
    if(changed){for(const [key,select]of Object.entries(c.selects))c.values[key]=select.value;c.load(false);}
   }
  }
  async function counted(type,card,number,feedback,attempt){
   const epoch=++attempt.epoch,serial=overviewFocusSerial,opener=document.activeElement===attempt.retry?attempt.retry:null;attempt.retry=null;card.setAttribute('aria-busy','true');feedback.replaceChildren();number.textContent='Loading…';
   const valid=()=>alive()&&attempt.epoch===epoch;
   try{let rows=[],after='';for(let n=0;n<20;n++){const page=await api(type+(after?'?after='+encodeURIComponent(after):''));if(!valid())return;rows.push(...page.items);if(!page.nextCursor){number.textContent=String(rows.length);if(['clients','projects'].includes(type))updateMetadata(type,rows);return;}after=page.nextCursor;}throw Error('Count exceeds the pilot limit. Use the data export to review these records.');}
   catch(e){if(!valid())return;if(denied(e)){denyOverview(state);return;}number.textContent='Unavailable';error(e.message,feedback);const retry=control('Retry '+labels[type].toLowerCase()+' count',()=>attempt.run());attempt.retry=retry;feedback.append(retry);}
   finally{if(valid()){card.removeAttribute('aria-busy');attempt.pending=null;changed();ownedFocus(opener,serial,attempt.retry||refreshTotals);}}
  }
  const counters=[];
  const refreshTotals=control('Refresh totals',()=>{for(const counter of counters)counter.run();});totals.append(refreshTotals);
  for(const type of ['clients','projects','tasks','notes']){const card=node('div',undefined,'stat'),number=node('strong','Loading…'),feedback=node('div'),attempt={epoch:0};attempt.run=()=>{attempt.pending=counted(type,card,number,feedback,attempt);changed();return attempt.pending;};operations.push(attempt);counters.push(attempt);card.append(number,node('span',labels[type]),feedback);stats.append(card);attempt.run();}
  if(actor.role==='staff'){const exportButton=control('Download data export',async()=>{exportButton.disabled=true;try{const data=await api('export');if(!alive())return;const link=node('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.download='ashbi-workspace-export.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(e){if(alive()){if(denied(e))denyOverview(state);else error(e.message,totals);}}finally{if(alive())exportButton.disabled=false;}});totals.append(exportButton);}
  totals.append(node('p','The export contains application records; it is not a complete identity or file backup.','help'));
  function makeSection(kind,label,title,definitions){
   const panel=node('section',undefined,'panel');panel.setAttribute('aria-label',label);panel.append(node('h2',title));root.append(panel);
   if(kind!=='tasks'&&actor.role==='staff'&&!actor.features.finance){panel.append(node('p','Financial access is not available for this account.','notice'));return;}
   const filters=node('div',undefined,'task-toolbar'),summary=node('div'),feedback=node('div'),list=node('div'),footer=node('div',undefined,'row');
   const c={kind,panel,selects:{},values:preferences[kind],epoch:0,rows:[],cursor:null,pending:null};controllers[kind]=c;operations.push(c);
   for(const [key,label,entries]of definitions){const field=node('label',label),select=node('select');select.setAttribute('aria-label',label);for(const [value,text]of entries){const option=node('option',text);option.value=value;select.append(option);}if(c.values[key]&&!entries.some(e=>e[0]===c.values[key])){const prior=node('option','Previously selected (checking access)');prior.value=c.values[key];select.append(prior);}select.value=c.values[key]??entries[0][0];c.values[key]=select.value;select.onchange=()=>{if(!alive())return;c.values[key]=select.value;c.load(false);};field.append(select);filters.append(field);c.selects[key]=select;}
   c.refresh=control('Refresh '+kind,b=>c.load(false,b));c.more=control('Load more '+kind,b=>c.load(true,b));c.more.hidden=true;footer.append(c.refresh,c.more);panel.append(filters,summary,feedback,list,footer);
   if(kind==='reviews')panel.append(node('p','Review expiry is separate from task due dates. Individual owners are not recorded; team responsibility follows the latest review round.','help'));
   if(kind==='invoices')panel.append(node('p','Saved invoice observations may be out of date. Opening this page does not refresh Stripe. Totals cover all matching saved outstanding invoices, separately per currency.','help'));
   function draw(){
    list.replaceChildren();for(const row of c.rows){const item=node('article',undefined,'item');item.append(recordLink(kind,row.id,row.title,'Open '+({tasks:'task',reviews:'review',invoices:'invoice'}[kind])+' '+row.title));item.append(node('p',row.client.name+' · '+(row.project?.name||'No project')));
     if(kind==='tasks'){item.append(node('p','Status: '+({todo:'To do',doing:'Doing',done:'Done'}[row.status]||row.status)));item.append(node('p',row.owner.state==='UNASSIGNED'?'Owner: unassigned':row.owner.id+' · '+({ACTIVE:'Assigned owner',INACTIVE:'Inactive owner',UNAVAILABLE:'Owner unavailable'}[row.owner.state]||'Owner unknown')));item.append(node('p',row.dueOn?'Due (UTC): '+row.dueOn+(row.overdue?' · Overdue':''):'No due date'));}
     else if(kind==='reviews'){item.append(node('p','Status: '+row.state+' · '+row.nextAction),node('p','Individual owner: not recorded'+(row.responsibility?' · '+({CLIENT_TEAM:'Client team',STAFF_TEAM:'Staff team'}[row.responsibility]):'')),node('p','Published: '+new Date(row.createdAt).toLocaleString('en-CA')+' · Review expires: '+new Date(row.expiresAt).toLocaleString('en-CA')));if(!row.isLatest)item.append(node('p','Historical round','help'));}
     else {item.append(node('p','Status: open · Individual owner: not recorded'));for(const [label,key]of [['Original total','totalMinor'],['Amount due','dueMinor'],['Paid','paidMinor'],['Remaining','remainingMinor']])item.append(node('p',label+': '+invoiceMoney(row.currency,row[key])));item.append(node('p',row.dueAt===null?'No due date':'Due (UTC): '+new Date(row.dueAt*1000).toISOString().slice(0,10)+(row.overdue?' · Overdue':'')),node('p','Observed: '+(row.observedAt===null?'Unknown':new Date(row.observedAt).toLocaleString('en-CA'))+' · '+(invoiceSyncNames[row.syncState]||'Status not confirmed'),'notice'));}
     list.append(item);
    }if(!c.rows.length)list.append(node('p','No matching '+(kind==='invoices'?'outstanding invoices':kind)+'.'));
    c.more.hidden=!c.cursor;
   }
   c.load=(more=false,opener)=>{
    const epoch=++c.epoch,serial=overviewFocusSerial,returnFocus=opener&&document.activeElement===opener?opener:null,values={...c.values},cursor=more?c.cursor:null;
    const valid=()=>alive()&&c.epoch===epoch;
    panel.setAttribute('aria-busy','true');feedback.replaceChildren();c.retry=null;c.more.disabled=true;
    if(!more){c.rows=[];c.cursor=null;summary.replaceChildren();list.replaceChildren(node('p','Loading…'));c.more.hidden=true;}
    const query=new URLSearchParams();for(const [key,value]of Object.entries(values)){if(!value)continue;if(key==='owner')query.set(['mine','unassigned'].includes(value)?'owner':'ownerId',value);else query.set(key,value);}if(cursor)query.set('after',cursor);
    const work=(async()=>{try{
     const result=await api('dashboard/'+kind+(query.size?'?'+query:''));if(!valid())return;c.rows=more?[...c.rows,...result.items]:result.items;c.cursor=result.nextCursor;draw();summary.replaceChildren();
     if(kind==='invoices')for(const [currency,amounts]of Object.entries(result.currencies))summary.append(node('p','Remaining '+invoiceMoney(currency,amounts.remainingMinor)+' across '+amounts.invoiceCount+' outstanding invoice'+(amounts.invoiceCount===1?'':'s'),'notice'));
     if(c.cursor)summary.append(node('p','More matching records are available.','help'));
    }catch(e){if(!valid())return;if(denied(e)){denyOverview(state);return;}error(e.message,feedback);if(!more){list.replaceChildren(node('p','This source is unavailable. Retry to check current records.'));summary.replaceChildren();}else feedback.append(node('p','Previously loaded records may be out of date. Retry or refresh this source.','help'));c.retry=control('Retry '+kind,b=>c.load(more,b));feedback.append(c.retry);}
    finally{if(valid()){panel.removeAttribute('aria-busy');c.more.disabled=false;c.pending=null;changed();ownedFocus(returnFocus,serial,c.retry||(c.more.hidden?c.refresh:c.more));}}
    })();c.pending=work;changed();return work;
   };
   c.load();
  }
  makeSection('tasks','Daily tasks','Needs action',[
   ['owner','Task owner',[['','All owners'],['mine','Mine'],['unassigned','Unassigned']]],['clientId','Task client',[['','All clients']]],['projectId','Task project',[['','All projects']]],['status','Task status',[['open','Open work'],['todo','To do'],['doing','Doing'],['done','Done'],['all','All statuses']]],['due','Task due',[['all','Any date'],['overdue','Overdue'],['today','Due today'],['none','No due date']]]
  ]);
  makeSection('reviews','Proposal approvals','Proposal approvals',[
   ['clientId','Review client',[['','All clients']]],['projectId','Review project',[['','All projects']]],['state','Review state',[['attention','Needs attention'],['all','All rounds'],['OPEN','Open'],['CHANGES_REQUESTED','Changes requested'],['APPROVED','Approved'],['DECLINED','Declined'],['EXPIRED','Expired'],['STALE','Stale'],['REVOKED','Withdrawn'],['SUPERSEDED','Replaced']]]
  ]);
  makeSection('invoices','Outstanding invoices','Outstanding invoices',[
   ['clientId','Invoice client',[['','All clients']]],['projectId','Invoice project',[['','All projects']]],['currency','Invoice currency',[['','All currencies'],...['CAD','USD','EUR','GBP'].map(c=>[c,c])]],['due','Invoice due',[['all','Any date'],['overdue','Overdue']]]
  ]);
  if(actor.role==='staff'){
   const c=controllers.tasks,feedback=node('div'),op={epoch:0,pending:null};operations.push(op);c.panel.insertBefore(feedback,c.panel.children[2]);
   const readStaff=opener=>{const epoch=++op.epoch,serial=overviewFocusSerial,returnFocus=opener&&document.activeElement===opener?opener:null;feedback.replaceChildren();const valid=()=>alive()&&op.epoch===epoch;let retry;
    const work=(async()=>{try{const result=await api('staff');if(valid())updateMetadata('staff',result.items);}catch(e){if(!valid())return;if(denied(e)){denyOverview(state);return;}error('Owner options unavailable. '+e.message,feedback);retry=control('Retry owner options',b=>readStaff(b));feedback.append(retry);}finally{if(valid()){op.pending=null;changed();ownedFocus(returnFocus,serial,retry||c.selects.owner);}}})();op.pending=work;changed();return work;
   };readStaff();
  }
  state.overviewReady=(async()=>{while(alive()){const pending=operations.map(op=>op.pending).filter(Boolean);if(!pending.length)return;let wake;const nextChange=new Promise(resolve=>{wake=resolve;wakeups.add(wake);});await Promise.race([Promise.allSettled(pending),nextChange]);wakeups.delete(wake);}})();
 }
`;
