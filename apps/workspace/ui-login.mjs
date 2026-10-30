import {cleanupPushBrowserScript} from './push-browser-cleanup.mjs';
import {brandLogo} from './ui-brand-assets.generated.mjs';
import {cleanupBrowserScript} from './legacy-browser-cleanup.mjs';
export const loginHtml=`<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in — Ashbi</title><link rel="stylesheet" href="/app.css"><script defer src="/login.js"></script></head><body class="auth-page"><main id="main" class="auth-card"><a class="brand" href="/login" aria-label="Ashbi sign in"><img src="${brandLogo}" alt="Ashbi" width="930" height="330"></a><h1 tabindex="-1">Sign in</h1><p id="auth-intro">Use your existing Ashbi account.</p><div id="auth-message" role="status" aria-live="polite"></div><div id="auth-form"></div><p><a href="/login" id="auth-back">Back to sign in</a></p></main></body></html>`;
export const loginScript=cleanupBrowserScript+cleanupPushBrowserScript+String.raw`
const root=document.querySelector('#auth-form'),heading=document.querySelector('h1'),message=document.querySelector('#auth-message'),intro=document.querySelector('#auth-intro');
let challenge='',resetToken=new URL(location.href).searchParams.get('token')||'';
if(resetToken)history.replaceState(null,'',location.pathname);
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
function notice(text,failed=false){message.textContent=text;message.setAttribute('role',failed?'alert':'status');}
async function api(path,body){const r=await fetch('/api/auth/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Sign-in service is unavailable. Try again.');const data=await r.json();if(!r.ok){const e=Error(typeof data.error==='string'?data.error:'Unable to continue. Try again.');e.code=data.code;e.status=r.status;throw e;}return data;}
function form(title,description,fields,submitText,action){
 heading.textContent=title;intro.textContent=description;root.replaceChildren();notice('');document.querySelector('#auth-back').hidden=title==='Sign in';
 const f=el('form'),inputs={};f.method='post';
 for(const [name,label,type='text',autocomplete='off']of fields){
  const l=el('label',label),i=el('input');i.id=i.name=name;i.type=type;i.required=true;i.autocomplete=autocomplete;i.maxLength=type==='password'?128:254;l.htmlFor=name;f.append(l);inputs[name]=i;
  if(type==='password'){
   i.spellcheck=false;i.setAttribute('autocapitalize','none');if(autocomplete==='new-password')i.minLength=8;
   const group=el('div'),toggle=el('button','Show');group.className='auth-password';toggle.type='button';toggle.className='secondary';toggle.setAttribute('aria-controls',name);toggle.setAttribute('aria-label','Show '+label.toLowerCase());
   toggle.onclick=()=>{const show=i.type==='password';i.type=show?'text':'password';toggle.textContent=show?'Hide':'Show';toggle.setAttribute('aria-label',(show?'Hide ':'Show ')+label.toLowerCase());};
   group.append(i,toggle);f.append(group);
  }else f.append(i);
 }
 const button=el('button',submitText);button.type='submit';f.append(button);root.append(f);
 f.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;f.setAttribute('aria-busy','true');notice('Working…');try{await action(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value])));}catch(e){notice(e.message,true);}finally{button.disabled=false;f.removeAttribute('aria-busy');}};
 (Object.values(inputs)[0]||heading).focus();return f;
}
function link(text,action){const b=el('button',text);b.type='button';b.className='secondary';b.onclick=action;root.append(b);}
async function enter(){
 const r=await fetch('/api/me',{credentials:'same-origin'});if(r.ok){location.replace('/');return;}
 if(r.status===403){const u=await api('me');if(u.mfaEnrollmentRequired){enroll();return;}throw Error('This account does not have workspace access. Contact your administrator.');}
 throw Error(r.status===401?'Your session expired. Sign in again.':'The workspace is unavailable. Try again.');
}
function login(){
 challenge='';form('Sign in','Use your existing Ashbi account.',[['email','Email address','email','username'],['password','Password','password','current-password']],'Sign in',async values=>{
  const data=await api('login',{email:values.email.trim().toLowerCase(),password:values.password});document.querySelector('#password').value='';
  if(data.mfaRequired){challenge=data.challengeToken;secondFactor();}else if(data.user?.mfaEnrollmentRequired)enroll();else await enter();
 });link('Forgot password?',forgot);
}
function secondFactor(recovery=false){
 form('Verify your sign-in',recovery?'Enter one of your saved recovery codes.':'Enter the current code from your authenticator app.',[[recovery?'recoveryCode':'code',recovery?'Recovery code':'Authentication code','text',recovery?'off':'one-time-code']],'Verify',async value=>{await api('login/mfa',{challengeToken:challenge,...value});challenge='';await enter();});
 link(recovery?'Use an authenticator code':'Use a recovery code',()=>secondFactor(!recovery));
}
function forgot(){form('Reset your password','We’ll send instructions if an active account matches this email.',[['email','Email address','email','username']],'Send reset instructions',async values=>{await api('forgot-password',{email:values.email.trim().toLowerCase()});root.replaceChildren();notice('If an active account matches, password reset instructions will arrive by email.');});}
function reset(){
 if(!resetToken){login();notice('This reset link is incomplete. Request a new link.',true);return;}
 form('Choose a new password','Use 8–128 characters. You can use a password generated by your password manager.',[['newPassword','New password','password','new-password']],'Save password',async values=>{await api('reset-password',{token:resetToken,newPassword:values.newPassword});resetToken='';login();notice('Password updated. Sign in with your new password.');});
}
function enroll(){form('Set up two-factor authentication','Your organization requires an authenticator before you can open the workspace.',[['password','Current password','password','current-password']],'Set up authenticator',async value=>{
 const data=await api('mfa/enroll',value);
 form('Connect your authenticator','Add this setup key to your authenticator app, then enter its current code.',[['code','Authentication code','text','one-time-code']],'Confirm authenticator',async value=>{const result=await api('mfa/confirm',value);root.replaceChildren();heading.textContent='Save your recovery codes';intro.textContent='Store these codes somewhere private. Each works once, if you lose your authenticator.';const codes=el('pre',result.recoveryCodes.join('\n'));codes.className='auth-codes';root.append(codes);notice('Two-factor authentication is enabled.');link('I saved my codes — open workspace',()=>enter().catch(e=>notice(e.message,true)));});
 const key=el('p',data.secret);key.className='auth-codes';key.setAttribute('aria-label','Authenticator setup key');root.prepend(key);
 });}
if(location.pathname==='/reset-password')reset();else if(location.pathname==='/security/two-factor-setup')enroll();else login();
`;
