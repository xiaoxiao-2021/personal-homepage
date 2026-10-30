'use strict';
// Normal Electron initialization + actual assistant adapter/writer. Only transports are fake.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const core=require('../task-assistant.cjs');
const output=path.resolve(__dirname,'../test-results/task-date-roundtrip');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const checks=[],errors=[],tasks=[],requests=[];let ready=false,api,win,mode='normal',candidate,refreshFail=false;
const projects=[{id:'research',name:'合成科研清单'}],credential={scope:'tasks:read tasks:write',accessToken:'synthetic-not-real'};
const today=core.localContext().date;
const dashboard=()=>({source:refreshFail?'cache':'live',revision:tasks.length,projects,tasks,failedProjectIds:[]});
const configFile=path.join(output,'config.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,name)=>{assert(v,name);checks.push(name);};
const mockDida=async(url,options)=>{
  requests.push({method:options.method});await wait(60);
  if(options.method==='POST'){
    const payload=JSON.parse(options.body),task={...payload,id:'synthetic-'+(tasks.length+1),status:0,startDate:payload.startDate?new Date(payload.startDate).toISOString():null,dueDate:payload.dueDate?new Date(payload.dueDate).toISOString():null};
    if(mode==='mismatch'){const yesterday=new Date(`${today}T00:00:00+08:00`);yesterday.setUTCDate(yesterday.getUTCDate()-1);task.dueDate=yesterday.toISOString();}
    tasks.push(task);
    return {ok:true,json:async()=>['read','unverified'].includes(mode)?{id:task.id,projectId:task.projectId}:task};
  }
  assert.equal(options.method,'GET');if(mode==='unverified')throw Error('synthetic read timeout');
  return {ok:true,json:async()=>tasks.at(-1)};
};
ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));
ipcMain.handle('test:save',async(_e,value)=>{await fs.writeFile(configFile,JSON.stringify(value));return true;});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:true}));ipcMain.handle('test:dida-dashboard',dashboard);
for(const [channel,method] of [['status','aiStatus'],['settings','aiSaveSettings'],['generate','aiGenerate'],['create','aiCreate'],['session','session'],['cancel','cancel'],['clear','clear']])ipcMain.handle('test:assistant-'+channel,(_e,value)=>api[method](value));
ipcMain.on('test:assistant-input',(_e,value)=>api.input(value));ipcMain.on('test:assistant-preview',(_e,value)=>api.aiUpdatePreview(value));
const watchdog=setTimeout(()=>app.exit(1),90000);
(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.writeFile(configFile,'null');await app.whenReady();
  const source=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8');
  const block=source.slice(source.indexOf('const aiCredentialPath ='),source.indexOf('const taskCompletion ='));
  const protectedFns=source.slice(source.indexOf('async function readProtectedJson('),source.indexOf('async function didaStatus('));
  const context=vm.createContext({drafts:require('../assistant-drafts.cjs'),mainWindow:null,trialWindow:null,app,safeStorage,path,fs,AbortController,assistant:{...core,generate:options=>core.generate({...options,fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({kind:'draft',message:'合成便签',task:candidate})},finish_reason:'stop'}]})})}),createTaskWriter:options=>core.createTaskWriter({...options,fetch:mockDida})},DIDA_API_URL:'https://synthetic.invalid/open/v1',didaAuthorization:null,readDidaCredential:async()=>credential,readConfig:async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}),latestDidaDashboard:dashboard(),didaRevision:0,queueDidaOperation:fn=>fn(),getDidaDashboard:async()=>dashboard()});
  vm.runInContext(protectedFns+'\n'+block+'\nglobalThis.adapter={aiStatus,aiSaveSettings,aiGenerate,aiCreate,aiUpdatePreview,session:async()=>({...aiSession,uncertain:(await aiSubmissionState()).uncertain}),input:value=>aiSession.input=value,cancel:()=>({ok:true}),clear:()=>{if(aiCreating||aiController)return {ok:false};aiSession={messages:[],input:"",preview:null,lastCreated:aiSession.lastCreated};aiDraft=null;return {ok:true};}};',context);api=context.adapter;
  check((await api.aiSaveSettings({key:'synthetic-date-test-key',model:core.MODELS[0]})).ok,'isolated native-encrypted synthetic key saved');
  const js=code=>win.webContents.executeJavaScript(code,true),click=id=>js(`document.getElementById('${id}').click()`);
  const open=async()=>{
    ready=false;win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('did-fail-load',(_e,c,d)=>errors.push(`${c}:${d}`));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
    await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1',assistantTest:'1'}});win.show();win.focus();
    for(let i=0;i<100&&!ready;i++)await wait(40);check(ready,'normal initialization explicitly ready');await wait(200);
    await js(`window.confirm=()=>true;document.querySelector('#sceneNav').children[0].click();void 0`);await wait(70);
  };
  const generate=async(title,patch={})=>{
    if(await js(`document.querySelector('#aiPreviewDialog').open`))await click('aiPreviewClose');
    candidate={title,projectId:'research',content:'仅用于隔离测试，不调用真实滴答',date:today,time:'',dateKind:'due',isAllDay:true,...patch};
    await js(`document.querySelector('#aiInput').value='另外创建一项新任务';document.querySelector('#aiInput').dispatchEvent(new Event('input'));document.querySelector('#aiSend').click()`);
    for(let i=0;i<100&&!await js(`document.querySelector('#aiPreviewDialog').open`);i++)await wait(30);
    check(await js(`document.querySelector('#aiPreviewDialog').open`),'generated note opens through actual page controls');
    check((await api.session()).preview.task.date===candidate.date,'note date equals validated draft date');
  };
  const create=async()=>{
    await click('aiCreate');await click('aiCreate');
    for(let i=0;i<100&&await js(`document.querySelector('#aiPreviewDialog').open`);i++)await wait(40);
    check(!await js(`document.querySelector('#aiPreviewDialog').open`)&&!(await api.session()).preview,'acknowledged task clears draft and closes note');
  };
  const shot=async name=>{
    // Run this UI test on its own: occluded Windows windows may retain stale compositor frames.
    win.show();win.focus();await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await wait(500);
    await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  };
  await open();check(requests.length===0,'normal initialization makes no task writes');
  await generate('合成·今天的全天任务');await shot('today-note');await create();
  check(tasks.length===1&&tasks[0].dueDate.slice(0,10)!==today,'synthetic server normalizes local midnight into prior UTC date');
  check(await js(`(()=>{const t=[...document.querySelectorAll('#tasks .task')].find(x=>x.textContent.includes('合成·今天的全天任务'));return t&&!t.classList.contains('task-overdue')&&t.closest('details').querySelector('summary').textContent.includes('今天');})()`),'UTC-normalized all-day task displays today, not overdue, on real page');
  check(await js(`document.querySelector('#aiStatus').textContent.includes('日期已核对')`),'verified status only after actual writer validation');await shot('today-created');
  mode='read';await generate('合成·15点任务',{time:'15:00',isAllDay:false});await create();
  check(requests.filter(r=>r.method==='POST').length===2&&requests.filter(r=>r.method==='GET').length===1,'duplicate clicks post once; incomplete response triggers one GET');
  check(await js(`document.querySelector('#tasks').textContent.includes('15:00')&&document.querySelector('#aiStatus').textContent.includes('日期已核对')`),'timed date read-back and displayed time match');
  mode='normal';await generate('合成·只设开始日期',{dateKind:'start'});await create();
  check(await js(`(()=>{const t=[...document.querySelectorAll('#tasks .task')].find(x=>x.textContent.includes('合成·只设开始日期'));return t&&!t.classList.contains('task-overdue')&&t.textContent.includes('开始于');})()`),'start-only UTC date renders correct group and no false overdue');
  mode='normal';await generate('合成·未设日期',{date:''});await create();
  check(await js(`(()=>{const t=[...document.querySelectorAll('#tasks .task')].find(x=>x.textContent.includes('合成·未设日期'));return t&&t.closest('details').textContent.includes('未设日期');})()`),'undated task stays outside today grouping');
  await js(`document.querySelector('#taskRange').value='inbox';document.querySelector('#taskRange').dispatchEvent(new Event('change'))`);await wait(130);
  await js(`document.querySelector('#inboxProject').value='research';document.querySelector('#inboxProject').dispatchEvent(new Event('change'))`);await wait(130);
  await js(`document.querySelector('#taskDates').value='today';document.querySelector('#taskDates').dispatchEvent(new Event('change'))`);await wait(130);
  check(await js(`document.querySelector('#tasks').textContent.includes('合成·今天的全天任务')&&document.querySelector('#tasks').textContent.includes('合成·只设开始日期')&&!document.querySelector('#tasks').textContent.includes('合成·未设日期')`),'real today filter includes UTC-normalized due/start dates but excludes undated task');
  await js(`document.querySelector('#taskDates').value='all';document.querySelector('#taskDates').dispatchEvent(new Event('change'))`);await wait(130);
  await js(`document.querySelector('#taskRange').value='scene';document.querySelector('#taskRange').dispatchEvent(new Event('change'))`);await wait(130);
  mode='mismatch';await generate('合成·实际返回昨天');await create();
  check(await js(`document.querySelector('#aiStatus').textContent.includes('返回日期与便签不一致')&&document.querySelector('#aiStatus').textContent.includes('不要重复')&&!document.querySelector('#aiStatus').textContent.includes('日期已核对')`),'wrong server date warns instead of claiming verification');await shot('date-mismatch');
  await click('aiShowDraft');check(await js(`document.querySelector('#aiDraftNote').textContent.includes('返回日期与便签不一致')&&document.querySelector('.ai-note-date').textContent.includes('便签日期')&&document.querySelector('#aiCreate').hidden`),'reopened completed note distinguishes requested date from actual date and keeps mismatch warning');await shot('mismatch-note');await click('aiPreviewClose');
  mode='unverified';await generate('合成·日期回读超时');await create();
  check(await js(`document.querySelector('#aiStatus').textContent.includes('实际日期尚未核对成功')&&document.querySelector('#aiCreate').hidden`),'read-back timeout keeps successful creation, no retry button');await shot('date-unverified');
  const before=requests.length;await click('aiShowDraft');check(await js(`document.querySelector('#aiDraftNote').classList.contains('completed')&&document.querySelector('#aiCreate').hidden`),'completed note cannot recreate task');await click('aiPreviewClose');check(requests.length===before,'reopening completed note performs no API call');
  // Current-main adapter unit check: refresh warning must not overwrite date mismatch.
  mode='mismatch';await generate('合成·日期错误同时刷新失败');refreshFail=true;await create();
  check(await js(`document.querySelector('#aiStatus').textContent.includes('返回日期与便签不一致')&&document.querySelector('#aiStatus').textContent.includes('刷新未成功')`),'date mismatch warning survives failed dashboard refresh');refreshFail=false;
  win.destroy();await open();
  check(await js(`document.querySelector('#tasks').textContent.includes('合成·今天的全天任务')&&![...document.querySelectorAll('#tasks .task')].find(x=>x.textContent.includes('合成·今天的全天任务')).classList.contains('task-overdue')`),'window recreation reads retained UTC task correctly');
  check(await js(`document.querySelector('#aiCreate').hidden`),'window recreation does not restore confirmed draft as creatable');
  await click('aiShowDraft');check(await js(`document.querySelector('#aiDraftNote').textContent.includes('返回日期与便签不一致')&&document.querySelector('#aiDraftNote').textContent.includes('刷新未成功')`),'window recreation retains date-check warnings in completed note');await click('aiPreviewClose');
  check(errors.length===0,'no page initialization/loading/render/unhandled errors');
  check(!JSON.stringify(JSON.parse(await fs.readFile(configFile,'utf8'))).includes('synthetic-date-test-key'),'synthetic key never enters normal layout config');
  await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,posts:requests.filter(r=>r.method==='POST').length,gets:requests.filter(r=>r.method==='GET').length,scope:'Real Electron page + actual main adapter/writer/encryption with isolated files. Synthetic AI/Dida responses only. No real task or Windows desktop mounting.'},null,2));
  win.destroy();clearTimeout(watchdog);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:String(error.stack)},null,2));clearTimeout(watchdog);app.exit(1);});
