'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createGuide}=require('../startup-guide.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results/startup-guide');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win,guide,ready=false,config=null,writes=0,failSave=false,reads=0;const checks=[],errors=[];
const check=(value,label)=>{assert(value,label);checks.push(label);console.log(label);},wait=ms=>new Promise(r=>setTimeout(r,ms));
ipcMain.handle('test:load',()=>({config}));ipcMain.handle('test:save',(_e,value)=>{writes++;config=value;return true;});
ipcMain.handle('test:guide-state',()=>guide.read());ipcMain.handle('test:guide-dismiss',()=>failSave?{ok:false}:guide.dismiss());
ipcMain.handle('test:assistant-status',()=>{reads++;return {configured:false,model:'deepseek-flash'};});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,e)=>errors.push(e));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const js=s=>win.webContents.executeJavaScript(s,true);
async function settle(){await wait(160);}
async function click(selector){console.log('click '+selector);const p=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await settle();}
async function shot(name){await settle();await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(250);await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function load(query={}){ready=false;await win.loadFile(path.join(root,'src/index.html'),{query:{guideTest:'1',...query}});for(let i=0;i<100&&!ready;i++)await wait(50);check(ready,'real Electron homepage initialized');await settle();}
async function reopen(){await click('#settingsBtn');await click('#guideOpen');check(await js(`$('#guideDialog').open`),'settings can reopen optional guide');}
const timeout=setTimeout(()=>{console.error('Guide test timed out after '+checks.length+' checks');app.exit(1);},90000);
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const runDir=await fs.mkdtemp(path.join(output,'case-'));
  guide=createGuide({fs,path,file:path.join(runDir,'guide.json'),fresh:true});
  check((await guide.read()).show,'fresh profile is eligible');
  const existing=createGuide({fs,path,file:path.join(runDir,'existing.json'),fresh:false});check(!(await existing.read()).show,'old profile is not interrupted');
  const invalid=path.join(runDir,'invalid.json');await fs.writeFile(invalid,'bad');check(!(await createGuide({fs,path,file:invalid,fresh:true}).read()).ok,'invalid preference is reported without replacement');check(await fs.readFile(invalid,'utf8')==='bad','invalid preference is preserved');
  await app.whenReady();win=new BrowserWindow({show:false,width:1200,height:850,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('did-fail-load',(_e,c)=>errors.push('load:'+c));
  await load();check(await js(`$('#guideDialog').open&&document.activeElement.id==='guideClose'`),'first-use modal opens at heading with accessible close focus');
  check(await js(`$('#guideAiState').textContent.includes('尚未配置')`),'AI optional state reads saved configuration only');
  check(await js(`$('#guideDidaState').textContent.includes('尚未连接')`),'unconnected task service clearly labeled');
  const initialWrites=writes;await shot('first-use');
  for(const theme of ['peach','night','warm']){await js(`state.theme='${theme}';renderAppearance()`);await settle();check(await js(`$('#guideDialog').open&&getComputedStyle($('#guideDialog')).color===getComputedStyle(document.body).color`),'guide inherits theme: '+theme);if(theme==='night')await shot('night');}
  for(const width of [390,320]){win.setContentSize(width,620);await settle();check(await js(`(()=>{const n=$('#guideDialog'),r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth+1})()`),'guide fits narrow viewport '+width);await click('#guideSkip');check(await js(`!$('#guideDialog').open`),'skip reachable at '+width);await reopen();if(width===390)await shot('narrow');}
  win.setContentSize(1200,850);await settle();failSave=true;await click('#guideSkip');check(await js(`$('#guideDialog').open&&$('#guideStatus').textContent.includes('未能保存')&&!$('#guideSkip').disabled`),'failed preference save leaves retry available');failSave=false;
  await click('#guideSkip');check(!(await guide.read()).show,'skip persisted to separate guide preference');check(writes===initialWrites,'guide interactions never write layout configuration');
  await load();check(await js(`!$('#guideDialog').open`),'dismissed guide stays closed on page reload');
  await reopen();await click('#guideEntry');check(await js(`editing&&$('#entryDialog').open&&!$('#guideDialog').open`),'entry step uses existing guarded edit flow');
  await click('#entryDialog [data-close]');await click('#cancelEditBtn');check(await js(`!editing`),'entry edit can be canceled normally');
  await reopen();await click('#guideDida');check(await js(`$('#settingsDialog').open&&document.activeElement.id==='didaConnect'`),'task step focuses connection control without authorizing');
  await js(`$('#hotkey').value='Control+Alt+Z'`);await click('#guideOpen');check(await js(`!$('#guideDialog').open&&$('#settingsDialog').open&&$('#hotkey').value==='Control+Alt+Z'`),'unsaved settings are protected');await click('#settingsCancel');
  await reopen();await click('#guideAi');check(await js(`$('#aiSettingsDialog').open&&!$('#guideDialog').open&&$('#aiKey').value===''`),'AI step opens existing optional settings without exposing key');await click('#aiSettingsDialog [data-close]');
  await reopen();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle();check(await js(`!$('#guideDialog').open`),'Escape dismisses accessibly');
  for(const [state,source,label]of [['authorizing','none','等待授权'],['expired','cache','授权已过期'],['connected','cache','离线缓存'],['connected','partial','部分清单'],['connected','live','已连接'],['error','error','暂不可用']]){await js(`dida={state:'${state}'};didaDashboard={source:'${source}',projects:[],tasks:[]};true`);await reopen();check(await js(`$('#guideDidaState').textContent.includes('${label}')`),'connection state: '+state+'/'+source);await click('#guideSkip');}
  await load({desktop:'1'});check(await js(`!$('#guideDialog').open`),'desktop page uses same dismissed state');await reopen();await shot('desktop-style');await click('#guideSkip');
  check(errors.length===0,'no page or load errors');
  check(reads>0,'status read exercised; no model or authorization IPC registered');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,errors,scope:'Real sandboxed Electron page, native mouse/keyboard, synthetic services and isolated guide preference. Desktop CSS only; no real authorizations or model requests.'},null,2));console.log('PASS '+checks.length+' guide checks');clearTimeout(timeout);win.destroy();app.exit(0);
})().catch(async e=>{await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:String(e.stack)},null,2));console.error(e);app.exit(1);});
