// Explicitly saved preferences only; never cache task records or credentials.
export const taskViewsUiScript=String.raw`
 function savedTaskViews(state,panel){
  const control=(label,action)=>{const b=node('button',label,'secondary');b.type='button';b.onclick=()=>{if(current(state))action(b);};return b;};
  const key='ashbi.task-views.v1.'+encodeURIComponent(actor.id)+'.'+encodeURIComponent(state.projectId||'all');
  const region=node('details',undefined,'saved-task-details saved-task-views');region.setAttribute('aria-label','Saved task views');
  const desktopSavedViews=typeof window.matchMedia!=='function'||window.matchMedia('(min-width: 768px)').matches;
  region.open=typeof state.savedTaskViewsOpen==='boolean'?state.savedTaskViewsOpen:desktopSavedViews;state.savedTaskViewsOpen=region.open;
  region.addEventListener('toggle',()=>{state.savedTaskViewsOpen=region.open;});
  const detailsSummary=node('summary','Saved views','saved-task-summary');
  const controls=node('div',undefined,'saved-task-controls'),feedback=node('p',undefined,'help');feedback.setAttribute('aria-live','polite');
  const select=field(controls,'savedTaskView','Saved task view','text',[]);select.required=false;
  const validOptions=o=>o&&['list','board'].includes(o.layout)&&['q','project','status','assignee'].every(k=>typeof o[k]==='string'&&o[k].length<=200)&&typeof o.includeArchivedProjects==='boolean';
  function read(){
   const raw=localStorage.getItem(key);if(!raw)return [];
   if(raw.length>40000)throw Error('Invalid saved views');
   const rows=JSON.parse(raw);
   if(!Array.isArray(rows)||rows.length>20||rows.some(r=>!r||typeof r.id!=='string'||r.id.length>50||typeof r.name!=='string'||!r.name.trim()||r.name.length>60||!validOptions(r.options)))throw Error('Invalid saved views');
   return rows;
  }
  function failure(){feedback.textContent='Saved views are unavailable in this browser. Your task filters still work.';}
  function refresh(selected=''){
   try{const rows=read();select.replaceChildren(node('option','Choose a saved view'));select.options[0].value='';for(const row of rows){const option=node('option',row.name);option.value=row.id;select.append(option);}select.value=selected;apply.disabled=remove.disabled=!select.value;return rows;}catch{failure();apply.disabled=remove.disabled=true;return null;}
  }
  const apply=control('Apply view',()=>{
   try{const saved=read().find(r=>r.id===select.value);if(!saved)return refresh();captureTaskDraft(state);state.taskOptions={...saved.options,...(state.projectId?{project:state.projectId}:{})};load(true);}catch{failure();}
  });
  const remove=control('Remove saved view',()=>{
   try{const rows=read(),saved=rows.find(r=>r.id===select.value);if(!saved)return refresh();localStorage.setItem(key,JSON.stringify(rows.filter(r=>r.id!==saved.id)));refresh();feedback.textContent='Removed saved view “'+saved.name+'”. Tasks are unchanged.';}catch{failure();}
  });
  const save=control('Save current view',opener=>{
   const dialog=node('dialog'),form=node('form'),name=field(form,'viewName','View name','text'),message=node('p');
   name.maxLength=60;name.required=true;message.setAttribute('role','alert');dialog.className='record-dialog';dialog.setAttribute('aria-label','Save task view');
   const submit=node('button','Save view');submit.type='submit';form.append(submit,control('Cancel',()=>dialog.close()));
   dialog.append(node('h2','Save task view'),node('p','Save the applied filters and list or board layout for this account in this browser. Task records are not stored.'),form,message);
   form.onsubmit=e=>{e.preventDefault();if(!current(state))return;const title=name.value.trim();if(!title){message.textContent='Enter a view name.';name.focus();return;}
    try{const rows=read();if(rows.length>=20){message.textContent='You can save up to 20 views here. Remove an unused view first.';return;}if(rows.some(r=>r.name.toLocaleLowerCase()===title.toLocaleLowerCase())){message.textContent='That view name already exists. Choose another name.';return;}
     const o=state.taskOptions,options={layout:o.layout,q:o.q||'',project:o.project||'',status:o.status||'',assignee:o.assignee||'',includeArchivedProjects:Boolean(o.includeArchivedProjects)},id=crypto.randomUUID();
     localStorage.setItem(key,JSON.stringify([...rows,{id,name:title,options}]));refresh(id);feedback.textContent='Saved “'+title+'” in this browser.';dialog.close();
    }catch{message.textContent='Could not save this view. Browser storage may be unavailable or full. Your filters are unchanged.';}
   };
   dialog.addEventListener('close',()=>{dialog.remove();if(current(state)&&opener.isConnected)opener.focus();},{once:true});main.append(dialog);dialog.showModal();name.focus();
  });
  select.onchange=()=>{apply.disabled=remove.disabled=!select.value;};
  controls.append(apply,save,remove);const detailsContent=node('div',undefined,'saved-task-content');detailsContent.append(controls,node('p','Private to this account and browser. Each project has its own saved views.','help'),feedback);region.append(detailsSummary,detailsContent);panel.append(region);refresh();
 }
`;
