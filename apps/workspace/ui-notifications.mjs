export const notificationsUiScript=String.raw`
 let unreadEpoch=0;
 async function refreshUnread(){
  if(!actor||document.hidden)return;const epoch=++unreadEpoch,identity=actor.id,link=document.querySelector('a[href="#inbox"]'),badge=link?.querySelector('[data-unread-count]');if(!link||!badge)return;
  try{const result=await api('notifications/summary');if(epoch!==unreadEpoch||actor?.id!==identity)return;badge.textContent=result.unreadCount>99?'99+':String(result.unreadCount);badge.hidden=!result.unreadCount;link.title=result.unreadCount+' unread project messages';link.setAttribute('aria-label',result.unreadCount?'Inbox, '+result.unreadCount+' unread project messages':'Inbox');}
  catch{if(epoch!==unreadEpoch)return;badge.hidden=true;link.title='Unread count unavailable. Open Inbox to retry.';link.setAttribute('aria-label','Inbox, unread count unavailable');}
 }
 function notificationsPage(state){
  const panel=node('section',undefined,'panel'),list=node('div'),feedback=node('p'),status=node('p',undefined,'help');let epoch=0,rows=[],cursor=null;
  panel.setAttribute('aria-label','Unread project messages');feedback.setAttribute('role','alert');status.setAttribute('role','status');
  panel.append(node('p','Messages from other people in projects you can access. Marking a notification read does not delete the conversation.','help'));
  const alive=()=>current(state)&&panel.isConnected;
  const refreshButton=button('Refresh inbox',()=>read(false),true,state),more=button('Load older notifications',()=>read(true),true,state);more.hidden=true;
  async function mark(ids,opener){const focused=document.activeElement===opener;try{await api('notifications/read','POST',{messageIds:ids});if(!alive())return;feedback.textContent='';await read(false);refreshUnread();if(focused&&document.activeElement===document.body)refreshButton.focus();}catch(e){if(alive())feedback.textContent='Read status could not be confirmed. Retry is safe. '+e.message;}}
  function draw(){list.replaceChildren();for(const row of rows){const article=node('article',undefined,'item'),link=node('a',row.project_name);link.href=projectHref(row.project_id,'messages');article.append(link,node('p',row.preview),node('p',new Date(row.created_at).toLocaleString(),'help'),button('Mark message read',b=>mark([row.id],b),true,state));list.append(article);}status.textContent=rows.length?rows.length+' unread '+(rows.length===1?'message':'messages')+' loaded.':'You’re caught up. No unread project messages.';more.hidden=!cursor;}
  async function read(append){const run=++epoch,after=append?cursor:null;if(append&&!after)return;refreshButton.disabled=more.disabled=true;list.setAttribute('aria-busy','true');
   try{const data=await api('notifications'+(after?'?after='+encodeURIComponent(after):''));if(!alive()||run!==epoch)return;rows=append?[...rows,...data.items]:data.items;cursor=data.nextCursor;feedback.textContent='';draw();refreshUnread();}
   catch(e){if(alive()&&run===epoch){rows=[];cursor=null;list.replaceChildren();status.textContent='Inbox unavailable.';more.hidden=true;feedback.textContent='Could not load notifications. Use Refresh inbox to retry. '+e.message;}}
   finally{if(alive()&&run===epoch){list.removeAttribute('aria-busy');refreshButton.disabled=more.disabled=false;}}
  }
  panel.append(refreshButton,feedback,status,list,more);main.append(panel);read(false);
 }
 window.addEventListener('focus',()=>refreshUnread());
 document.addEventListener('visibilitychange',()=>refreshUnread());
 setInterval(()=>refreshUnread(),30000);
`;
