'use strict';
// Local-only selections, references and active focus time. Never a Dida task writer.
const crypto=require('node:crypto');
const copy=v=>JSON.parse(JSON.stringify(v));
const id=v=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v);
function dayKey(at=Date.now()){const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function validDay(day){if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const d=new Date(day+'T12:00:00');return dayKey(d.valueOf())===day;}
function taskRef(value){if(!id(value?.id)||!id(value?.projectId))throw Error('任务标识无效。');return {id:value.id,projectId:value.projectId};}
function key(t){return JSON.stringify([t.projectId,t.id]);}
function occurrence(t){return JSON.stringify([t.id,t.projectId,t.dueDate||null,t.startDate||null,t.repeatFlag||null]);}
function splitTime(end,ms){
  const out=[];let start=end-ms;
  while(start<end){const d=new Date(start),next=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).valueOf(),stop=Math.min(end,next);if(stop<=start)break;out.push({day:dayKey(start),ms:stop-start});start=stop;}
  return out;
}
function validate(data){
  if(data?.version!==1||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.plans)||data.plans.length>31||!Array.isArray(data.resources)||data.resources.length>500||!Array.isArray(data.sessions)||data.sessions.length>2000)throw Error('本地记录格式无法读取。');
  for(const p of data.plans){if(!validDay(p.day)||!Array.isArray(p.tasks)||p.tasks.length>3)throw Error('Invalid plan');const seen=new Set();for(const t of p.tasks){taskRef(t);if(seen.has(key(t))||typeof t.title!=='string'||t.title.length>1000||typeof t.occurrence!=='string'||t.occurrence.length>1000)throw Error('Invalid plan task');seen.add(key(t));}}
  for(const r of data.resources){taskRef(r);if(!Array.isArray(r.items)||r.items.length>8)throw Error('Invalid resources');for(const item of r.items){if(!id(item.id)||typeof item.name!=='string'||item.name.length>100)throw Error('Invalid resource');if(item.entryId){if(typeof item.entryId!=='string'||item.entryId.length>200)throw Error('Invalid entry');}else if(!['website','application','file','folder'].includes(item.kind)||typeof item.target!=='string'||item.target.length>4096)throw Error('Invalid target');}}
  for(const s of data.sessions){if(!id(s.id)||!Number.isFinite(s.startedAt)||!Number.isFinite(s.plannedMs)||s.plannedMs<1||s.plannedMs>7200000||!Number.isFinite(s.activeMs)||s.activeMs<0||s.activeMs>s.plannedMs||!Array.isArray(s.days)||s.days.length>100||!['running','paused','completed','interrupted'].includes(s.status))throw Error('Invalid session');if(s.task){taskRef(s.task);if(typeof s.task.title!=='string'||s.task.title.length>1000)throw Error('Invalid session task');}if(s.days.some(d=>!validDay(d.day)||!Number.isFinite(d.ms)||d.ms<0)||Math.abs(s.days.reduce((sum,d)=>sum+d.ms,0)-s.activeMs)>1)throw Error('Invalid session days');}
  return data;
}
function createStore({fs,path,safeStorage,file,now=Date.now,onChange=()=>{},delay=15000}){
  let data={version:1,revision:0,plans:[],resources:[],sessions:[]},tail=Promise.resolve(),dirty=false,timer=null,loaded=false,readOnly=false,error='',writing=false;
  const prefix=crypto.randomUUID();
  const dest=()=>typeof file==='function'?file():file;
  async function ordinary(target){const absolute=path.resolve(target);let current=path.parse(absolute).root;for(const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Linked storage rejected');}catch(e){if(e.code==='ENOENT')break;throw e;}}}
  function snapshot(){const value=copy(data);for(const r of value.resources)for(const item of r.items)delete item.target;return {ok:!readOnly,loaded,readOnly,message:error,...value,today:dayKey(now())};}
  function signal(){try{onChange({revision:data.revision,message:error});}catch{}}
  function changed(){data.revision++;dirty=true;}
  async function write(){
    if(!dirty||readOnly)return !dirty;
    writing=true;const revision=data.revision;
    try{const text=JSON.stringify(data);if(Buffer.byteLength(text)>2097152)throw Error('Record size limit');if(!safeStorage.isEncryptionAvailable())throw Error('Encryption unavailable');const bytes=safeStorage.encryptString(text),target=dest();await ordinary(target);await ordinary(target+'.tmp');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target+'.tmp',bytes);await fs.rename(target+'.tmp',target);if(data.revision===revision)dirty=false;error='';return true;}
    catch{error='本地记录尚未保存，请稍后重试；已有文件保留。';signal();return false;}finally{writing=false;}
  }
  function enqueue(work){const p=tail.then(work);tail=p.catch(()=>{});return p;}
  function schedule(){if(timer||readOnly)return;timer=setTimeout(()=>{timer=null;void enqueue(write);},delay);timer.unref?.();}
  async function flush(){clearTimeout(timer);timer=null;return enqueue(write);}
  async function load(){
    try{await ordinary(dest());const stat=await fs.stat(dest());if(stat.size>2097152||!safeStorage.isEncryptionAvailable())throw Error('Unavailable');data=validate(JSON.parse(safeStorage.decryptString(await fs.readFile(dest()))));for(const s of data.sessions)if(['running','paused'].includes(s.status)){s.status='interrupted';s.reason='restart';changed();}if(dirty)await write();}
    catch(e){if(e.code!=='ENOENT'){readOnly=true;error='本地记录暂时无法读取，原文件已保留；本轮不覆盖。';}}
    loaded=true;return snapshot();
  }
  function prune(){data.plans.sort((a,b)=>a.day.localeCompare(b.day));data.plans=data.plans.slice(-31);data.sessions=data.sessions.filter(s=>s.startedAt>=now()-90*86400000).slice(-2000);}
  async function change(action,value={}){return enqueue(async()=>{
    if(!loaded||readOnly)return {ok:false,message:error||'记录尚未就绪。'};
    const previous=copy(data),today=dayKey(now());
    const rollback=()=>{const sessions=action==='clear-history'?[...new Map([...previous.sessions,...data.sessions].map(s=>[s.id,s])).values()]:data.sessions;data={...previous,sessions,revision:Math.max(previous.revision,data.revision)+1};signal();};
    try{
      let plan=data.plans.find(p=>p.day===today);
      if(['pin','unpin','carry','dismiss-carry'].includes(action)&&!plan){plan={day:today,tasks:[],dismissedCarry:false};data.plans.push(plan);}
      if(action==='pin'){
        const t=taskRef(value);if(!plan.tasks.some(x=>key(x)===key(t))){if(plan.tasks.length>=3)throw Error('今日重点最多三件，先移除一项再添加吧。');plan.tasks.push({...t,title:String(value.title||'任务').slice(0,1000),occurrence:occurrence(value),completedAt:null});}
      }else if(action==='unpin'){const t=taskRef(value);plan.tasks=plan.tasks.filter(x=>key(x)!==key(t));}
      else if(action==='carry'){const old=data.plans.filter(p=>p.day<today).at(-1);for(const t of old?.tasks||[])if(!t.completedAt&&!plan.tasks.some(x=>key(x)===key(t))&&plan.tasks.length<3)plan.tasks.push(copy(t));plan.dismissedCarry=true;}
      else if(action==='dismiss-carry')plan.dismissedCarry=true;
      else if(action==='complete'){const t=taskRef(value);for(const p of data.plans)for(const x of p.tasks)if(key(x)===key(t)&&x.occurrence===value.occurrence)x.completedAt=now();}
      else if(action==='add-resource'){
        const t=taskRef(value);let r=data.resources.find(x=>key(x)===key(t));if(!r){if(data.resources.length>=500)throw Error('资料关联数量已达上限。');r={...t,items:[]};data.resources.push(r);}if(r.items.length>=8)throw Error('每项任务最多关联八份资料。');
        const item={...value.resource,id:crypto.randomUUID()};if(r.items.some(x=>item.entryId?x.entryId===item.entryId:x.kind===item.kind&&x.target===item.target))throw Error('这份资料已经关联了。');r.items.push(item);
      }else if(action==='remove-resource'){const t=taskRef(value),r=data.resources.find(x=>key(x)===key(t));if(r)r.items=r.items.filter(x=>x.id!==value.resourceId);data.resources=data.resources.filter(r=>r.items.length);}
      else if(action==='clear-history'){if(value.confirm!==true)throw Error('请先确认清空记录。');data.sessions=data.sessions.filter(s=>['running','paused'].includes(s.status));}
      else throw Error('无效本地操作。');
      prune();validate(data);if(JSON.stringify(previous)===JSON.stringify(data))return {ok:true,state:snapshot()};changed();
      if(!await write()){rollback();dirty=true;return {ok:false,message:error};}signal();return {ok:true,state:snapshot()};
    }catch(e){rollback();return {ok:false,message:e.message};}
  });}
  function record(event){
    if(!loaded||readOnly||!Number.isSafeInteger(event?.round)||event.round<1)return;
    const identity=prefix+'-'+event.round;let session=data.sessions.find(s=>s.id===identity);
    if(!session){session={id:identity,task:event.task?copy(event.task):null,startedAt:event.startedAt,plannedMs:event.plannedMs,activeMs:0,days:[],status:'running'};data.sessions.push(session);}
    const delta=Math.max(0,Math.min(event.activeMs-session.activeMs,event.plannedMs-session.activeMs));
    const changedStatus=session.status!==event.status;
    if(delta===0&&!changedStatus&&session.updatedAt)return;
    for(const part of splitTime(event.at,delta)){const bucket=session.days.find(d=>d.day===part.day);if(bucket)bucket.ms+=part.ms;else session.days.push(part);}
    session.activeMs+=delta;session.status=event.status;session.updatedAt=event.at;if(['completed','interrupted'].includes(event.status)){session.endedAt=event.at;session.reason=event.reason||'';}else{delete session.endedAt;delete session.reason;}
    changed();prune();schedule();if(event.status!=='running'){void flush();signal();}
  }
  function rawResource(t,resourceId){const r=data.resources.find(x=>key(x)===key(t));return r?.items.find(x=>x.id===resourceId);}
  return {load,snapshot,change,record,flush,rawResource,status:()=>({dirty,writing,readOnly,error})};
}
function createActions({store,getTask,readConfig,validateEntry,launchEntry}){
  return {
    async change(value){
      const action=value?.action;
      if(['carry','dismiss-carry','clear-history'].includes(action))return store.change(action,value);
      const ref=taskRef(value);
      if(['unpin','remove-resource'].includes(action))return store.change(action,value);
      const task=await getTask(ref);if(!task)return {ok:false,message:'任务暂未读取到，请先刷新任务。'};
      if(action==='pin')return store.change(action,task);
      if(action!=='add-resource')return {ok:false,message:'无效本地操作。'};
      const source=value.resource;let resource;
      if(typeof source?.entryId==='string'){
        const config=await readConfig(),entry=config?.library?.[source.entryId];
        if(!entry||!['application','folder','file','website'].includes(entry.kind)||!entry.target)return {ok:false,message:'这个入口尚未设置或已移除。'};
        resource={entryId:source.entryId,name:String(entry.name||'关联入口').slice(0,100)};
      }else{
        const checked=await validateEntry(source);if(!checked.ok)return {ok:false,message:checked.error};
        if(!['application','folder','file','website'].includes(checked.kind))return {ok:false,message:'请选择资料类型。'};
        resource={kind:checked.kind,target:checked.target,name:String(source.name||'关联资料').trim().slice(0,100)||'关联资料'};
      }
      return store.change(action,{...ref,resource});
    },
    async open(value){
      const ref=taskRef(value),resource=store.rawResource(ref,value.resourceId);
      if(!resource)return {ok:false,message:'资料关联已移除，请重新选择。'};
      const entry=resource.entryId?(await readConfig())?.library?.[resource.entryId]:resource;
      if(!entry)return {ok:false,message:'关联入口已移除，请重新关联。'};
      const result=await launchEntry(entry);return result.ok?result:{ok:false,message:result.error};
    }
  };
}
module.exports={createStore,createActions,dayKey,validDay,taskRef,key,occurrence,splitTime,validate};
