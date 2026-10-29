export const projectMessagesUiScript=String.raw`
 const projectMessageDrafts=new Map();
 function projectMessages(state){
  const key=actor.id+':'+state.projectId,entry=projectMessageDrafts.get(key)||{content:'',requestId:crypto.randomUUID(),attempt:null,busy:false};projectMessageDrafts.set(key,entry);
  const panel=node('section',undefined,'panel'),list=node('div'),notice=node('p',undefined,'help'),feedback=node('p'),form=node('form');let epoch=0,rows=[],cursor=null;
  panel.setAttribute('aria-label','Project conversation');notice.setAttribute('role','status');feedback.setAttribute('role','alert');
  panel.append(node('h2','Messages'),node('p','Shared with the project team and authorized client contacts when this project is shared. Messages stay in the app; no email is sent.','help'));
  const input=field(form,'message','Message','textarea');input.maxLength=10000;input.value=entry.content;
  input.oninput=()=>{entry.content=input.value;};
  const send=node('button','Post message');send.type='submit';form.append(send);
  const alive=()=>current(state)&&panel.isConnected;
  const refreshButton=button('Refresh messages',()=>read(false),true,state),older=button('Load older messages',()=>read(true),true,state);older.hidden=true;
  const markRead=node('button','Mark loaded messages read','secondary');markRead.type='button';markRead.disabled=true;
  markRead.onclick=async()=>{if(!alive())return;const ids=rows.filter(row=>row.unread).map(row=>row.id);if(!ids.length)return;markRead.disabled=true;try{for(let i=0;i<ids.length;i+=50){if(!alive())return;await api('notifications/read','POST',{messageIds:ids.slice(i,i+50)});}if(alive()){await read(false);refreshUnread();}}catch(e){if(alive())feedback.textContent='Read status could not be confirmed. Retry is safe. '+e.message;}finally{if(alive())markRead.disabled=!rows.some(row=>row.unread);}};
  function controls(){input.disabled=entry.busy||Boolean(entry.attempt)||Boolean(state.project.archived);send.disabled=entry.busy||Boolean(state.project.archived);send.textContent=entry.busy?'Posting…':entry.attempt?'Retry message':'Post message';}
  function draw(){list.replaceChildren();for(const row of rows){const article=node('article',undefined,'item'),by=row.actor_id===actor.id?'You':row.author_role==='client'?'Client':'Project team';if(row.unread)article.append(node('span','Unread','badge'));article.append(node('h3',by),node('p',new Date(row.created_at).toLocaleString(),'help'));const text=node('p',row.content);text.style.whiteSpace='pre-wrap';article.append(text);list.append(article);}notice.textContent=rows.length?rows.length+' messages loaded. Newest first.':'No messages yet. Start the conversation.';older.hidden=!cursor;markRead.disabled=!rows.some(row=>row.unread);}
  async function read(append){const run=++epoch,after=append?cursor:null;if(append&&!after)return;refreshButton.disabled=older.disabled=true;list.setAttribute('aria-busy','true');
   try{const data=await api('projects/'+encodeURIComponent(state.projectId)+'/messages'+(after?'?after='+encodeURIComponent(after):''));if(!alive()||run!==epoch)return;rows=append?[...rows,...data.items]:data.items;cursor=data.nextCursor;draw();}
   catch(e){if(alive()&&run===epoch){if([401,403,404].includes(e.status)){rows=[];cursor=null;list.replaceChildren();older.hidden=true;}feedback.textContent='Messages could not be loaded. '+e.message;}}
   finally{if(alive()&&run===epoch){list.removeAttribute('aria-busy');refreshButton.disabled=older.disabled=false;}}
  }
  form.onsubmit=async e=>{e.preventDefault();if(!alive()||entry.busy||state.project.archived)return;const content=input.value.trim();if(!content)return;
   if(entry.attempt&&entry.attempt.content!==content){feedback.textContent='Retry the original message before editing it, or refresh messages to check whether it arrived.';return;}
   entry.attempt??={content,requestId:entry.requestId};entry.busy=true;feedback.textContent='';controls();
   try{await api('projects/'+encodeURIComponent(state.projectId)+'/messages','POST',entry.attempt);entry.content='';entry.attempt=null;entry.uncertain=false;entry.requestId=crypto.randomUUID();if(alive()){input.value='';feedback.textContent='Message posted.';}}
   catch(e){const rejected=[400,403,404,409].includes(e.status);entry.uncertain||=!rejected;if(rejected&&!entry.uncertain){entry.attempt=null;entry.requestId=crypto.randomUUID();}if(alive())feedback.textContent=(rejected&&!entry.uncertain?'Message was not posted. ':'Posting was not confirmed. Retry uses the same message ID. ')+e.message;}
   finally{entry.busy=false;entry.refresh?.();if(alive()){if(input.disabled)send.focus();else input.focus();}}
  };
  if(state.project.archived)panel.append(node('p','This project is archived. Its conversation is read-only.','notice'));
  panel.append(form,feedback,refreshButton,markRead,notice,list,older);main.append(panel);entry.refresh=()=>{if(alive()){input.value=entry.content;controls();read(false);}};controls();read(false);
 }
`;
