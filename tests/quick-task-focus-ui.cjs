'use strict';
// Real Electron page and actual main-process helpers. Only remote services,
// notifications and the clock are synthetic; no production data is accessed.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const assistant=require('../task-assistant.cjs'),{createTimer}=require('../pomodoro.cjs');
const output=path.resolve(__dirname,'../test-results/quick-task-focus'),configFile=path.join(output,'config.json');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let api,context,win,ready=false,aiCalls=0,posts=0,gets=0,configWrites=0,credentialReads=0,canWrite=false,remote='ok',source='live',failed=[],delayRead=false;
let clock=new Date(2026,9,29,12,0),elapsed=0,completions=0;const checks=[],errors=[],payloads=[];
class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock.getTime()]));}static now(){return clock.getTime();}}
const projects=[{id:'research',name:'合成科研清单'},{id:'life',name:'合成生活清单'}];
const tasks=[{id:'task-a',projectId:'research',title:'合成阅读任务',status:0},{id:'task-b',projectId:'research',title:'合成整理任务',status:0}];
const dashboard=()=>({source,projects,tasks,failedProjectIds:failed,revision:posts});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(value,label)=>{assert(value,label);checks.push(label);};
const timer=createTimer({settings:{focus:1,break:1},now:()=>clock.getTime()+elapsed,monotonic:()=>elapsed,onComplete:()=>{completions++;push();}});
function push(){if(win&&!win.isDestroyed())win.webContents.send('test:pomo-state',timer.snapshot());}
const updateDashboard=()=>context.latestDidaDashboard=dashboard();
const fetchTask=async(_url,options)=>{
  if(options.method==='POST'){
    posts++;const task=JSON.parse(options.body);payloads.push(task);await wait(130);
    if(remote==='uncertain')throw Error('synthetic timeout');
    return {ok:true,status:200,json:async()=>({id:'created-'+posts,...task})};
  }
  gets++;throw Error('unexpected synthetic read-back');
};
ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));
ipcMain.handle('test:save',async(_e,value)=>{configWrites++;await fs.writeFile(configFile,JSON.stringify(value));return true;});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:canWrite}));ipcMain.handle('test:dida-dashboard',dashboard);
ipcMain.handle('test:assistant-status',()=>api.aiStatus());
ipcMain.handle('test:assistant-session',()=>api.session());
ipcMain.handle('test:assistant-manual-draft',(_e,value)=>api.aiManualDraft(value));
ipcMain.handle('test:assistant-create',(_e,value)=>api.aiCreate(value));
ipcMain.handle('test:assistant-cancel',()=>api.cancel());
ipcMain.handle('test:assistant-clear',()=>api.clear());
ipcMain.handle('test:assistant-resolve',()=>api.resolve());
ipcMain.on('test:assistant-input',(_e,value)=>api.input(value));ipcMain.on('test:assistant-preview',(_e,value)=>api.aiUpdatePreview(value));
ipcMain.handle('test:pomo-state',()=>timer.snapshot());
ipcMain.handle('test:pomo-command',(_e,action)=>{const state=timer.command(action);push();return {ok:true,state};});
ipcMain.handle('test:pomo-focus-task',(_e,value)=>api.startTaskFocus(value));
const watchdog=setTimeout(()=>app.exit(1),100000);
const js=code=>win.webContents.executeJavaScript(code,true);
async function settle(){await wait(100);await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function click(selector){
  const point=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await settle();
}
async function shot(name){await settle();await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function open(desktop=false){
  ready=false;win=new BrowserWindow({show:false,width:1440,height:1050,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('did-fail-load',(_e,c)=>errors.push('load:'+c));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
  await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{assistantTest:'1',completionTest:'1',pomodoroTest:'1',...(desktop?{desktop:'1'}:{})}});win.show();win.focus();for(let i=0;i<100&&!ready;i++)await wait(40);check(ready,'page ready '+(desktop?'desktop style':'ordinary window'));await settle();await js('window.confirm=()=>true;void 0');
}
(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.writeFile(configFile,'null');await app.whenReady();await fs.rm(path.join(app.getPath('userData'),'assistant-submission.bin'),{force:true});
  const main=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8'),block=main.slice(main.indexOf('const aiCredentialPath ='),main.indexOf('const taskCompletion ='));
  const protectedFns=main.slice(main.indexOf('async function readProtectedJson('),main.indexOf('async function didaStatus('));
  context=vm.createContext({drafts:require('../assistant-drafts.cjs'),mainWindow:null,trialWindow:null,app,safeStorage,path,fs:{...fs,readFile:async(file,...rest)=>{if(String(file).endsWith('deepseek-credential.bin'))credentialReads++;return fs.readFile(file,...rest);}},Date:TestDate,AbortController,
    assistant:{...assistant,generate:async()=>{aiCalls++;throw Error('manual flow must not call AI');},createTaskWriter:options=>assistant.createTaskWriter({...options,fetch:fetchTask})},
    DIDA_API_URL:'https://synthetic.invalid/open/v1',didaAuthorization:null,pomodoroSettingsBusy:false,pomodoroTimer:timer,publishPomodoro:push,
    readDidaCredential:async()=>({accessToken:'synthetic-only',scope:canWrite?'tasks:read tasks:write':'tasks:read'}),
    readConfig:async()=>{if(delayRead)await wait(180);return {config:JSON.parse(await fs.readFile(configFile,'utf8'))};},latestDidaDashboard:dashboard(),didaRevision:0,queueDidaOperation:fn=>fn(),getDidaDashboard:async()=>dashboard()});
  vm.runInContext(protectedFns+'\n'+block+`\nglobalThis.adapter={aiStatus,aiManualDraft,aiCreate,aiUpdatePreview,startTaskFocus,session:async()=>({...aiSession,uncertain:(await aiSubmissionState()).uncertain}),input:value=>aiSession.input=value,cancel:()=>{aiController?.abort();return {ok:true};},clear:()=>{if(aiCreating||aiController)return {ok:false};aiDraft=null;aiSession={...aiSession,messages:[],input:'',preview:null};return {ok:true};},resolve:async()=>{await writeProtectedJson(aiSubmissionPath(),{uncertain:false});aiDraft=null;aiSession.preview=null;return {ok:true};}};`,context);api=context.adapter;
  await open();await js(`state.scene=SCENES[2];state.didaListIds.research='research';render();homeApi.saveConfig(state)`);await settle();
  const readsBefore=credentialReads,writesBefore=configWrites;
  await click('#aiQuickAdd');check(await js(`document.querySelector('#aiPreviewDialog').open&&!document.querySelector('#aiNoteEditor').hidden&&document.activeElement.id==='aiTitle'`),'native quick-add opens manual editor in central note');
  const draft=(await api.session()).preview;check(draft.source==='manual'&&draft.task.date==='2026-10-29'&&draft.task.isAllDay&&draft.task.projectId==='research','manual default is local today/all-day and mapped scene list');
  check(aiCalls===0&&posts===0&&credentialReads===readsBefore&&configWrites===writesBefore,'opening manual draft reads no AI key, calls no model/task API and writes no layout');
  check(await js(`document.querySelector('#aiPreviewContext').textContent.includes('不调用 AI')`),'manual note explains default and AI-free behavior');await shot('manual-editor');
  await click('#aiCreate');check(posts===0&&await js(`document.querySelector('#aiTitle').matches(':invalid')`),'empty required title cannot submit');
  await js(`document.querySelector('#aiTitle').value='合成手动任务';document.querySelector('#aiTitle').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#aiAllDay').checked=false;document.querySelector('#aiAllDay').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#aiTime').value='15:30';document.querySelector('#aiTime').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('#aiCreate');check(posts===0&&await js(`document.querySelector('#aiCreateStatus').textContent.includes('只读')`),'read-only scope retains draft and makes no request');
  canWrite=true;await js(`document.querySelector('#aiCreate').click();document.querySelector('#aiCreate').click()`);await wait(240);
  check(posts===1&&payloads[0].dueDate==='2026-10-29T15:30:00+0800'&&payloads[0].timeZone===Intl.DateTimeFormat().resolvedOptions().timeZone,'one explicit create sends correct local date/time and zone');
  check(await js(`!document.querySelector('#aiPreviewDialog').open&&document.querySelector('#aiMessages').textContent.includes('日期已核对：2026年10月29日 15:30')`),'real writer verifies synthetic response and shows full confirmed date');
  check(!(await api.aiCreate({id:draft.id,revision:1,task:draft.task})).ok&&posts===1,'old or already-created draft cannot create again');
  await click('#aiQuickAdd');await js(`document.querySelector('#aiTitle').value='保留的手动便签';document.querySelector('#aiTitle').dispatchEvent(new Event('input',{bubbles:true}))`);await click('#aiPreviewClose');
  const saved=(await api.session()).preview;await js('window.confirm=()=>false;void 0');await click('#aiQuickAdd');check((await api.session()).preview.id===saved.id,'declining replacement preserves manual draft');
  await js('window.confirm=()=>true;void 0');await click('#aiQuickAdd');check((await api.session()).preview.id!==saved.id,'explicit replacement creates new draft identity');await click('#aiPreviewClose');
  win.destroy();await open(true);check(await js(`!document.querySelector('#aiPreviewDialog').open&&!document.querySelector('#aiShowDraft').hidden`),'window recreation retains manual draft without opening unexpectedly');await click('#aiShowDraft');check(await js(`document.querySelector('#aiPreviewTitle').textContent.includes('写下一件小事')`),'restored manual draft keeps manual identity');await click('#aiPreviewClose');
  source='cache';updateDashboard();check(!(await api.aiManualDraft({scene:'🔬 科研',replaceId:(await api.session()).preview.id})).ok,'offline cached lists cannot prepare a write draft');source='live';updateDashboard();
  check(!(await api.aiManualDraft({scene:'unknown'})).ok,'unknown scene cannot prepare draft');
  await api.clear();source='partial';failed=['research'];updateDashboard();
  const partial=await api.aiManualDraft({scene:'🔬 科研'});check(partial.ok&&partial.preview.projects.length===1&&partial.preview.task.projectId==='life','failed lists excluded from manual target choices');await api.clear();source='live';failed=[];updateDashboard();
  const overview=await api.aiManualDraft({scene:'总览'});check(overview.ok&&overview.preview.task.projectId==='','multiple unassociated lists require explicit choice');await api.clear();
  const guarded=await api.aiManualDraft({scene:'🔬 科研',title:'旧便签'});
  check(!(await api.aiManualDraft({scene:'🔬 科研',replaceId:guarded.preview.id,replaceRevision:0})).ok,'stale revision cannot replace a current manual draft');
  delayRead=true;const replacing=api.aiManualDraft({scene:'🔬 科研',replaceId:guarded.preview.id,replaceRevision:guarded.preview.revision});await wait(30);
  api.aiUpdatePreview({id:guarded.preview.id,revision:guarded.preview.revision+1,task:{...guarded.preview.task,title:'并发编辑保留'}});
  check(!(await replacing).ok&&(await api.session()).preview.task.title==='并发编辑保留','concurrent manual edits survive delayed replacement');delayRead=false;await api.clear();
  clock=new Date(2026,9,30,0,1);const tomorrow=await api.aiManualDraft({scene:'🔬 科研'});check(tomorrow.preview.task.date==='2026-10-30','next manual draft reads fresh local date after midnight');await api.clear();
  delayRead=true;const pending=api.aiManualDraft({scene:'🔬 科研'});await wait(30);await api.cancel();check(!(await pending).ok,'cancelled preparation does not produce late manual draft');delayRead=false;
  await api.aiManualDraft({scene:'🔬 科研',title:'合成不确定任务'});const uncertainDraft=(await api.session()).preview;remote='uncertain';const uncertain=await api.aiCreate({id:uncertainDraft.id,revision:uncertainDraft.revision,task:uncertainDraft.task});
  check(uncertain.code==='uncertain'&&posts===2,'timeout result remains uncertain with one submission');check(!(await api.aiManualDraft({scene:'🔬 科研',replaceId:uncertainDraft.id})).ok,'uncertain result blocks new manual draft');await api.resolve();remote='ok';
  await js(`state.scene=SCENES[2];render();`);await settle();const beforeFocusPosts=posts;
  check(!(await api.startTaskFocus({projectId:'research',taskId:'missing'})).ok,'main process rejects missing task focus');
  await click('[data-focus-task="task-a"]');check(timer.snapshot().status==='running'&&timer.snapshot().task.title==='合成阅读任务','native task action starts timer using trusted task title');
  check(await js(`document.querySelector('#pomoTask').textContent.includes('合成阅读任务')&&document.querySelector('[data-focus-task="task-a"]').getAttribute('aria-pressed')==='true'`),'timer shows associated task and marks its action');
  elapsed+=10000;const remainder=timer.snapshot().remainingMs;await click('[data-focus-task="task-a"]');check(timer.snapshot().remainingMs===remainder,'repeat task action does not reset timer');
  await click('#pomoStart');check(timer.snapshot().status==='paused','pause works with associated task');await click('[data-focus-task="task-a"]');check(timer.snapshot().status==='running'&&timer.snapshot().remainingMs===remainder,'same task resumes without losing remainder');
  await js('window.confirm=()=>false;void 0');await click('[data-focus-task="task-b"]');check(timer.snapshot().task.id==='task-a','declining focus switch preserves current timer');await js('window.confirm=()=>true;void 0');await click('[data-focus-task="task-b"]');check(timer.snapshot().task.id==='task-b'&&timer.snapshot().remainingMs===60000,'confirmed focus switch starts a new focus stage');await shot('task-focus');
  const linked=timer.snapshot().task;for(let i=0;i<5;i++){await js(`document.querySelector('#sceneNav').children[${i}].click()`);await settle();check(timer.snapshot().task.id===linked.id&&await js(`document.querySelector('#pomoTask').textContent.includes('合成整理任务')`),'scene '+i+' preserves same task timer');}
  win.destroy();await open();check(await js(`document.querySelector('#pomoTask').textContent.includes('合成整理任务')`),'ordinary/desktop page recreation retains process timer association');
  elapsed+=61000;timer.snapshot(true);await settle();check(completions===1&&timer.snapshot().status==='completed'&&tasks.every(t=>t.status===0)&&posts===beforeFocusPosts,'completion notifies once without completing or writing Dida task');
  await click('#pomoStart');check(timer.snapshot().phase==='break'&&timer.snapshot().task.id==='task-b','manual rest keeps task context');await click('#pomoReset');check(timer.snapshot().task===null&&await js(`document.querySelector('#pomoTask').hidden`),'reset clears local task association');
  await js(`state.scene=SCENES[2];render();document.querySelector('[data-focus-task="task-a"]').focus()`);win.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await settle();check(timer.snapshot().task.id==='task-a','native keyboard Space starts selected task focus');
  await js(`state.tools.visible.pomodoro=false;renderLayout()`);await settle();const beforeHidden=timer.snapshot().remainingMs;elapsed+=1000;check(timer.snapshot().remainingMs===beforeHidden-1000,'hidden tool does not stop main-process countdown');
  await js(`state.tools.visible.pomodoro=true;renderLayout()`);await settle();
  await click('#editBtn');check(await js(`[...document.querySelectorAll('[data-focus-task]')].every(b=>b.disabled)&&document.querySelector('#aiQuickAdd').disabled`),'editing disables task focus and manual draft action');await click('#cancelEditBtn');
  for(const theme of ['warm','peach','night']){await js(`state.theme='${theme}';render()`);await settle();check(await js(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#pomoTask').scrollWidth<=document.querySelector('#pomoTask').clientWidth`),theme+' task context fits');await shot(theme);}
  for(const width of [900,520,390,320]){win.setContentSize(width,1000);await settle();check(await js(`document.documentElement.scrollWidth<=innerWidth`),'no horizontal overflow '+width);}
  win.setContentSize(520,800);await click('#aiQuickAdd');check(await js(`document.querySelector('#aiPreviewDialog').getBoundingClientRect().bottom<=innerHeight&&document.querySelector('#aiPreviewDialog').scrollWidth<=document.querySelector('#aiPreviewDialog').clientWidth`),'manual editor remains accessible in narrow viewport');await shot('manual-narrow');await click('#aiPreviewClose');
  check(aiCalls===0&&gets===0,'entire manual and focus flow makes no model call or unexpected read-back');check(errors.length===0,'no page load, renderer or unhandled errors');
  const config=JSON.stringify(JSON.parse(await fs.readFile(configFile,'utf8')));check(!/合成手动任务|保留的手动便签|合成阅读任务|合成整理任务|synthetic-only/.test(config),'task titles, linkage and credentials never enter layout config');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,aiCalls,posts,gets,configWrites,completions,scope:'Real Electron page, native input, actual main manual/create/focus helpers and task writer, native encrypted isolated latch; synthetic remote transport, clock and notification. Desktop styling/window recreation only, no native desktop mounting or real account writes.'},null,2));win.destroy();clearTimeout(watchdog);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:error.stack},null,2));if(win&&!win.isDestroyed())await fs.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});clearTimeout(watchdog);app.exit(1);});
