// Shared presentation helpers. Persisted values and route permissions stay in their workflows.
export const presentationUiScript=String.raw`
 const taskStatusNames=Object.freeze({todo:'To do',doing:'In progress',review:'Review',waiting:'Waiting',later:'Later',done:'Done',retired:'Retired',archived:'Archived'});
 const projectStatusNames=Object.freeze({planned:'Planned',active:'Active',waiting:'Waiting',complete:'Complete',canceled:'Canceled'});
 function recordStatusName(page,value){
  const names=page==='tasks'?taskStatusNames:page==='projects'?projectStatusNames:{};
  return Object.hasOwn(names,value)?names[value]:value;
 }
 function revealCurrentNavigation(){
  const nav=document.querySelector('nav[aria-label="Workspace"]');
  const active=nav?.querySelector('a[aria-current="page"]:not([hidden])');
  if(!active||nav.scrollWidth<=nav.clientWidth)return;
  const viewport=nav.getBoundingClientRect(),item=active.getBoundingClientRect();
  // Scroll only the horizontal strip; never move the document or steal focus.
  const left=viewport.left+8,right=viewport.right-8;
  if(item.left<left)nav.scrollLeft+=item.left-left;
  else if(item.right>right)nav.scrollLeft+=item.right-right;
 }
`;
