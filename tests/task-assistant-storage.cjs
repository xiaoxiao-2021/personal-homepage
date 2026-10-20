'use strict';
// Executes the actual main-process adapter functions in an isolated context.
// Native Windows safeStorage + real disk; synthetic Dida/AI transports only.
const {app,safeStorage}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const core=require('../task-assistant.cjs');
const output=path.resolve(__dirname,'../test-results/task-assistant-storage');app.setPath('userData',path.join(output,'profile'));
const checks=[];let renameFails=false,writerCalls=0,writeResult={ok:true,id:'synthetic-id',projectId:'clinical'};
const check=(v,name)=>{assert(v,name);checks.push(name);};
(async()=>{
  await fs.mkdir(output,{recursive:true});await app.whenReady();
  const source=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8');
  const block=source.slice(source.indexOf('const aiCredentialPath ='),source.indexOf('const taskCompletion ='));
  const protectedFns=source.slice(source.indexOf('async function readProtectedJson('),source.indexOf('async function didaStatus('));
  const projects=[{id:'clinical',name:'合成临床'}];const dashboard={source:'live',projects,tasks:[],failedProjectIds:[]};
  const context=vm.createContext({app,safeStorage,path,fs:{...fs,rename:async(...args)=>{if(renameFails)throw Error('synthetic rename fail');return fs.rename(...args);}},AbortController,
    assistant:{...core,generate:async()=>({ok:true,kind:'draft',message:'核对',task:{title:'合成任务',projectId:'clinical',content:'',date:'',time:'',dateKind:'due',isAllDay:true}}),createTaskWriter:()=>({create:async()=>{writerCalls++;await new Promise(r=>setTimeout(r,40));return writeResult;}})},
    DIDA_API_URL:'https://api.dida365.com/open/v1',didaAuthorization:null,readDidaCredential:async()=>null,readConfig:async()=>({config:{scenes:{'🏥 临床':{}},didaListIds:{clinical:'clinical'}}}),latestDidaDashboard:dashboard,didaRevision:0,queueDidaOperation:async fn=>fn(),getDidaDashboard:async()=>dashboard
  });
  vm.runInContext(protectedFns+'\n'+block+'\nglobalThis.adapter={aiStatus,aiSaveSettings,aiGenerate,aiCreate,aiSubmissionState,readProtectedJson,writeProtectedJson,aiCredentialPath,aiSubmissionPath};',context);
  const api=context.adapter;
  check(safeStorage.isEncryptionAvailable(),'native Windows encryption available in isolated profile');
  const saved=await api.aiSaveSettings({key:'synthetic-first-key',model:'deepseek-flash'});check(saved.ok,'actual encrypted adapter save succeeds');
  const bytes=await fs.readFile(api.aiCredentialPath());check(!bytes.toString().includes('synthetic-first-key'),'encrypted file contains no plaintext test key');
  const status=await api.aiStatus();check(status.configured&&!JSON.stringify(status).includes('synthetic-first-key'),'status returns presence/model only');
  renameFails=true;check(!(await api.aiSaveSettings({key:'synthetic-second-key',model:'deepseek-v4-pro'})).ok,'write failure reported');renameFails=false;
  check((await api.readProtectedJson(api.aiCredentialPath())).key==='synthetic-first-key','failed replacement preserves old key');
  await api.writeProtectedJson(api.aiSubmissionPath(),{uncertain:false});
  const generatedPair=await Promise.all([api.aiGenerate({scene:'🏥 临床',input:'合成任务'}),api.aiGenerate({scene:'🏥 临床',input:'重复请求'})]);
  check(generatedPair.filter(r=>r.ok).length===1,'adapter locks generation before asynchronous preflight');
  const generated=generatedPair.find(r=>r.ok);check(generated.preview.projects[0].id==='clinical','adapter freezes real candidate snapshot for draft');
  const createArgs={id:generated.preview.id,revision:generated.preview.revision,task:generated.task};
  const results=await Promise.all([api.aiCreate(createArgs),api.aiCreate(createArgs)]);check(results.filter(r=>r.ok).length===1&&writerCalls===1,'adapter serializes duplicate create calls');
  check(!(await api.aiSubmissionState()).uncertain,'acknowledged creation clears persisted crash latch');
  writeResult={ok:false,code:'uncertain',message:'synthetic timeout'};
  const second=await api.aiGenerate({scene:'🏥 临床',input:'另一项合成任务'});await api.aiCreate({id:second.preview.id,revision:second.preview.revision,task:second.task});
  check((await api.aiSubmissionState()).uncertain,'uncertain creation retains encrypted restart latch');
  check(!(await api.aiGenerate({scene:'🏥 临床',input:'不要重复'})).ok,'uncertain latch blocks subsequent generation');
  await fs.writeFile(api.aiSubmissionPath(),Buffer.from('synthetic-corruption'));check((await api.aiSubmissionState()).uncertain,'corrupt submission record fails closed');
  check((await api.aiSaveSettings({remove:true})).ok&&!(await api.aiStatus()).configured,'remove affects only AI credential file');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,scope:'Native safeStorage + actual main adapter + isolated disk; synthetic transport, no production keys/tasks.'},null,2));app.exit(0);
})().catch(async error=>{await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,failure:String(error.stack)},null,2));app.exit(1);});
