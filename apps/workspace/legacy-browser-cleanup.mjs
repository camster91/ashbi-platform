// Retire only the old Hub's service worker and caches during the same-domain cutover.
export const cleanupBrowserScript=String.raw`
async function retireLegacyHubCache(){
 try{
  if('serviceWorker' in navigator){for(const registration of await navigator.serviceWorker.getRegistrations()){
   const script=registration.active?.scriptURL||registration.waiting?.scriptURL||registration.installing?.scriptURL;
   if(script&&new URL(script).origin===location.origin&&new URL(script).pathname==='/sw.js')await registration.unregister();
  }}
  if('caches' in globalThis){for(const key of await caches.keys())if(key.startsWith('hub-'))await caches.delete(key);}
 }catch{/* Network-only workspace remains usable if browser storage is unavailable. */}
}
retireLegacyHubCache();
`;
export const retiredServiceWorker=String.raw`
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('hub-'))await caches.delete(key);
 await self.clients.claim();await self.registration.unregister();
})()));
`;
