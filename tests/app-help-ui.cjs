'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),help=require('../app-help.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results/app-help');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win,ready=false,config=null,writes=0,calls=0,copies=0,links=[],result={state:'available',tag:'v0.3.23-preview.1',prerelease:true,notes:'更舒适的新版本\n<img src=x onerror="window.bad=true">'},failCopy=false;
const checks=[],errors=[],check=(v,l)=>{assert(v,l);checks.push(l);},wait=ms=>new Promise(r=>setTimeout(r,ms));
ipcMain.handle('test:load',()=>({config}));ipcMain.handle('test:save',(_e,v)=>{writes++;config=v;return true;});
ipcMain.handle('test:help-meta',()=>({version:'0.3.22',build:'2026.10.31.2'}));
ipcMain.handle('test:help-check',async()=>{calls++;await wait(200);return result;});
const summary=()=>help.diagnostic({appVersion:'0.3.22',build:'2026.10.31.2',platform:'win32',osVersion:'10.0.26200',arch:'x64',electron:process.versions.electron,chrome:process.versions.chrome,packaged:false,desktop:false,uptime:30,update:{state:result.state,code:result.code||'OK'}});
ipcMain.handle('test:help-diagnostic',()=>({ok:true,text:summary()}));ipcMain.handle('test:help-copy',()=>{copies++;return {ok:!failCopy};});
ipcMain.handle('test:help-open',(_e,key)=>{links.push(key);return {ok:true};});ipcMain.handle('test:assistant-status',()=>({configured:false}));
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,e)=>errors.push(e));
const js=s=>win.webContents.executeJavaScript(s,true);
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await wait(80);const p=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(300);}
async function shot(name){await wait(250);await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
const timeout=setTimeout(()=>{console.error('Help UI timeout');app.exit(1);},90000);
(async()=>{
  await fs.mkdir(output,{recursive:true});await app.whenReady();
  win=new BrowserWindow({show:false,width:1200,height:900,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('did-fail-load',(_e,c)=>errors.push('load:'+c));await win.loadFile(path.join(root,'src/index.html'));for(let i=0;i<100&&!ready;i++)await wait(50);check(ready,'homepage actually initialized');await wait(200);const baselineWrites=writes;
  check(calls===0,'no automatic update requests on startup');await click('#settingsBtn');check(await js(`$('#helpVersion').textContent.includes('0.3.22')`),'settings shows build');check(calls===0,'opening settings stays offline');
  await js(`$('#hotkey').value='Control+Alt+Z'`);await click('#helpCheck');
  check(calls===1,'native check click requests release list');check(await js(`$('#helpUpdateStatus').textContent.includes('新版本')&&!$('#helpRelease').hidden`),'new preview visible');
  check(await js(`!window.bad&&$('#helpReleaseNotes').children.length===0&&$('#helpReleaseNotes').textContent.includes('<img')`),'untrusted notes render only as text');
  check(await js(`$('#hotkey').value==='Control+Alt+Z'`),'checking preserves unsaved settings');
  await click('#helpDiagnosticDetails summary');check(await js(`$('#helpDiagnosticText').value.includes('0.3.22')&&!$('#helpDiagnosticText').value.includes('synthetic')`),'preview displays allowlisted summary');
  failCopy=true;await click('#helpCopy');check(await js(`$('#helpCopyStatus').textContent.includes('失败')&&!$('#helpCopy').disabled`),'copy failure can retry');failCopy=false;await click('#helpCopy');check(copies===2&&await js(`$('#helpCopyStatus').textContent.includes('已复制')`),'copy reports success after response');
  for(const key of ['website','help','feedback','releases'])await click(`[data-help-link="${key}"]`);check(links.join(',')==='website,help,feedback,releases','four purpose-specific help links');
  await shot('warm');
  for(const theme of ['night','peach']){await js(`state.theme='${theme}';renderAppearance()`);await wait(100);check(await js(`getComputedStyle($('#helpDiagnosticText')).color===getComputedStyle(document.body).color`),'summary theme '+theme);if(theme==='night')await shot('night');}
  for(const [state,code,text]of [['current','OK','当前发布'],['ahead','OK','公开发布更新'],['empty','NO_RELEASE','没有可识别'],['error','NETWORK_ERROR','网络'],['error','TIMEOUT','超时'],['error','RATE_LIMIT','受限'],['error','INVALID_RESPONSE','格式']]){result={state,code};await click('#helpCheck');check(await js(`$('#helpUpdateStatus').textContent.includes('${text}')`),'result '+state+'/'+code);check(await js(`$('#helpRelease').hidden`),'old release hidden after '+state+'/'+code);}
  for(const width of [390,320]){win.setContentSize(width,620);await wait(100);const count=calls;await click('#helpCheck');check(calls===count+1,'native narrow check works '+width);check(await js(`(()=>{const n=$('#settingsDialog'),r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth+1})()`),'settings fits '+width);const copyCount=copies;await click('#helpCopy');check(copies===copyCount+1,'native narrow copy works '+width);await js(`$('#helpCheck').scrollIntoView({block:'center',behavior:'instant'})`);if(width===390)await shot('narrow');}
  check(writes===baselineWrites,'help never writes configuration');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(200);check(await js(`!$('#settingsDialog').open`),'Escape uses existing settings close');
  check(errors.length===0,'no page/load errors');await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,scope:'Real sandboxed Electron page; native mouse and Escape; synthetic release/clipboard/link services; no account data or remote writes.'},null,2));console.log('PASS '+checks.length+' help UI checks');clearTimeout(timeout);win.destroy();app.exit(0);
})().catch(async e=>{await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:String(e.stack)},null,2));console.error(e);app.exit(1);});
