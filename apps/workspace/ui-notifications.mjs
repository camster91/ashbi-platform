export const notificationsUiScript=String.raw`
 let unreadEpoch=0;
 async function refreshUnread(){
  if(!actor||document.hidden)return;const epoch=++unreadEpoch,identity=actor.id,link=document.querySelector('a[href="#inbox"]'),badge=link?.querySelector('[data-unread-count]');if(!link||!badge)return;
  try{const result=await api('inbox/summary');if(epoch!==unreadEpoch||actor?.id!==identity)return;badge.textContent=result.unreadCount>99?'99+':String(result.unreadCount);badge.hidden=!result.unreadCount;link.title=result.unreadCount+' unread notifications';link.setAttribute('aria-label',result.unreadCount?'Inbox, '+result.unreadCount+' unread notifications':'Inbox');}
  catch{if(epoch!==unreadEpoch)return;badge.hidden=true;link.title='Unread count unavailable. Open Inbox to retry.';link.setAttribute('aria-label','Inbox, unread count unavailable');}
 }
 function notificationsPage(state){
  const panel=node('section',undefined,'panel'),list=node('div'),feedback=node('p'),status=node('p',undefined,'help');let epoch=0,rows=[],cursor=null,filter='unread';
  panel.setAttribute('aria-label','Notifications');feedback.setAttribute('role','alert');status.setAttribute('role','status');
  panel.append(node('p','Project messages, assigned tasks, due dates and client uploads. Marking a notification read keeps the underlying record. Due dates use UTC.','help'));
  const alive=()=>current(state)&&panel.isConnected;
  const refreshButton=button('Refresh inbox',()=>read(false),true,state),more=button('Load older notifications',()=>read(true),true,state);more.hidden=true;
  async function mark(row,opener){const focused=document.activeElement===opener;try{if(row.kind==='message'&&row.unread)await api('notifications/read','POST',{messageIds:[row.id]});else await api('inbox/read','POST',{items:[{kind:row.kind,id:row.id}],read:Boolean(row.unread)});if(!alive())return;feedback.textContent='';await read(false);refreshUnread();if(focused&&document.activeElement===document.body)refreshButton.focus();}catch(e){if(alive())feedback.textContent='Read status could not be confirmed. Retry is safe. '+e.message;}}
  const types={message:'Project message',assignment:'Task assigned to you',deadline:'Task due',upload:'Client upload'};
  function draw(){list.replaceChildren();for(const row of rows){const article=node('article',undefined,'item'),link=node('a',row.project_name);link.href=row.kind==='message'?projectHref(row.project_id,'messages'):row.kind==='upload'?projectHref(row.project_id,'files'):'#tasks/'+encodeURIComponent(row.record_id);article.append(node('h3',row.mentioned?'You were mentioned':types[row.kind]),link,node('p',row.preview),node('p',new Date(row.created_at).toLocaleString(),'help'),button(row.unread?(row.kind==='message'?'Mark message read':'Mark notification read'):'Mark unread',b=>mark(row,b),true,state));list.append(article);}status.textContent=rows.length?rows.length+' '+(filter==='unread'?'unread ':'')+'notification'+(rows.length===1?'':'s')+' loaded.':filter==='unread'?'You’re caught up. No unread notifications.':'No notifications in this view.';more.hidden=!cursor;}
  async function read(append){const run=++epoch,after=append?cursor:null;if(append&&!after)return;refreshButton.disabled=more.disabled=true;list.setAttribute('aria-busy','true');
   try{const data=await api('inbox?state='+filter+(after?'&after='+encodeURIComponent(after):''));if(!alive()||run!==epoch)return;rows=append?[...rows,...data.items]:data.items;cursor=data.nextCursor;feedback.textContent='';draw();refreshUnread();}
   catch(e){if(alive()&&run===epoch){rows=[];cursor=null;list.replaceChildren();status.textContent='Inbox unavailable.';more.hidden=true;feedback.textContent='Could not load notifications. Use Refresh inbox to retry. '+e.message;}}
   finally{if(alive()&&run===epoch){list.removeAttribute('aria-busy');refreshButton.disabled=more.disabled=false;}}
  }
  const filters=node('label','Show notifications '),select=node('select');select.setAttribute('aria-label','Show notifications');for(const [value,label] of [['unread','Unread'],['read','Read'],['all','All']]){const option=node('option',label);option.value=value;select.append(option);}select.onchange=()=>{filter=select.value;read(false);};filters.append(select);
  const settings=node('details'),summary=node('summary','Notification preferences'),form=node('form'),settingsStatus=node('p'),save=node('button','Save preferences');save.type='submit';save.disabled=true;settingsStatus.setAttribute('role','status');settings.append(summary,node('p','Choose which categories appear in your Inbox and count. Turning a category off does not mark its notifications read.','help'));
  const inputs={},names={messages:'Project messages',assignments:'Task assignments',deadlines:'Due and overdue tasks',uploads:'Client uploads',mentions:'Mentions'};
  for(const key of Object.keys(names)){const label=node('label',names[key],'check'),input=node('input');input.type='checkbox';input.disabled=true;inputs[key]=input;label.hidden=actor.role==='client'&&!['messages','mentions'].includes(key);label.prepend(input);form.append(label);}form.append(save,settingsStatus);settings.append(form);
  async function loadPreferences(){try{const prefs=await api('inbox/preferences');if(!alive())return;for(const key of Object.keys(inputs)){inputs[key].checked=prefs[key];inputs[key].disabled=false;}save.disabled=false;settingsStatus.textContent='';}catch(e){if(alive())settingsStatus.textContent='Preferences unavailable. Retry loading preferences. '+e.message;}}
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await api('inbox/preferences','PUT',Object.fromEntries(Object.entries(inputs).map(([k,input])=>[k,input.checked])));if(!alive())return;settingsStatus.textContent='Preferences saved.';await read(false);refreshUnread();}catch(e){if(alive())settingsStatus.textContent='Preferences could not be confirmed. Saving again is safe. '+e.message;}finally{if(alive())save.disabled=false;}};
  settings.append(button('Reload preferences',()=>loadPreferences(),true,state));
  panel.append(filters,refreshButton,settings,feedback,status,list,more);main.append(panel);read(false);loadPreferences();
 }
 window.addEventListener('focus',()=>refreshUnread());
 document.addEventListener('visibilitychange',()=>refreshUnread());
 setInterval(()=>refreshUnread(),30000);
`;
