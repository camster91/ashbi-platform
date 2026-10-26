export const recordLinkUiScript=String.raw`
 function recordLink(page,id,label,accessibleLabel=label){
  if(!['tasks','reviews','invoices','contracts'].includes(page)||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id))return node('span','Record link unavailable.','help');
  return recordRouteLink('#'+page+'/'+id,label,accessibleLabel);
 }
 function recordSourceLink(source,label,accessibleLabel=label){
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(value);
  if(source?.kind==='invoices'&&id(source.id))return recordLink('invoices',source.id,label,accessibleLabel);
  if(source?.kind==='invoice-parts'&&id(source.id)&&id(source.invoiceId)&&id(source.scheduleId)&&['DEPOSIT','BALANCE'].includes(source.partKind))return recordRouteLink('#invoices/'+source.invoiceId+'/parts/'+source.id,label,accessibleLabel);
  return node('span','Record link unavailable.','help');
 }
 function recordRouteLink(route,label,accessibleLabel){
  const context=view,link=node('a',label);link.href=route;link.setAttribute('aria-label',accessibleLabel);link.onclick=e=>{if(!current(context)||!link.isConnected){e.preventDefault();return;}if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&link.hash===location.hash){e.preventDefault();load(true);}};return link;
 }
 function denyLinkedRecord(state,kind,missing=false){
  if(!current(state))return;state.linkDenied=true;
  const name=kind==='tasks'?'task':kind==='reviews'?'review':kind==='contracts'?'contract':'invoice';
  const notice=node('p',missing?'This '+name+' is unavailable. Reload '+labels[state.page]+' to check your access.':'Record access changed. Reload the page to check your access.','notice');notice.setAttribute('role','alert');main.replaceChildren(node('h1',labels[state.page]),notice);
  main.removeAttribute('aria-busy');const reload=node('button','Reload page');reload.type='button';reload.onclick=()=>{if(location.hash===state.routeKey)load(true);};
  const list=node('a','Open '+labels[state.page]);list.href='#'+state.page;main.append(reload,document.createTextNode(' '),list);if(document.activeElement===document.body)reload.focus();
 }
 function linkedTask(state,opener){
  if(!current(state)||!state.recordId)return;state.taskLinkDialog?.remove();
  const dialog=node('dialog'),body=node('section'),status=node('p'),errors=node('section'),image=node('section'),close=node('button','Close task'),reload=node('button','Reload task','secondary');
  dialog.className='history-dialog';dialog.setAttribute('aria-label','Task details');close.type=reload.type='button';status.setAttribute('role','status');let epoch=0,closed=false;
  const valid=()=>current(state)&&!closed&&dialog.isConnected&&dialog.open&&state.taskLinkDialog===dialog;
  close.onclick=()=>dialog.close();reload.onclick=()=>read();body.append(status,errors,image);dialog.append(node('h2','Task details'),close,reload,body);main.append(dialog);state.taskLinkDialog=dialog;
  dialog.addEventListener('close',()=>{closed=true;++epoch;dialog.remove();if(state.taskLinkDialog===dialog)state.taskLinkDialog=null;if(current(state)&&!main.querySelector('dialog[open]')&&document.activeElement===document.body)(opener?.isConnected?opener:state.taskLinkOpener?.isConnected?state.taskLinkOpener:main).focus();},{once:true});dialog.showModal();
  async function read(){
   if(!valid())return;const local=++epoch,hadFocus=document.activeElement===reload;reload.disabled=true;body.setAttribute('aria-busy','true');errors.replaceChildren();image.replaceChildren();status.textContent='Loading task…';
   try{const record=await api('tasks/'+state.recordId);if(!valid()||local!==epoch)return;if(record.id!==state.recordId)throw Error('The task response does not match this record.');image.append(recordItem(record,state));status.textContent='Task loaded.';}
   catch(e){if(!valid()||local!==epoch)return;if([401,403,404].includes(e.status)||e.message?.startsWith('Session ended')){denyLinkedRecord(state,'tasks',e.status===404);return;}error(e.message,errors);status.textContent='Unable to load the task. Try again.';}
   finally{if(valid()&&local===epoch){body.removeAttribute('aria-busy');reload.disabled=false;if(hadFocus&&document.activeElement===document.body)reload.focus();}}
  }
  read();
 }
`;
