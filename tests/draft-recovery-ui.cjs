'use strict';
// Native safeStorage, real disk, actual main helpers and sandboxed page. Services
// and wall clock are synthetic; a fresh VM is a main-memory restart simulation.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const drafts=require('../assistant-drafts.cjs'),assistant=require('../task-assistant.cjs');
const output=path.resolve(__dirname,'../test-results/draft-recovery'),profile=path.join(output,'profile'),configFile=path.join(output,'config.json');
app.setPath('userData',profile);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],errors=[],check=(v,n)=>{assert(v,n);checks.push(n);};
let api,context,win,ready=false,posts=0,modelCalls=0,configWrites=0,failRemove=false,failRename=false,source='live',failed=[],clock=new Date(2026,9,29,15,0),writeResult={ok:true,id:'synthetic-created',projectId:'research'};
const projects=[{id:'research',name:'合成科研清单'},{id:'life',name:'合成生活清单'}];
const dashboard=()=>({source,projects,failedProjectIds:failed,tasks:[]});
class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock.getTime()]));}static now(){return clock.getTime();}}
const io={...fs,rm:async(file,...args)=>{if(failRemove&&String(file).endsWith('assistant-draft.bin'))throw Error('synthetic remove failure');return fs.rm(file,...args);},rename:async(...args)=>{if(failRename)throw Error('synthetic rename failure');return fs.rename(...args);}};
ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));
ipcMain.handle('test:save',async(_e,value)=>{configWrites++;await fs.writeFile(configFile,JSON.stringify(value));return true;});
ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:true}));ipcMain.handle('test:dida-dashboard',dashboard);
for(const [channel,method] of [['status','aiStatus'],['session','aiSessionState'],['manual-draft','aiManualDraft'],['recover','aiRecover'],['create','aiCreate'],['clear','aiClear'],['resolve','aiResolve']])ipcMain.handle('test:assistant-'+channel,(_e,value)=>api[method](value));
ipcMain.on('test:assistant-preview',(_e,value)=>api.aiUpdatePreview(value));ipcMain.on('test:assistant-input',(_e,value)=>api.input(value));
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,value)=>errors.push(value));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const js=code=>win.webContents.executeJavaScript(code,true);
async function settle(){await wait(100);await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function click(selector){const p=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await settle();}
async function shot(name){await settle();await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function reboot(){
  if(api)await api.flush();if(win&&!win.isDestroyed())win.destroy();
  const main=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8'),block=main.slice(main.indexOf('const aiCredentialPath ='),main.indexOf('const taskCompletion =')),protectedFns=main.slice(main.indexOf('async function readProtectedJson('),main.indexOf('async function didaStatus('));
  context=vm.createContext({app,safeStorage,path,fs:io,drafts,mainWindow:null,trialWindow:null,Date:TestDate,AbortController,
    assistant:{...assistant,generate:async()=>{modelCalls++;throw Error('unexpected model request');},createTaskWriter:()=>({create:async()=>{posts++;return {...writeResult};}})},
    DIDA_API_URL:'https://synthetic.invalid/open/v1',didaAuthorization:null,readDidaCredential:async()=>null,readConfig:async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}),latestDidaDashboard:dashboard(),didaRevision:0,queueDidaOperation:fn=>fn(),getDidaDashboard:async()=>dashboard()});
  vm.runInContext(protectedFns+'\n'+block+`\nglobalThis.adapter={aiStatus,aiManualDraft,aiGenerate,aiCreate,aiUpdatePreview,aiRecover,aiClear,aiResolve,aiSessionState,aiSubmissionState,input:value=>aiSession.input=value,flush:()=>draftStorage.flush(),load:async()=>aiRecovery=await draftStorage.load(),seed:value=>{draftStorage.schedule(value);return draftStorage.flush();},latch:value=>writeProtectedJson(aiSubmissionPath(),value)};`,context);api=context.adapter;await api.load();
}
async function open(desktop=false){
  ready=false;win=new BrowserWindow({show:false,width:1440,height:1000,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});context.mainWindow=win;
  win.webContents.on('did-fail-load',(_e,c)=>errors.push('load:'+c));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
  await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{assistantTest:'1',completionTest:'1',...(desktop?{desktop:'1'}:{})}});win.show();win.focus();for(let i=0;i<100&&!ready;i++)await wait(40);check(ready,'page initialized '+(desktop?'desktop style':'ordinary'));await settle();await js('window.confirm=()=>true;void 0');
}
const watchdog=setTimeout(()=>app.exit(1),120000);
(async()=>{
  await fs.mkdir(profile,{recursive:true});await app.whenReady();
  for(const name of ['assistant-draft.bin','assistant-draft.bin.tmp','assistant-submission.bin'])await fs.rm(path.join(profile,name),{force:true});
  await fs.writeFile(configFile,'null');await reboot();await open();await js(`state.scene=SCENES[2];state.didaListIds.research='research';render();homeApi.saveConfig(state)`);await settle();
  check(safeStorage.isEncryptionAvailable(),'native Windows encryption available');
  await click('#aiQuickAdd');await js(`document.querySelector('#aiTitle').value='合成未完便签';document.querySelector('#aiTitle').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#aiContent').value='只在隔离测试中出现';document.querySelector('#aiContent').dispatchEvent(new Event('input',{bubbles:true}))`);await settle();await api.flush();
  const original=(await api.aiSessionState()).preview,bytes=await fs.readFile(path.join(profile,'assistant-draft.bin'));
  check(!bytes.includes(Buffer.from('合成未完便签'))&&!bytes.toString().includes('research'),'draft disk file contains no plaintext title/project');
  const record=JSON.parse(safeStorage.decryptString(bytes));check(record.version===1&&record.preview.task.title==='合成未完便签'&&!('messages' in record)&&!('lastCreated' in record)&&!('key' in record),'encrypted record contains only allowlisted unfinished note');
  const baselineWrites=configWrites;clock=new Date(2026,9,30,9,0);await reboot();await open();
  check(await js(`!document.querySelector('#aiRecovery').hidden&&!document.querySelector('#aiPreviewDialog').open`),'fresh main memory offers recovery without opening a modal');
  check(!(await api.aiSessionState()).preview&&posts===0&&modelCalls===0,'restart has no active/create/AI operation');
  check(!(await api.aiManualDraft({scene:'🔬 科研'})).ok&&!(await api.aiGenerate({scene:'🔬 科研',input:'synthetic'})).ok,'unresolved recovery cannot be silently replaced by manual or AI draft');
  await shot('recovery-offer');source='cache';context.latestDidaDashboard=dashboard();await click('#aiRecover');check((await api.aiSessionState()).recovery!==null,'offline recovery denied with encrypted copy retained');
  source='partial';failed=['research'];context.latestDidaDashboard=dashboard();await click('#aiRecover');
  const restored=(await api.aiSessionState()).preview;
  check(restored.recovered&&restored.id!==original.id&&restored.task.date==='2026-10-29','restore gives new identity and preserves original absolute date across midnight');
  check(restored.task.projectId===''&&restored.projects.length===1,'failed/missing target requires fresh explicit list selection');
  check(await js(`document.querySelector('#aiPreviewDialog').open&&!document.querySelector('#aiNoteEditor').hidden&&!document.querySelector('#aiRecoveryReviewed').checked&&document.querySelector('#aiPreviewContext').textContent.includes('并未改为今天')`),'recovered editor explains old date and requires unchecked review');
  check(!(await api.aiCreate({id:restored.id,revision:restored.revision,task:restored.task})).ok&&posts===0,'main blocks recovered submission without review');
  await js(`document.querySelector('#aiProject').value='life';document.querySelector('#aiProject').dispatchEvent(new Event('change',{bubbles:true}))`);await settle();
  await click('#aiCreate');check(posts===0&&await js(`document.querySelector('#aiCreateStatus').textContent.includes('勾选')`),'native submit cannot bypass review');
  await js(`document.querySelector('#aiProject').value='life';document.querySelector('#aiProject').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#aiDate').value='2026-10-30';document.querySelector('#aiDate').dispatchEvent(new Event('input',{bubbles:true}))`);await settle();await click('#aiRecoveryReviewed');
  await js(`document.querySelector('#aiContent').value='重新核对的说明';document.querySelector('#aiContent').dispatchEvent(new Event('input',{bubbles:true}))`);check(await js(`!document.querySelector('#aiRecoveryReviewed').checked`),'editing reviewed fields invalidates prior acknowledgement');
  await click('#aiRecoveryReviewed');await shot('recovered-editor');await click('#aiCreate');check(posts===1&&!(await api.aiSessionState()).preview,'one explicit reviewed submission succeeds');
  check(await fs.stat(path.join(profile,'assistant-draft.bin')).then(()=>false,e=>e.code==='ENOENT'),'success removes encrypted recovery copy');
  await reboot();await open();check(!(await api.aiSessionState()).recovery&&posts===1,'successful task is not offered again after restart');
  source='live';failed=[];context.latestDidaDashboard=dashboard();await click('#aiQuickAdd');await js(`document.querySelector('#aiTitle').value='';document.querySelector('#aiTitle').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#aiTime').value='';document.querySelector('#aiContent').value='尚未填写完成';document.querySelector('#aiContent').dispatchEvent(new Event('input',{bubbles:true}))`);await settle();await reboot();await open(true);
  check((await api.aiSessionState()).recovery.preview.task.title==='','incomplete blank-title edits survive restart');
  await js('window.confirm=()=>false;void 0');await click('#aiDiscardRecovery');check(Boolean((await api.aiSessionState()).recovery),'discard cancellation preserves old copy');await js('window.confirm=()=>true;void 0');await click('#aiDiscardRecovery');await reboot();await open();check(!(await api.aiSessionState()).recovery,'explicit discard stays discarded after restart');
  await api.seed(original);await api.load();await api.latch({uncertain:true,requestId:original.id});await reboot();await open();check(await js(`document.querySelector('#aiRecover').disabled&&!document.querySelector('#aiResolve').hidden`),'uncertain result takes priority over recoverable draft');check(!(await api.aiRecover({action:'restore'})).ok&&posts===1,'uncertain recovery never repeats old write');
  failRemove=true;await assert.rejects(api.aiResolve());check((await api.aiSubmissionState()).uncertain,'failed copy deletion cannot clear uncertainty latch');failRemove=false;await api.aiResolve();await reboot();await open();check(!(await api.aiSessionState()).recovery&&!(await api.aiSubmissionState()).uncertain,'explicit resolve clears old draft before reopening writes');
  await api.aiManualDraft({scene:'🔬 科研',title:'合成删除失败'});await api.flush();const beforeFailure=(await api.aiSessionState()).preview;failRemove=true;
  const success=await api.aiCreate({id:beforeFailure.id,revision:beforeFailure.revision,task:beforeFailure.task});check(success.ok&&success.warning.includes('恢复副本')&&(await api.aiSubmissionState()).uncertain,'successful remote write plus local cleanup failure keeps crash latch');failRemove=false;
  await reboot();check((await api.aiSessionState()).recovery&&(await api.aiSessionState()).uncertain,'cleanup-failure restart cannot create duplicate');await api.aiResolve();
  // Real queued storage operations, independent from UI and no plaintext fallback.
  const disk=path.join(profile,'queue-test.bin');let renames=0;const store=drafts.createStore({fs:{...fs,rename:async(...a)=>{renames++;return fs.rename(...a);}},path,safeStorage,file:disk,delay:50});
  for(let i=0;i<40;i++)store.schedule({...original,task:{...original.task,title:'burst-'+i}});await store.flush();check(renames===1&&(await store.load()).preview.task.title==='burst-39','forty rapid edits coalesce into one latest-note write');
  store.schedule(original);await store.clear();await wait(100);check(await store.load()===null,'queued old edit cannot resurrect a cleared draft');
  let writing=false;const statuses=[];
  const racing=drafts.createStore({fs:{...fs,rename:async(...args)=>{writing=true;await wait(80);return fs.rename(...args);}},path,safeStorage,file:disk,delay:500,onStatus:s=>statuses.push(s.state)});
  racing.schedule(original);const oldFlush=racing.flush();for(let i=0;i<20&&!writing;i++)await wait(5);
  racing.schedule({...original,task:{...original.task,title:'latest concurrent edit'}});await oldFlush;
  check(racing.status().state==='pending'&&!statuses.includes('saved'),'older save cannot claim newer unsaved editing is saved');
  await racing.flush();check((await racing.load()).preview.task.title==='latest concurrent edit'&&racing.status().state==='saved','latest concurrent edit is eventually saved and reported');await racing.clear();
  const failedStore=drafts.createStore({fs:{...fs,rename:async()=>{throw Error('synthetic');}},path,safeStorage,file:disk,delay:50});failedStore.schedule(original);check(!await failedStore.flush()&&failedStore.status().state==='error','atomic rename failure is reported');
  const noEncryption=drafts.createStore({fs,path,safeStorage:{isEncryptionAvailable:()=>false},file:disk});noEncryption.schedule(original);check(!await noEncryption.flush(),'encryption unavailable never writes plaintext');
  await fs.writeFile(disk,'corrupt');check((await store.load()).unreadable,'corrupted draft offers safe discard without crashing');await store.clear();
  await fs.writeFile(path.join(profile,'assistant-draft.bin'),'corrupt');await reboot();await open();check(await js(`document.querySelector('#aiRecover').disabled&&document.querySelector('#aiRecovery').textContent.includes('无法解密')`),'unreadable record keeps homepage usable with explicit discard');await click('#aiDiscardRecovery');
  check(configWrites===baselineWrites,'recovery, review and task submission never write layout config');
  check(modelCalls===0&&posts===2,'all recovery tests make zero AI calls and only two explicit synthetic writes');
  for(const theme of ['warm','peach','night']){await js(`state.theme='${theme}';render()`);await settle();for(const width of [1440,900,390,320]){win.setContentSize(width,900);await settle();check(await js('document.documentElement.scrollWidth<=innerWidth+1'),theme+' no horizontal overflow '+width);}}
  check(errors.length===0,'no observed load, renderer or unhandled page errors');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,errors,posts,modelCalls,configWrites,pageLoaded:true,limits:['VM restart is a main-memory simulation; portable test separately verifies real process restart.','No real account, native desktop mount, physical sleep, DPI or system notification delivery.']},null,2));
  clearTimeout(watchdog);await api.flush();win.destroy();app.exit(0);
})().catch(async e=>{console.error(e);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:String(e.stack)},null,2));app.exit(1);});
