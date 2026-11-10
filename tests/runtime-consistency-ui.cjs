'use strict';
const {app,BrowserWindow,screen,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const baseline=process.argv.includes('--baseline'),out=path.resolve(__dirname,'../test-results/runtime-consistency',baseline?'before':'after');
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let home,float,controller,elapsed=0,reads=0,saves=0,releaseState=null,holdState=false;
const findings={},checks=[],errors=[],resources=[];
const timer=require('../pomodoro.cjs').createTimer({now:()=>Date.now()+elapsed,monotonic:()=>performance.now()+elapsed});
let delayDashboard=false,releaseDashboard=null;
let dashboard={source:'live',revision:1,fetchedAt:new Date().toISOString(),projects:[{id:'p',name:'合成清单'}],tasks:[{id:'t',projectId:'p',title:'合成长运行任务',status:0}]};
const run=s=>home.webContents.executeJavaScript(s,true),widget=s=>float.webContents.executeJavaScript(s,true);
const check=(v,label)=>{assert(v,label);checks.push(label);};
async function until(fn,label,ms=6000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await wait(40);}throw Error('Timeout '+label);}
const watch=setTimeout(()=>app.exit(1),180000);
(async()=>{
 await app.whenReady();await fs.mkdir(out,{recursive:true});
 ipcMain.handle('test:load',()=>({config:null}));ipcMain.handle('test:save',()=>{saves++;return true;});
 ipcMain.handle('test:help-meta',()=>({version:'synthetic',build:'test'}));ipcMain.handle('test:assistant-status',()=>({configured:false}));
 ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:true}));
 ipcMain.handle('test:dida-dashboard',()=>{reads++;if(delayDashboard){delayDashboard=false;return new Promise(resolve=>{releaseDashboard=()=>resolve(dashboard);});}return dashboard;});
 ipcMain.handle('test:pomo-state',()=>{const value=timer.snapshot();if(holdState){holdState=false;return new Promise(resolve=>{releaseState=()=>resolve(value);});}return value;});
 ipcMain.handle('test:pomo-command',(_e,a)=>({ok:true,state:timer.command(a)}));
 ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
 home=new BrowserWindow({show:true,width:1360,height:900,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 await home.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{pomodoroTest:'1',completionTest:'1'}});
 await until(()=>run(`homepageReady&&didaDashboard?.source==='live'`),'page ready');
 await run(`state.didaListIds.clinical='p';render();true`);
 check(await run(`document.querySelector('#tasks').textContent.includes('合成长运行任务')`),'actual page displays synthetic task');
 timer.focusTask({id:'t',projectId:'p',title:'合成长运行任务'});home.webContents.send('test:pomo-state',timer.snapshot());await wait(100);
 holdState=true;await run(`window.dispatchEvent(new Event('focus'));true`);await until(()=>releaseState!==null,'deferred state read');
 elapsed+=10000;const latest=timer.snapshot();home.webContents.send('test:pomo-state',latest);await wait(80);releaseState();await wait(80);
 findings.sameRevisionTimerDoesNotRewind=await run(`pomodoroUI.snapshot().remainingMs<=${latest.remainingMs}`);
 controller=require('../floating-pomodoro.cjs').createFloatingTimer({BrowserWindow,screen,ipcMain,snapshot:()=>timer.snapshot(),command:a=>({ok:true,state:timer.command(a)}),onHome:()=>{}});
 const original=ipcMain._invokeHandlers.get('focus-float:state');let releaseFloat;
 ipcMain.removeHandler('focus-float:state');ipcMain.handle('focus-float:state',e=>{const value=original(e);return new Promise(resolve=>{releaseFloat=()=>resolve(value);});});
 await controller.show();float=BrowserWindow.getAllWindows().find(w=>w!==home);await until(()=>releaseFloat,'deferred floating read');
 timer.command('pause');controller.update();await wait(80);releaseFloat();await wait(100);
 findings.floatingRejectsOldInitialReply=await widget(`document.querySelector('#toggle').textContent==='继续'`);
 ipcMain.removeHandler('focus-float:state');ipcMain.handle('focus-float:state',original);
 const beforeOffline=reads;await run(`window.dispatchEvent(new Event('offline'));true`);await wait(100);
 findings.offlineImmediatelyLabelsCache=await run(`didaDashboard.source==='cache'&&document.querySelector('#taskSource').textContent.includes('缓存')&&document.querySelector('[data-task-id="t"]').disabled`);
 const readBeforeOnline=reads;await run(`for(let i=0;i<12;i++)window.dispatchEvent(new Event('online'));true`);await wait(1700);
 findings.onlineEventRefreshesOnce=reads-readBeforeOnline===1&&await run(`didaDashboard.source==='live'`);
 findings.offlineDoesNotRequest=beforeOffline===readBeforeOnline;
 if(!baseline)for(const [label,passed]of Object.entries(findings))check(passed,label);
 if(!baseline){
  delayDashboard=true;await run(`void refreshDidaStatus({silent:true});true`);await until(()=>releaseDashboard,'delayed live response');
  await run(`window.dispatchEvent(new Event('offline'));true`);releaseDashboard();await wait(150);
  check(await run(`didaDashboard.source==='cache'&&document.querySelector('[data-task-id="t"]').disabled`),'late live response cannot erase offline state');
  await run(`applyDidaDashboard({...didaDashboard,source:'partial',failedCount:1,failedProjectIds:['missing']});renderTasks();true`);
  check(await run(`didaDashboard.source==='partial'&&document.querySelector('[data-task-id="t"]').disabled`),'offline partial result retains incomplete semantics and disables writes');
  await run(`window.dispatchEvent(new Event('online'));true`);await until(()=>run(`didaDashboard.source==='live'`),'recover from partial offline');
  await run(`window.__stableAudio=document.querySelector('#musicAudio');window.__stableCalendar=document.querySelector('#calendarGrid');true`);
  home.webContents.debugger.attach('1.3');await home.webContents.debugger.sendCommand('Performance.enable');
  const metrics=async()=>{await home.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');const m=await home.webContents.debugger.sendCommand('Performance.getMetrics');return Object.fromEntries(m.metrics.filter(x=>['Nodes','JSEventListeners','JSHeapUsedSize'].includes(x.name)).map(x=>[x.name,x.value]));};
  const before=await metrics(),savesBefore=saves;const started=Date.now();
  for(let i=0;i<120;i++){
   await run(`state.scene=SCENES[${i%5}];render();true`);
   if(i%12===0){home.hide();home.showInactive();await controller.show();controller.update();const m=app.getAppMetrics();resources.push({elapsedMs:Date.now()-started,processes:m.length,cpuPercent:m.reduce((n,p)=>n+p.cpu.percentCPUUsage,0),workingSetKB:m.reduce((n,p)=>n+p.memory.workingSetSize,0)});}
   await wait(1000);
  }
  const after=await metrics();home.webContents.debugger.detach();
  check(after.JSEventListeners<=before.JSEventListeners+10,'120 scene renders do not grow page listeners after GC');
  check(await run(`__stableAudio===document.querySelector('#musicAudio')&&__stableCalendar===document.querySelector('#calendarGrid')`),'shared music and calendar DOM retained');
  check(saves===savesBefore,'repeated rendering and showing windows do not write configuration');
  check(BrowserWindow.getAllWindows().length===2,'one homepage and one floating timer remain');
  findings.soak={iterations:120,elapsedMs:Date.now()-started,before,after};
 }
 check(errors.length===0,'no page runtime errors');
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({baseline,pageLoaded:true,findings,checks,errors,resources,scope:'Isolated actual Electron page and floating window. Delayed IPC, synthetic network events, synthetic clock and repeated renders. CPU sums Chromium process interval percentages; memory sums working-set KB. Short operation run, not an hours-long soak or physical sleep.'},null,2));
 controller.dispose();home.destroy();clearTimeout(watch);console.log(JSON.stringify({findings,passed:checks.length}));app.exit(0);
})().catch(async error=>{console.error(error);await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify({findings,checks,errors,failure:error.stack},null,2));clearTimeout(watch);app.exit(1);});
