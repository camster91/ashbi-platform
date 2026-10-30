// Login is an account boundary: discard this browser's old push subscription.
// No private app content is cached by the notification worker.
export const cleanupPushBrowserScript=String.raw`
async function retirePreviousPushSubscription(){
 try{if('serviceWorker' in navigator){for(const registration of await navigator.serviceWorker.getRegistrations()){
  const script=registration.active?.scriptURL||registration.waiting?.scriptURL||registration.installing?.scriptURL;
  if(script&&new URL(script).origin===location.origin&&new URL(script).pathname==='/notifications-sw.js'){
   await(await registration.pushManager.getSubscription())?.unsubscribe();
   for(const notification of await registration.getNotifications())notification.close();
   await registration.unregister();
  }
 }}}catch{/* Session checks in the push worker suppress unauthenticated notifications. */}
}
retirePreviousPushSubscription();
`;
