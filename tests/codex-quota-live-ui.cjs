'use strict';
// Actual installed desktop Codex quota, isolated homepage, no other real services.
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const quota=require('../codex-quota.cjs');
const output=path.resolve(__dirname,'../test-results/codex-quota/live-ui');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
let service,win,ready=false,requests=0,config=null;const errors=[],checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
const check=(v,label)=>{assert(v,label);checks.push(label);};
ipcMain.handle('test:load',()=>({config}));ipcMain.handle('test:save',async(_e,next)=>{config=next;await fs.writeFile(path.join(output,'config.json'),JSON.stringify(next));return true;});
ipcMain.handle('test:assistant-status',()=>({configured:false}));
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
ipcMain.handle('test:quota-read',(_e,force)=>{requests++;return service.read(force);});
const timer=setTimeout(()=>{service?.dispose();app.exit(1);},45000);
(async()=>{
  await fs.mkdir(output,{recursive:true});await app.whenReady();
  const appData=app.getPath('appData'),localAppData=process.env.LOCALAPPDATA||path.join(path.dirname(appData),'Local');
  service=quota.createService({find:()=>quota.locateExecutable({appData,localAppData})});
  win=new BrowserWindow({show:false,width:1560,height:1140,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('did-fail-load',(_e,code)=>errors.push(`load:${code}`));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
  await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{quotaTest:'1'}});win.show();win.focus();
  const js=code=>win.webContents.executeJavaScript(code,true);
  for(let i=0;i<300;i++){if(ready&&requests&&service.state().status!=='idle')break;await wait(80);}
  await wait(150);const state=service.state();
  check(ready,'normal homepage initialization ready');check(state.status==='ok'&&state.programSource==='desktop','real installed desktop program returns official quota successfully');
  check(state.windows.some(w=>w.windowDurationMins===300)&&state.windows.some(w=>w.windowDurationMins===10080),'actual 5-hour and weekly windows returned');
  check(await js(`document.querySelector('#quotaSummary').textContent.includes('%')&&document.querySelector('#quotaNearest').textContent.includes('北京时间')`),'real quota percentages and reset time reach actual page');
  check(await js(`document.querySelector('#quotaStatus').textContent.includes('官方桌面版')`),'page identifies successful desktop program source');
  await js(`document.querySelector('[data-module="codexQuota"]').scrollIntoView({block:'end'})`);await wait(350);
  await fs.writeFile(path.join(output,'quota-success.png'),(await win.webContents.capturePage()).toPNG());
  const previousRequests=requests;await js(`document.querySelector('#quotaRefresh').click()`);await wait(150);check(requests>previousRequests&&service.state().fetchedAt===state.fetchedAt,'manual refresh uses existing cache without duplicate native query');
  check(errors.length===0,'no initialization or page load errors');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,programSource:state.programSource,scope:'Real installed desktop Codex and homepage renderer; isolated config and synthetic non-quota services. No real task/music access, model call, login, reset, native desktop mounting or tray test. Screenshot contains quota values only; report contains no raw response, identities, local program paths or tokens.'},null,2));
  service.dispose();win.destroy();clearTimeout(timer);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:String(error.stack)},null,2));service?.dispose();clearTimeout(timer);app.exit(1);});
