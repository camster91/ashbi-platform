// Shared workspace interactions. Business mutations stay in their existing controllers.
export const workspaceUiScript=String.raw`
 const navigation=document.querySelector('#workspace-navigation'),navigationToggle=document.querySelector('#navigation-toggle');
 function closeNavigation(restore=true){
  const wasOpen=document.body.classList.contains('navigation-open');document.body.classList.remove('navigation-open');
  document.querySelector('#navigation-backdrop').hidden=true;navigationToggle.setAttribute('aria-expanded','false');
  document.querySelector('.workspace-content').inert=false;document.querySelector('.app-header').inert=false;
  if(wasOpen&&restore)navigationToggle.focus();
 }
 function openNavigation(){
  document.body.classList.add('navigation-open');document.querySelector('#navigation-backdrop').hidden=false;navigationToggle.setAttribute('aria-expanded','true');
  document.querySelector('.workspace-content').inert=true;document.querySelector('.app-header').inert=true;
  document.querySelector('#navigation-close').focus();
 }
 navigationToggle.onclick=openNavigation;document.querySelector('#navigation-close').onclick=()=>closeNavigation();document.querySelector('#navigation-backdrop').onclick=()=>closeNavigation();
 navigation.addEventListener('click',e=>{if(e.target.closest('a[href]'))closeNavigation(false);});
 document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.record-menu[open]'))if(!menu.contains(e.target))menu.open=false;});
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){const menu=document.activeElement.closest('.record-menu[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();}}
  if(!document.body.classList.contains('navigation-open'))return;
  if(e.key==='Escape'){e.preventDefault();closeNavigation();return;}
  if(e.key==='Tab'){
   const items=[...navigation.querySelectorAll('a[href],button')].filter(e=>!e.hidden&&e.getClientRects().length),first=items[0],last=items.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 });
 matchMedia('(min-width:768px)').addEventListener('change',e=>{if(e.matches)closeNavigation(false);});
 const pageDescriptions={overview:'A clear view of what needs your attention.',projects:'Keep your client work moving forward.',tasks:'Plan, prioritize and move work to done.',clients:'The people and companies you work with.',notes:'Your team’s knowledge, organized by project.',files:'Everything your projects need, in one place.',time:'Make every hour count.',finance:'Understand your billable work.',invoices:'Prepare, track and manage client invoices.',commercial:'Move from opportunity to agreed scope.',reviews:'Keep client decisions moving.',contracts:'Manage agreements from draft to signature.','source-history':'Review your retained source records.'};
 function pageHeading(state){
  document.querySelector('#current-location').textContent=labels[state.page];document.title=labels[state.page]+' · Ashbi';
  const header=node('div',undefined,'page-heading'),identity=node('div'),actions=node('div',undefined,'page-heading-actions');
  identity.append(node('h1',labels[state.page]),node('p',pageDescriptions[state.page]||''));header.append(identity,actions);main.append(header);
  if(actor.role==='staff'&&Object.hasOwn(recordKinds,state.page))actions.append(button('Add '+recordKinds[state.page],opener=>createRecord(state,opener),false,state));
  return header;
 }
 function createRecord(state,opener){
  if(!current(state))return;
  const dialog=node('dialog');dialog.className='record-dialog';dialog.setAttribute('aria-label','Add '+recordKinds[state.page]);
  const {actions}=recordForm(undefined,dialog,state);actions.append(button('Cancel',()=>dialog.close(),true,state));
  dialog.addEventListener('close',()=>{captureTaskDraft(state);captureDocumentDraft(state);dialog.remove();if(current(state)&&opener?.isConnected)opener.focus();},{once:true});
  main.append(dialog);dialog.showModal();dialog.querySelector('input,select,textarea')?.focus();
 }
`;
