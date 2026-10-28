// Project navigation composes existing workflows; authorization stays in their APIs.
export const projectUiScript = String.raw`
 const projectSections = Object.freeze({overview:'Overview',tasks:'Tasks',notes:'Documents',files:'Files',time:'Time',billing:'Billing'});
 function projectRoute(parts,key){
  if(parts[0]!=='projects'||parts.length===1)return null;
  const section=parts[2]||'overview';
  const taskId=parts.length===4&&section==='tasks'&&/^[a-zA-Z0-9-]{1,100}$/.test(parts[3]);
  if(parts.length>3&&!taskId||!/^[a-zA-Z0-9-]{1,100}$/.test(parts[1]||'')||!Object.hasOwn(projectSections,section))return {page:'projects',key,linkError:true};
  return {page:section==='overview'?'projects':section==='billing'?'finance':section,key,projectId:parts[1],projectSection:section,...(taskId?{recordId:parts[3]}:{})};
 }
 function projectHref(id,section='overview'){return '#projects/'+encodeURIComponent(id)+(section==='overview'?'':'/'+section);}
 function projectField(select,id){
  if(!select||!id)return;
  for(const option of [...select.options])if(option.value!==id)option.remove();
  select.value=id;
 }
 function filesPath(state,cursor){
  const params=new URLSearchParams();
  if(actor.role==='staff')params.set('includeDeleted','true');
  if(state.projectId)params.set('projectId',state.projectId);
  if(cursor)params.set('after',cursor);
  return 'files'+(params.size?'?'+params:'');
 }
 function projectHeader(state){
  const project=state.project;
  const header=node('section',undefined,'project-header');
  const back=node('a','All projects');back.href='#projects';
  header.append(back,node('h1',project.name));
  const meta=node('div',undefined,'row');
  meta.append(node('span',recordStatusName('projects',project.status),'badge'),node('span',project.client_visible?'Shared with client':'Internal','badge'));
  if(project.archived)meta.append(node('span','Archived project','badge'));
  header.append(meta);
  const tabs=node('div',undefined,'project-tabs');tabs.setAttribute('role','navigation');tabs.setAttribute('aria-label','Project sections');
  for(const [section,label]of Object.entries(projectSections)){
   if(section==='time'&&actor.role!=='staff'||section==='billing'&&!(actor.role==='staff'&&actor.features.finance)||section==='files'&&!actor.features.files)continue;
   const link=recordRouteLink(projectHref(project.id,section),label,label);
   if(section===state.projectSection)link.setAttribute('aria-current','page');
   tabs.append(link);
  }
  header.append(tabs);main.append(header);
 }
 function projectOverview(state){
  const panel=node('section',undefined,'panel');panel.append(node('h2','Project overview'),node('p','Keep tasks, documents, files and time together for this project.'));
  panel.append(recordItem(state.project,state));main.append(panel);updateTimerControls();
 }
`;
