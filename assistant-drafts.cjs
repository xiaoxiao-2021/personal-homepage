'use strict';
// One bounded, encrypted unfinished note. Chat history, keys and receipts are excluded.
function note(value) {
  if(!value||typeof value!=='object'||typeof value.id!=='string'||!/^[\w-]{1,128}$/.test(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('Invalid draft');
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Invalid draft field');return v;};
  if(!Array.isArray(value.projects)||value.projects.length>500||!value.task)throw Error('Invalid draft');
  const projects=value.projects.map(p=>({id:text(p.id,128),name:text(p.name,200)}));
  if(projects.some(p=>!/^[A-Za-z0-9_-]+$/.test(p.id)))throw Error('Invalid project');
  const task={};for(const field of ['title','projectId','content','date','time','dateKind'])task[field]=text(value.task[field],field==='content'?4000:200);
  task.isAllDay=value.task.isAllDay===true;
  return {id:value.id,revision:value.revision,scene:text(value.scene,100),projects,timeZone:text(value.timeZone,100),sentAt:text(value.sentAt,100),source:value.source==='manual'?'manual':'ai',previousCreated:value.previousCreated===true,task};
}
function createStore({fs,path,safeStorage,file,delay=450,onStatus=()=>{}}) {
  let timer=null,pending,tail=Promise.resolve(),state='idle',generation=0;
  const emit=next=>{state=next;try{onStatus({state});}catch{/* A closing page must not change disk-save success. */}};
  const destination=()=>typeof file==='function'?file():file;
  async function ordinary(target){try{if((await fs.lstat(target)).isSymbolicLink())throw Error('Draft link rejected');}catch(e){if(e.code!=='ENOENT')throw e;}}
  async function write(value,revision){
    const target=destination(),temporary=target+'.tmp';await ordinary(target);await ordinary(temporary);
    if(value===null){await fs.rm(target,{force:true});await fs.rm(temporary,{force:true});if(revision===generation)emit('empty');return;}
    if(!safeStorage.isEncryptionAvailable())throw Error('Encryption unavailable');
    const bytes=safeStorage.encryptString(JSON.stringify(value));
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,bytes);await fs.rename(temporary,target);if(revision===generation)emit('saved');
  }
  function enqueue(){
    if(pending===undefined)return;const value=pending;pending=undefined;
    tail=tail.catch(()=>{}).then(()=>write(value.value,value.revision)).catch(()=>{if(value.revision===generation)emit('error');});
  }
  function schedule(preview){
    pending={revision:++generation,value:preview?{version:1,savedAt:new Date().toISOString(),preview:note(preview)}:null};
    if(preview&&state!=='pending')emit('pending');
    clearTimeout(timer);timer=setTimeout(()=>{timer=null;enqueue();},delay);timer.unref?.();
  }
  async function flush(){clearTimeout(timer);timer=null;enqueue();await tail;return state!=='error';}
  async function clear(){schedule(null);if(!await flush())throw Error('Draft removal failed');}
  async function load(){
    try{
      const target=destination();await ordinary(target);const size=(await fs.stat(target)).size;if(size>262144)throw Error('Draft too large');
      if(!safeStorage.isEncryptionAvailable())throw Error('Encryption unavailable');
      const value=JSON.parse(safeStorage.decryptString(await fs.readFile(target)));
      if(value.version!==1||typeof value.savedAt!=='string'||!Number.isFinite(Date.parse(value.savedAt)))throw Error('Invalid draft record');
      return {preview:note(value.preview),savedAt:value.savedAt};
    }catch(e){if(e.code==='ENOENT')return null;return {unreadable:true};}
  }
  return {schedule,flush,clear,load,status:()=>({state})};
}
module.exports={createStore,note};
