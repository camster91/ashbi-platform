export const commercialUiScript=String.raw`
 window.addEventListener('storage',()=>{if(view?.page==='commercial')view.commercialStorage?.();});
 function commercialSnapshot(container,record){
  container.append(node('h3',record.title),node('p',record.kind+' · '+record.status+' · Revision '+record.revision));
  if(record.targets.client)container.append(node('p',record.targets.client.name+(record.targets.project?' · '+record.targets.project.name:'')));
  if(record.kind==='PROPOSAL'){
   for(const [label,value]of [['Scope',record.content.scope],['Schedule',record.content.schedule],['Terms',record.content.terms]]){container.append(node('h4',label),node('p',value,'commercial-text'));}
   for(const row of record.content.charges)container.append(node('p',row.description+' · '+row.quantity+' × '+financeMoney(record.content.currency,row.unitMinor)+' = '+financeMoney(record.content.currency,row.totalMinor),'commercial-text'));
   for(const [label,key]of [['Subtotal','subtotalMinor'],['Discount','discountMinor'],['Tax','taxMinor'],['Full total','totalMinor'],['Balance after requested deposit','balanceMinor']])container.append(node('p',label+': '+financeMoney(record.content.currency,record.content.totals[key])));
   if(record.content.depositMinor)container.append(node('p','Requested deposit: '+financeMoney(record.content.currency,record.content.depositMinor)));
  }else container.append(node('p',record.content.text,'commercial-text'));
  if(record.source.template)container.append(node('p','Template revision: '+record.source.template.revision+' · '+record.source.template.id,'help'));
  if(record.source.proposal)container.append(node('p','Proposal revision: '+record.source.proposal.revision+' · '+record.source.proposal.id,'help'));
 }
 function commercialPage(state){
  if(actor.role!=='staff'||!actor.features.finance){main.append(node('p','Financial access is required.','notice'));return;}
  const root=node('section',undefined,'commercial'),recovery=node('section'),notice=node('section'),tabs=node('div',undefined,'row'),editor=node('section',undefined,'panel'),review=node('section',undefined,'panel'),listing=node('section',undefined,'panel');
  main.append(root);root.append(node('p','Prepare proposals and contract drafts for review. Nothing is sent, signed or charged.','notice'),recovery,notice,tabs,editor,review,listing);
  const names={proposals:'proposals',templates:'contract templates',contracts:'contracts'},cache=new Map(),options={},prefix='ashbi.commercial.pending.'+actor.id+'.',messages=new Map(),checking=new Set(),settled=new Set();
  let type='proposals',editorKey='proposals:new',form,fields={},charges=[],reviewed=null,listAttempt=0,choiceAttempt=0,rows=[],cursor=null,listBusy=false,savingKey=null,denied=false,activeDialog=null;
  const valid=()=>current(state)&&root.isConnected&&!denied;
  const pending=()=>{try{return Object.keys(localStorage).filter(k=>k.startsWith(prefix)&&/^[a-f0-9-]{36}$/.test(k.slice(prefix.length))).map(k=>k.slice(prefix.length));}catch{return [];}};
  function fail(e,container=notice){if(!valid())return;if(e.status===403){denied=true;cache.clear();activeDialog?.remove();root.replaceChildren(node('p','Financial access is required.','notice'));return;}error(e.message,container);}
  function action(label,fn,secondary=true){const b=node('button',label,secondary?'secondary':'');b.type='button';b.onclick=async()=>{if(!valid())return;b.disabled=true;try{await fn();}catch(e){fail(e);}finally{if(valid()&&b.isConnected){b.disabled=false;lock();}}};return b;}
  function lock(){if(!form)return;const blocked=savingKey!==null||pending().length>0;for(const control of form.elements)control.disabled=blocked||Boolean(control.dataset.fixed);for(const b of review.querySelectorAll('button'))b.disabled=blocked;for(const control of root.querySelectorAll('[data-commercial-change]'))control.disabled=blocked;}
  function scan(){if(!valid())return;recovery.replaceChildren();for(const key of pending()){const item=node('section',undefined,'panel');item.setAttribute('aria-label','Save recovery '+key);item.append(node('h2','Uncertain save'),node('p','Recovery key: '+key,'help'),node('p',messages.get(key)||'Check the saved result before preparing another mutation.'));const check=action('Check save result',()=>reconcile(key,false)),stop=action('Stop save attempt',()=>reconcile(key,true));check.disabled=stop.disabled=checking.has(key);item.querySelector('p:last-of-type').setAttribute('role','status');item.append(check,stop);recovery.append(item);}lock();}
  async function reconcile(key,stop=false,automatic=false){
   if(!valid()||checking.has(key))return;checking.add(key);const enteredType=type,enteredEditor=editorKey;scan();
   try{const result=await api('commercial/requests/'+key+(stop?'/cancel':''),stop?'POST':'GET',stop?{}:undefined);if(!valid())return;
    if(result.state==='UNKNOWN'){messages.set(key,'The save result is still unknown. Check again or stop this attempt.');return;} settled.add(key);if(savingKey===key)savingKey=null;
    try{localStorage.removeItem(prefix+key);}catch{messages.set(key,'The result is saved or stopped, but the recovery key could not be cleared. Check again.');return;}
    messages.delete(key);notice.replaceChildren();invalidate();if(result.state==='SAVED'){await loadList();if(valid()&&type===enteredType&&editorKey===enteredEditor)await details(result.record.id,result.record.kind.toLowerCase()==='template'?'templates':result.record.kind.toLowerCase()+'s',null);}else if(!automatic)notice.replaceChildren(node('p','Save attempt stopped. Review your preparation before saving again.','notice'));
   }catch(e){if(valid()){if(e.status===403)fail(e);else messages.set(key,e.message);}}
   finally{checking.delete(key);if(valid())scan();}
  }
  state.commercialStorage=()=>{scan();for(const key of pending())reconcile(key,false,true);};
  async function persist(path,body,method,onSaved,effect=valid){
   if(!valid()||savingKey!==null||pending().length)return;const key=crypto.randomUUID();
   try{localStorage.setItem(prefix+key,key);}catch{throw Error('Unable to retain the save recovery key. Allow browser storage before saving.');}
   savingKey=key;scan();
   try{const result=await api(path,method,{...body,requestId:key});if(!valid()||!effect()||settled.has(key))return;settled.add(key);
    try{localStorage.removeItem(prefix+key);}catch{messages.set(key,'Saved, but the recovery key could not be cleared. Check the save result.');return;}
    messages.delete(key);await onSaved(result);
   }catch(e){if(valid()&&effect()&&!settled.has(key)){messages.set(key,e.message);if(e.status===403)fail(e);else error(e.message,notice);}}
   finally{const owned=savingKey===key;if(owned)savingKey=null;if(valid()&&owned)scan();}
  }
  function invalidate(){reviewed=null;review.hidden=true;review.replaceChildren();}
  function remember(){if(!form)return;const prior=cache.get(editorKey)||{},sources={};for(const name of ['template','proposal']){const option=fields[name]?.selectedOptions[0];if(option?.value)sources[name]={id:option.value,revision:option.dataset.revision,label:option.textContent};}cache.set(editorKey,{...prior,sources,values:Object.fromEntries([...form.elements].filter(e=>e.name).map(e=>[e.name,e.value])),charges:charges.map(c=>({description:c.description.value,quantity:c.quantity.value,unitPrice:c.unit.value})),record:prior.record});}
  function newEditor(kind){remember();type=kind;editorKey=kind+':new';renderEditor();renderFilters();loadList();updateTabs();}
  function updateTabs(){for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.kind===type));}
  for(const kind of Object.keys(names)){const b=action('Show '+names[kind],()=>newEditor(kind));b.dataset.kind=kind;tabs.append(b);}updateTabs();
  function addCharge(value={}){
   const box=node('fieldset'),number=charges.length+1;box.append(node('legend','Item '+number));const description=field(box,'itemDescription'+number,'Item description '+number),quantity=field(box,'itemQuantity'+number,'Item quantity '+number),unit=field(box,'itemUnit'+number,'Item unit price '+number);description.maxLength=500;quantity.inputMode='numeric';unit.inputMode='decimal';description.value=value.description||'';quantity.value=value.quantity??'1';unit.value=value.unitPrice??'';
   const row={box,description,quantity,unit};charges.push(row);box.append(action('Remove item '+number,()=>{remember();const saved=cache.get(editorKey);saved.charges.splice(charges.indexOf(row),1);renderEditor();}));fields.items.append(box);
  }
  function renderEditor(){
   invalidate();++choiceAttempt;const saved=cache.get(editorKey)||{},record=saved.record,values=saved.values||{};editor.replaceChildren();editor.append(node('h2',record?'Edit draft · revision '+record.revision:type==='proposals'?'Prepare proposal':type==='templates'?'Prepare contract template':'Prepare contract'));
   editor.append(action('New '+(type==='proposals'?'proposal':type==='templates'?'contract template':'contract'),()=>newEditor(type)));
   form=document.createElement('form');form.dataset.commercialForm='';fields={};charges=[];editor.append(form);
   const input=(name,label,kind='text',choices)=>{const e=field(form,name,label,kind,choices);if(name in values)e.value=values[name];fields[name]=e;return e;};
   input('title','Draft title');
   if(type!=='templates'){
    const client=input('client','Draft client','text',state.financeClients),project=input('project','Draft project','text',[]);project.required=false;project.options[0].textContent='Any project';
    const projects=()=>{const selected=project.value;project.replaceChildren(new Option('Any project',''));for(const row of state.parents.filter(p=>p.client_id===client.value))project.append(new Option(row.name,row.id));project.value=values.project??selected;};projects();
    if(record){client.dataset.fixed=project.dataset.fixed='true';client.disabled=project.disabled=true;}
    client.addEventListener('change',()=>{delete values.project;project.value='';projects();if(type==='contracts')loadChoices();});project.addEventListener('change',()=>{if(type==='contracts')loadChoices();});
   }
   if(type==='proposals'){
    input('scope','Scope','textarea').maxLength=10000;input('schedule','Schedule','textarea').maxLength=4000;fields.schedule.required=false;input('terms','Terms','textarea').maxLength=10000;fields.terms.required=false;
    input('currency','Proposal currency','text',['CAD','USD','EUR','GBP'].map(id=>({id,name:id})));
    input('taxType','Proposal tax type','text',['NONE','HST','GST','PST','TAX'].map(id=>({id,name:id})));input('taxRate','Proposal tax rate (%)').inputMode='decimal';input('discount','Discount amount').inputMode='decimal';input('deposit','Requested deposit').inputMode='decimal';fields.deposit.required=false;
    fields.items=node('section');form.append(fields.items);for(const row of saved.charges||[{}])addCharge(row);form.append(action('Add proposal item',()=>{if(charges.length>=50)throw Error('A proposal supports up to 50 items.');invalidate();addCharge();}));
   }else input('text','Draft text','textarea');
   if(type==='contracts'&&!record){
    input('template','Source template','text',[]).required=false;input('proposal','Source proposal','text',[]).required=false;
    fields.template.options[0].textContent='No template';fields.proposal.options[0].textContent='No proposal';
    form.append(action('Copy selected template text',async()=>{
     const option=fields.template.selectedOptions[0];if(!option?.value)throw Error('Select a template first.');const attempt=++choiceAttempt,selected=option.value;
     const active=()=>valid()&&attempt===choiceAttempt&&type==='contracts'&&fields.template?.value===selected;
     try{const row=await api('commercial/templates/'+selected);if(!active())return;if(row.revision!==Number(option.dataset.revision)||row.status!=='DRAFT')throw Error('Template changed. Refresh its choices before copying.');fields.text.value=row.content.text;invalidate();}catch(e){if(active())fail(e);}
    }));loadChoices(true);
   }
   const submit=node('button','Review draft');submit.type='submit';form.append(submit);
   form.addEventListener('input',()=>{invalidate();notice.replaceChildren();});form.addEventListener('change',invalidate);
   form.onsubmit=e=>{e.preventDefault();if(!valid()||savingKey!==null||pending().length)return;try{const body=preparation(record);reviewed={body,kind:type,key:editorKey,record};review.hidden=false;review.replaceChildren(node('h2','Review draft'),node('p','Review this preparation. Saving stores a private draft; it does not send, approve or sign it.','notice'));commercialSnapshot(review,preview(body,record));review.append(action('Save reviewed draft',()=>saveReviewed(),false));}catch(e){fail(e);}};
   lock();
  }
  function preparation(record){
   const title=fields.title.value,body={title};if(!record&&type!=='templates'){body.clientId=fields.client.value;if(fields.project.value)body.projectId=fields.project.value;}if(record)body.revision=record.revision;
   if(type==='proposals'){
    const rate=financeMinor(fields.taxRate.value,'tax rate');if(rate>5000)throw Error('Tax rate must be between 0 and 50 percent.');
    body.content={scope:fields.scope.value,schedule:fields.schedule.value,terms:fields.terms.value,currency:fields.currency.value,tax:{type:fields.taxType.value,rateBps:rate},discountMinor:financeMinor(fields.discount.value,'discount'),charges:charges.map(c=>{if(!/^\d+$/.test(c.quantity.value)||!Number.isSafeInteger(Number(c.quantity.value))||Number(c.quantity.value)<1||Number(c.quantity.value)>1000000)throw Error('Enter a whole item quantity.');return {description:c.description.value,quantity:Number(c.quantity.value),unitMinor:financeMinor(c.unit.value,'item price')};})};if(fields.deposit.value)body.content.depositMinor=financeMinor(fields.deposit.value,'deposit');
   }else{body.content={text:fields.text.value};if(type==='contracts'&&!record)for(const name of ['template','proposal'])if(fields[name].value)body[name]={id:fields[name].value,revision:Number(fields[name].selectedOptions[0].dataset.revision)};}
   return body;
  }
  function preview(body,record){
   const content=structuredClone(body.content);if(type==='proposals'){
    if(!content.charges.length||content.charges.length>50||content.tax.type==='NONE'&&content.tax.rateBps!==0)throw Error('Check proposal items and the explicit tax declaration.');
    const safe=n=>{if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Proposal amount is too large or negative.');return Number(n);};for(const c of content.charges)c.totalMinor=safe(BigInt(c.quantity)*BigInt(c.unitMinor));
    const subtotalMinor=safe(content.charges.reduce((sum,c)=>sum+BigInt(c.totalMinor),0n)),taxableMinor=safe(BigInt(subtotalMinor)-BigInt(content.discountMinor)),taxMinor=safe((BigInt(taxableMinor)*BigInt(content.tax.rateBps)*2n+10000n)/20000n),totalMinor=safe(BigInt(taxableMinor)+BigInt(taxMinor));if(!totalMinor||content.depositMinor!==undefined&&(content.depositMinor<1||content.depositMinor>=totalMinor))throw Error('Deposit must be greater than zero and below the full proposal total.');content.totals={subtotalMinor,discountMinor:content.discountMinor,taxMinor,totalMinor,balanceMinor:totalMinor-(content.depositMinor??0)};
   }
   const client=state.financeClients.find(c=>c.id===(record?.clientId??body.clientId)),project=state.parents.find(p=>p.id===(record?.projectId??body.projectId));return {title:body.title,kind:type==='proposals'?'PROPOSAL':type==='templates'?'TEMPLATE':'CONTRACT',status:'DRAFT',revision:record?.revision??0,content,targets:{client,project},source:record?.source||{template:body.template,proposal:body.proposal}};
  }
  async function saveReviewed(){const selected=reviewed;if(!selected)return;await persist('commercial/'+selected.kind+(selected.record?'/'+selected.record.id:''),selected.body,selected.record?'PATCH':'POST',async result=>{const stayed=editorKey===selected.key&&type===selected.kind;cache.delete(selected.key);if(editorKey===selected.key){editorKey=selected.kind+':new';renderEditor();}const displayKey=editorKey;await loadList();if(valid()&&stayed&&editorKey===displayKey&&type===selected.kind)await details(result.id,selected.kind,null);});}
  async function loadChoices(restore=false){
   const attempt=++choiceAttempt,selectedClient=fields.client.value,selectedProject=fields.project.value,template=fields.template,proposal=fields.proposal,selections=restore?cache.get(editorKey)?.sources||{}:{};if(!template)return;
   template.replaceChildren(new Option('No template',''));proposal.replaceChildren(new Option('No proposal',''));template.disabled=proposal.disabled=true;
   try{const [templates,proposals]=await Promise.all([listAll('commercial/templates?status=DRAFT'),selectedClient?listAll('commercial/proposals?status=DRAFT&clientId='+encodeURIComponent(selectedClient)):[]]);if(!valid()||attempt!==choiceAttempt||type!=='contracts')return;
    for(const [name,select,items]of [['template',template,templates],['proposal',proposal,proposals.filter(row=>!row.projectId||row.projectId===selectedProject)]]){
     for(const row of items){const option=new Option(row.title+' · revision '+row.revision,row.id);option.dataset.revision=String(row.revision);select.append(option);}
     const selected=selections[name];if(selected){let option=[...select.options].find(o=>o.value===selected.id&&o.dataset.revision===selected.revision);if(!option){option=new Option(selected.label+' (source changed; review selection)',selected.id);option.dataset.revision=selected.revision;select.append(option);}option.selected=true;}
    }
   }
   catch(e){if(valid()&&attempt===choiceAttempt)fail(e);}finally{if(valid()&&attempt===choiceAttempt)lock();}
  }
  let filterForm,listRows,listStatus,more,refreshButton;
  function renderFilters(){
   ++listAttempt;listing.replaceChildren(node('h2','Saved '+names[type]));filterForm=document.createElement('form');filterForm.setAttribute('aria-label','Draft filters');const opts=options[type]??={status:'',client:'',project:''};
   const status=field(filterForm,'status','Draft status filter','text',[{id:'DRAFT',name:'Draft'},{id:'ARCHIVED',name:'Archived'}]);status.required=false;status.options[0].textContent='All statuses';status.value=opts.status;
   if(type!=='templates'){for(const [name,label,items]of [['client','Draft client filter',state.financeClients],['project','Draft project filter',state.parents]]){const e=field(filterForm,name,label,'text',items);e.required=false;e.options[0].textContent='All';e.value=opts[name];}}
   filterForm.onsubmit=e=>e.preventDefault();filterForm.onchange=()=>{Object.assign(opts,Object.fromEntries(new FormData(filterForm)));loadList();};refreshButton=action('Refresh drafts',()=>loadList());filterForm.append(refreshButton);listStatus=node('p');listStatus.setAttribute('role','status');listRows=node('section');listRows.setAttribute('aria-label',names[type][0].toUpperCase()+names[type].slice(1)+' list');more=action('Load more drafts',()=>loadList(cursor));more.hidden=true;listing.append(filterForm,listStatus,listRows,more);
  }
  async function loadList(after){
   if(!valid())return;const attempt=++listAttempt,kind=type,opts=options[type],params=new URLSearchParams();for(const [key,value]of [['status',opts.status],['clientId',opts.client],['projectId',opts.project],['after',after]])if(value)params.set(key,value);listBusy=true;listing.setAttribute('aria-busy','true');listStatus.textContent='Loading saved drafts…';more.disabled=true;
   try{const result=await api('commercial/'+kind+(params.size?'?'+params:''));if(!valid()||attempt!==listAttempt)return;rows=after?[...rows,...result.items]:result.items;cursor=result.nextCursor;listRows.replaceChildren();for(const row of rows){const article=node('article',undefined,'item'),open=action('Open '+row.title,()=>details(row.id,kind,open));open.dataset.commercialId=row.id;article.append(open,node('p',row.status+' · Revision '+row.revision+(row.currency?' · '+financeMoney(row.currency,row.totalMinor):'')));listRows.append(article);}listStatus.textContent=rows.length?'Showing '+rows.length+' saved drafts.':'No matching drafts.';more.hidden=!cursor;}
   catch(e){if(valid()&&attempt===listAttempt){fail(e);listStatus.textContent='Unable to load saved drafts.';}}
   finally{if(valid()&&attempt===listAttempt){listBusy=false;listing.removeAttribute('aria-busy');more.disabled=false;}}
  }
  async function details(draftId,kind,opener){
   if(!valid())return;activeDialog?.remove();const dialog=document.createElement('dialog'),heading=node('h2','Draft details'),content=node('section'),history=node('section'),version=node('section');heading.id='commercial-dialog-'+(++fieldCount);dialog.setAttribute('aria-labelledby',heading.id);root.append(dialog);activeDialog=dialog;let closed=false,entry=null,attempt=0,historyAttempt=0,versionAttempt=0,busy=false;
   const alive=()=>valid()&&!closed&&dialog.isConnected&&activeDialog===dialog;
   const close=()=>{closed=true;dialog.remove();if(activeDialog===dialog)activeDialog=null;if(valid()){const currentRow=[...listRows.querySelectorAll('[data-commercial-id]')].find(b=>b.dataset.commercialId===draftId);(currentRow||opener?.isConnected&&opener||refreshButton).focus();}};
   dialog.append(heading,action('Close',close),content,history,version);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();
   function localAction(label,fn){const b=action(label,async()=>{if(!alive())return;try{await fn();}catch(e){if(alive())fail(e,content);}});return b;}
   function show(){++historyAttempt;++versionAttempt;content.replaceChildren();history.replaceChildren();version.replaceChildren();commercialSnapshot(content,entry);content.append(localAction('Reload draft',reload),localAction('Draft history',()=>loadHistory()));if(entry.status==='DRAFT')content.append(localAction('Edit draft',()=>{remember();type=kind;editorKey=kind+':'+entry.id;const v={title:entry.title,client:entry.clientId||'',project:entry.projectId||''},c=entry.content;if(kind==='proposals')Object.assign(v,{scope:c.scope,schedule:c.schedule,terms:c.terms,currency:c.currency,taxType:c.tax.type,taxRate:timeMoney(c.tax.rateBps),discount:timeMoney(c.discountMinor),deposit:c.depositMinor?timeMoney(c.depositMinor):''});else v.text=c.text;cache.set(editorKey,{record:entry,values:v,charges:kind==='proposals'?c.charges.map(c=>({description:c.description,quantity:String(c.quantity),unitPrice:timeMoney(c.unitMinor)})):[]});renderEditor();renderFilters();loadList();updateTabs();close();fields.title.focus();}));
    const reason=field(content,'reason','Change reason','textarea');reason.maxLength=2000;reason.dataset.commercialChange='';const archive=entry.status==='DRAFT',change=localAction(archive?'Archive draft':'Reopen draft',async()=>{if(!reason.value.trim())throw Error('Enter a change reason.');const observed=entry.revision,mutationAttempt=++attempt;await persist('commercial/'+kind+'/'+draftId+(archive?'/archive':'/reopen'),{revision:observed,reason:reason.value},'POST',async result=>{if(!alive())return;entry=result;show();await loadList();},()=>alive()&&attempt===mutationAttempt);});change.dataset.commercialChange='';content.append(change);lock();
   }
   async function reload(){const local=++attempt;content.setAttribute('aria-busy','true');try{const row=await api('commercial/'+kind+'/'+draftId);if(!alive()||local!==attempt)return;entry=row;show();}catch(e){if(alive()&&local===attempt)fail(e,content);}finally{if(alive()&&local===attempt)content.removeAttribute('aria-busy');}}
   async function loadHistory(before){const local=++historyAttempt;try{const data=await api('commercial/'+kind+'/'+draftId+'/history'+(before!==undefined?'?before='+before:''));if(!alive()||local!==historyAttempt)return;if(before===undefined)history.replaceChildren(node('h3','Draft history'));history.querySelector('[data-older]')?.remove();for(const event of data.items){const item=node('article',undefined,'item');item.append(node('p',event.action+' · '+event.actorId+' · '+new Date(event.recordedAt).toLocaleString('en-CA')));if(event.reason)item.append(node('p',event.reason));item.append(localAction('Preview revision '+event.revision,async()=>{const local=++versionAttempt;try{const snapshot=await api('commercial/'+kind+'/'+draftId+'/history/'+event.revision);if(!alive()||local!==versionAttempt)return;version.dataset.versionPreview='';version.replaceChildren(node('h3','Version preview'));commercialSnapshot(version,snapshot);}catch(e){if(alive()&&local===versionAttempt)fail(e,version);}}));history.append(item);}if(data.nextCursor!==null){const b=localAction('Load older draft history',()=>loadHistory(data.nextCursor));b.dataset.older='';history.append(b);}}catch(e){if(alive()&&local===historyAttempt)fail(e,history);}}
   await reload();
  }
  renderEditor();renderFilters();loadList();scan();for(const key of pending())reconcile(key,false,true);
 }
`;
