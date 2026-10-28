export const searchUiScript=String.raw`
 let workspaceSearch=null;
 function closeWorkspaceSearch(){workspaceSearch?.close();}
 function openWorkspaceSearch(){
  if(workspaceSearch?.open){workspaceSearch.querySelector('input').focus();return;}
  if(document.querySelector('dialog[open]'))return;
  const opener=document.activeElement,dialog=node('dialog'),form=document.createElement('form'),results=node('div'),status=node('p'),feedback=node('div');let epoch=0,query='',closed=false;
  dialog.className='search-dialog';dialog.setAttribute('aria-label','Search workspace');status.setAttribute('role','status');status.tabIndex=-1;
  const close=node('button','Close search','secondary');close.type='button';close.onclick=()=>dialog.close();
  const input=field(form,'q','Search clients, projects, tasks and documents','search');input.maxLength=200;input.required=false;input.autocomplete='off';
  const submit=node('button','Search');submit.type='submit';form.append(submit);dialog.append(node('h2','Search workspace'),close,form,status,feedback,results);status.textContent='Search by name or title. Active projects and documents only.';
  const valid=()=>!closed&&dialog.isConnected&&dialog.open;
  const groups=new Map();
  function draw(group){
   let section=groups.get(group.type);if(!section){section=node('section',undefined,'search-results');section.setAttribute('aria-label',labels[group.type]+' search results');groups.set(group.type,section);results.append(section);}
   section.replaceChildren(node('h3',labels[group.type]));
   for(const row of group.items){const link=node('a',row.title);link.href='#'+group.type+'/'+encodeURIComponent(row.id);link.onclick=e=>{if(e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){const same=link.hash===location.hash;dialog.close();if(same){e.preventDefault();load(true);}}};section.append(link);}
   if(!group.items.length)section.append(node('p','No matches.','help'));
   if(group.nextCursor){const more=node('button','Load more '+labels[group.type].toLowerCase(),'secondary');more.type='button';more.onclick=()=>run(group.type,group.nextCursor,group.items,more);section.append(more);}
  }
  async function run(type,after,prior=[],opener){
   const local=++epoch,requested=query;feedback.replaceChildren();status.textContent='Searching…';results.setAttribute('aria-busy','true');
   if(!type){results.replaceChildren();groups.clear();}if(opener)opener.disabled=true;
   const params=new URLSearchParams({q:requested});if(type)params.set('type',type);if(after)params.set('after',after);
   try{const data=await api('search?'+params);if(!valid()||local!==epoch)return;
    const restore=opener&&document.activeElement===opener;for(const group of data.groups)draw({...group,items:[...prior,...group.items]});status.textContent='Search results loaded. More matches may be available in each section.';if(restore)(groups.get(type)?.querySelector('button')||status).focus();
   }catch(e){if(!valid()||local!==epoch)return;if([401,403].includes(e.status)){results.replaceChildren();groups.clear();}error(e.message,feedback);status.textContent='Search unavailable. Try again.';}
   finally{if(valid()&&local===epoch){results.removeAttribute('aria-busy');if(opener?.isConnected)opener.disabled=false;}}
  }
  form.onsubmit=e=>{e.preventDefault();query=input.value.trim();if(!query){++epoch;results.replaceChildren();groups.clear();feedback.replaceChildren();results.removeAttribute('aria-busy');status.textContent='Enter a name or title to search.';return;}run();};
  dialog.addEventListener('close',()=>{closed=true;++epoch;dialog.remove();if(workspaceSearch===dialog)workspaceSearch=null;if(document.activeElement===document.body&&opener?.isConnected)opener.focus();},{once:true});
  document.body.append(dialog);workspaceSearch=dialog;dialog.showModal();input.focus();
 }
 document.querySelector('#workspace-search').onclick=openWorkspaceSearch;
 document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!event.altKey){event.preventDefault();openWorkspaceSearch();}});
`;
