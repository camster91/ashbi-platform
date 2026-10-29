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
  const preferences=overviewPreferences.values,controllers={},panels={},staffNames=new Map(),operations=[],wakeups=new Set();
  const changed=()=>{for(const wake of wakeups)wake();wakeups.clear();};
  state.overviewInvalidate=()=>{for(const op of operations){++op.epoch;op.pending=null;if(op.rows)op.rows=[];op.cursor=null;}changed();};
  const alive=()=>current(state)&&root.isConnected;
  const root=node('div');root.dataset.overview='';main.append(root);
  const viewBar=node('div',undefined,'view-tabs');viewBar.setAttribute('role','group');viewBar.setAttribute('aria-label','Overview views');root.append(viewBar);let selectedView=overviewPreferences.view||'tasks';
  const shortcuts=node('section',undefined,'overview-shortcuts');shortcuts.setAttribute('aria-label','Daily priorities');const priorityActions=node('div',undefined,'priority-actions');shortcuts.append(priorityActions);root.append(shortcuts);
  const totals=node('section');totals.setAttribute('aria-label','Workspace totals');totals.append(node('h2','Workspace totals'));const stats=node('div',undefined,'stats');totals.append(stats);root.append(totals);
  function control(text,action){const b=node('button',text,'secondary');b.type='button';b.onclick=()=>{if(alive())action(b);};return b;}
  const denied=e=>[401,403].includes(e.status)||e.message==='Session ended. Sign out and sign in again.';
  const ownedFocus=(opener,serial,target)=>{if(opener&&alive()&&overviewFocusSerial===serial&&document.activeElement===document.body&&target?.isConnected&&!target.hidden&&!target.disabled)target.focus();};
  function options(select,entries,empty){const old=select.value;select.replaceChildren();for(const [value,label]of [['',empty],...entries]){const option=node('option',label);option.value=value;select.append(option);}select.value=[...select.options].some(o=>o.value===old)?old:'';return old!==select.value;}
  function updateMetadata(type,rows){
   if(type==='staff'){for(const row of rows)staffNames.set(row.id,row.name);controllers.tasks?.draw?.();}
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
  for(const type of ['clients','projects','tasks','notes']){const card=node('div',undefined,'stat'),number=node('strong','Loading…'),feedback=node('div'),attempt={epoch:0};attempt.run=()=>{attempt.started=true;attempt.pending=counted(type,card,number,feedback,attempt);changed();return attempt.pending;};operations.push(attempt);counters.push(attempt);card.append(number,node('span',labels[type]),feedback);stats.append(card);if(['clients','projects'].includes(type))attempt.run();}
  if(actor.role==='staff'){const exportButton=control('Download data export',async()=>{exportButton.disabled=true;try{const data=await api('export');if(!alive())return;const link=node('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.download='ashbi-workspace-export.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(e){if(alive()){if(denied(e))denyOverview(state);else error(e.message,totals);}}finally{if(alive())exportButton.disabled=false;}});totals.append(exportButton);}
  totals.append(node('p','The export contains application records; it is not a complete identity or file backup.','help'));
  function makeSection(kind,label,title,definitions){
   const panel=node('section',undefined,'panel');panels[kind]=panel;panel.setAttribute('aria-label',label);panel.append(node('h2',title));root.append(panel);
   if(kind!=='tasks'&&actor.role==='staff'&&!actor.features.finance){panel.append(node('p','Financial access is not available for this account.','notice'));return;}
   const filters=node('div',undefined,'task-toolbar'),summary=node('div'),feedback=node('div'),list=node('div'),footer=node('div',undefined,'row');
   panel.classList.add('overview-feed');const c={kind,panel,selects:{},defaults:Object.fromEntries(definitions.map(([key,,entries])=>[key,entries[0][0]])),values:preferences[kind],epoch:0,rows:[],cursor:null,pending:null};controllers[kind]=c;operations.push(c);
   for(const [key,label,entries]of definitions){const field=node('label',label),select=node('select');select.setAttribute('aria-label',label);for(const [value,text]of entries){const option=node('option',text);option.value=value;select.append(option);}if(c.values[key]&&!entries.some(e=>e[0]===c.values[key])){const prior=node('option','Previously selected (checking access)');prior.value=c.values[key];select.append(prior);}select.value=c.values[key]??entries[0][0];c.values[key]=select.value;select.onchange=()=>{if(!alive())return;c.values[key]=select.value;c.load(false);};field.append(select);filters.append(field);c.selects[key]=select;}
   c.refresh=control('Refresh '+kind,b=>c.load(false,b));c.more=control('Load more '+kind,b=>c.load(true,b));c.more.hidden=true;footer.append(c.refresh,c.more);panel.append(filters,summary,feedback,list,footer);
   if(kind==='reviews')panel.append(node('p','Review expiry is separate from task due dates. Individual owners are not recorded; team responsibility follows the latest review round.','help'));
   if(kind==='invoices')panel.append(node('p','Saved invoice observations may be out of date. Opening this page does not refresh Stripe. Totals cover all matching saved outstanding invoices, separately per currency.','help'));
   function draw(){
    list.replaceChildren();for(const row of c.rows){const item=node('article',undefined,'item overview-record'),part=kind==='invoices'&&row.source?.kind==='invoice-parts',partName=part?({DEPOSIT:'Deposit',BALANCE:'Balance'}[row.source.partKind]||'Installment'):null;item.append(kind==='invoices'?recordSourceLink(row.source,row.title+(part?' · '+partName:''),'Open '+(part?partName.toLowerCase()+' invoice':'invoice')+' '+row.title):recordLink(kind,row.id,row.title,'Open '+({tasks:'task',reviews:'review'}[kind])+' '+row.title));if(part)item.append(node('p',partName+' invoice','help'));item.append(node('p',row.client.name+' · '+(row.project?.name||'No project')));
     if(kind==='tasks'){item.append(node('p','Status: '+recordStatusName('tasks',row.status)));item.append(node('p',row.owner.state==='UNASSIGNED'?'Owner: unassigned':(row.owner.id===actor.id?'You':staffNames.get(row.owner.id)||'Team member')+' · '+({ACTIVE:'Assigned owner',INACTIVE:'Inactive owner',UNAVAILABLE:'Owner unavailable'}[row.owner.state]||'Owner unknown')));item.append(node('p',row.dueOn?'Due (UTC): '+row.dueOn+(row.overdue?' · Overdue':''):'No due date'));}
     else if(kind==='reviews'){item.append(node('p','Status: '+row.state+' · '+row.nextAction),node('p','Individual owner: not recorded'+(row.responsibility?' · '+({CLIENT_TEAM:'Client team',STAFF_TEAM:'Staff team'}[row.responsibility]):'')),node('p','Published: '+new Date(row.createdAt).toLocaleString('en-CA')+' · Review expires: '+new Date(row.expiresAt).toLocaleString('en-CA')));if(!row.isLatest)item.append(node('p','Historical round','help'));}
     else {item.append(node('p','Status: open · Individual owner: not recorded'));for(const [label,key]of [['Original total','totalMinor'],['Amount due','dueMinor'],['Paid','paidMinor'],['Remaining','remainingMinor']])item.append(node('p',label+': '+invoiceMoney(row.currency,row[key])));item.append(node('p',row.dueAt===null?'No due date':'Due (UTC): '+new Date(row.dueAt*1000).toISOString().slice(0,10)+(row.overdue?' · Overdue':'')),node('p','Observed: '+(row.observedAt===null?'Unknown':new Date(row.observedAt).toLocaleString('en-CA'))+' · '+(invoiceSyncNames[row.syncState]||'Status not confirmed'),'notice'));}
     const context=node('div',undefined,'overview-record-context');if(row.project)context.append(recordRouteLink(projectHref(row.project.id),'Open project','Open project '+row.project.name));context.append(node('span',kind==='tasks'?(row.overdue?'Overdue · open task to update':row.dueOn?'Review task and next step':'Set a due date in task details'):kind==='reviews'?row.nextAction:'Review saved invoice status','help'));const identity=node('div',undefined,'overview-record-identity'),details=node('div',undefined,'overview-record-details');identity.append(item.firstElementChild);identity.append(item.firstElementChild);details.append(...item.children);item.replaceChildren(identity,details,context);list.append(item);
    }if(!c.rows.length)list.append(node('p','No matching '+(kind==='invoices'?'outstanding invoices':kind)+'.'));
    c.more.hidden=!c.cursor;
   }
   c.draw=draw;
   c.load=(more=false,opener)=>{
    c.initialized=true;
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
   if(kind==='tasks')c.load();
  }
  makeSection('tasks','Daily tasks','Needs action',[
   ['owner','Task owner',[['','All owners'],['mine','Mine'],['unassigned','Unassigned']]],['clientId','Task client',[['','All clients']]],['projectId','Task project',[['','All projects']]],['status','Task status',[['open','Open work'],...Object.entries(taskStatusNames),['all','All statuses']]],['due','Task due',[['all','Any date'],['overdue','Overdue'],['today','Due today'],['none','No due date']]]
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
  function priority(kind,title,description,values){
   const c=controllers[kind];if(!c)return;
   const action=control(title,()=>{
    for(const [key,value]of Object.entries({...c.defaults,...values})){c.values[key]=value;if(c.selects[key])c.selects[key].value=value;}
    c.load();selectOverview(kind);const heading=c.panel.querySelector('h2');heading.tabIndex=-1;heading.focus();
   });
   action.classList.add('priority-action');action.setAttribute('aria-label',title);action.title=description;action.replaceChildren(node('strong',title));priorityActions.append(action);
  }
  priority('tasks','Overdue tasks','Find open work past its due date.',{status:'open',due:'overdue'});
  priority('tasks','Due today','Plan the work due today (UTC).',{status:'open',due:'today'});
  priority('reviews','Approvals needing attention','Review proposals and requested changes.',{state:'attention'});
  priority('invoices','Overdue invoices','Review saved outstanding balances.',{due:'overdue'});
  const surfaces={...panels,totals};
  const viewNames={tasks:'Work queue',reviews:'Approvals',invoices:'Outstanding invoices',totals:'Workspace'};
  function selectOverview(key){if(!surfaces[key])key='tasks';selectedView=key;overviewPreferences.view=key;if(controllers[key]&&!controllers[key].initialized)controllers[key].load();if(key==='totals')for(const counter of counters)if(!counter.started)counter.run();for(const [name,panel]of Object.entries(surfaces))panel.hidden=name!==key;for(const b of viewBar.children)b.setAttribute('aria-pressed',String(b.dataset.view===key));}
  for(const [key,label]of Object.entries(viewNames)){if(!surfaces[key])continue;const b=control(label,()=>selectOverview(key));b.dataset.view=key;viewBar.append(b);}
  selectOverview(selectedView);
  totals.append(node('p','Source records keep their original status. Client sharing is controlled separately.','help'));root.append(totals);
  state.overviewReady=(async()=>{while(alive()){const pending=operations.map(op=>op.pending).filter(Boolean);if(!pending.length)return;let wake;const nextChange=new Promise(resolve=>{wake=resolve;wakeups.add(wake);});await Promise.race([Promise.allSettled(pending),nextChange]);wakeups.delete(wake);}})();
 }
`;
