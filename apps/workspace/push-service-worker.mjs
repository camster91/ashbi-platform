// This is the tiny browser-side companion for opted-in push delivery. The
// server payload is intentionally generic; navigation is always same-origin.
export const pushServiceWorker=String.raw`
self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
 event.waitUntil(self.clients.claim());
});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let data={};
  try{data=event.data?.json()||{}}catch{}
  if(!/^[a-f0-9]{64}$/.test(data.endpointHash||'')||!/^(message|assignment|deadline|upload):[a-zA-Z0-9-]{1,120}$/.test(data.eventKey||'')||!/^[a-f0-9]{64}$/.test(data.recipient||''))return;
  try{
   const response=await fetch('/api/inbox/push/check',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',cache:'no-store',body:JSON.stringify({subscriptionId:data.endpointHash,eventKey:data.eventKey,recipient:data.recipient})});
   if(!response.ok||(await response.json()).eligible!==true)return;
  }catch{return;}
  await self.registration.showNotification('Ashbi Inbox',{body:'You have a new notification.',tag:'ashbi-inbox',data:{url:'/inbox'},renotify:false});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL('/#inbox',self.location.origin).href;
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
   if('focus' in client){await client.focus();if('navigate' in client)await client.navigate(target);return;}
  }
  if(self.clients.openWindow)await self.clients.openWindow(target);
 })());
});`;
