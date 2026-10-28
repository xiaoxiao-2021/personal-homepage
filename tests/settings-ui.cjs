'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../test-results/settings-ui');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let config=null,ready=false,writes=0,fail=false,slow=false,invalid=false,win;const checks=[],errors=[],geometry=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(value,label)=>{assert(value,label);checks.push(label);};
const projects=[{id:'demo-clinical',name:'临床'},{id:'demo-research',name:'科研'},{id:'demo-study',name:'学习'},{id:'demo-life',name:'生活'}];
ipcMain.handle('test:load',()=>({config}));ipcMain.handle('test:save',async(_e,value)=>{writes++;if(slow)await wait(260);if(fail){fail=false;return false;}config=JSON.parse(JSON.stringify(value));return true;});
ipcMain.handle('test:hotkey',()=>invalid?{ok:false,message:'合成快捷键占用提示'}:{ok:true});
ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:true}));ipcMain.handle('test:dida-dashboard',()=>({source:'live',projects,tasks:[],failedProjectIds:[]}));
ipcMain.handle('test:assistant-status',()=>({configured:false,model:'deepseek-flash'}));
ipcMain.on('test:page-ready',()=>{ready=true;});ipcMain.on('test:page-error',(_e,error)=>errors.push(error));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const run=code=>win.webContents.executeJavaScript(code,true);
async function settle(){await wait(100);await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function click(selector,delay=60){const p=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,...p});await wait(delay);}
async function capture(name){win.webContents.sendInputEvent({type:'mouseMove',x:1,y:1});await settle();await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function load(){ready=false;await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{settingsTest:'1',completionTest:'1'}});for(let i=0;i<100&&!ready;i++)await wait(50);check(ready,'normal page initialization');await settle();}
const watchdog=setTimeout(()=>app.exit(1),90000);
(async()=>{
 await fs.mkdir(output,{recursive:true});await app.whenReady();
 win=new BrowserWindow({show:false,width:1280,height:900,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.setContentSize(1280,900);
 win.webContents.on('did-fail-load',(_e,code)=>errors.push('load:'+code));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
 await load();
 check(await run(`['themeBtn','settingsBtn','desktopModeBtn','editBtn'].every(id=>{const b=$('#'+id);return b.querySelector('svg')&&b.getAttribute('aria-label')&&b.title&&b.getBoundingClientRect().width===36})`),'four compact toolbar icons retain accessible names and tooltips');
 win.show();win.focus();win.webContents.focus();await settle();await run(`$('#settingsBtn').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await settle();
 check(await run(`$('#settingsDialog').open`),'keyboard Space opens settings from the icon');await click('#settingsClose');
 check(await run(`$('#sceneTitle').closest('[hidden]')!==null&&$('.daily-greeting').textContent==='今天，也按自己的节奏。'`),'scene context removed from visible greeting');await capture('homepage');
 await click('#settingsBtn');check(await run(`$('#settingsDialog').open&&$('#startupSettingsSlot').contains($('#startupSettingsBtn'))`),'settings opens with grouped startup entry');
 const groups=await run(`({sections:$('#settingsDialog').querySelectorAll('.settings-section').length,mappings:$$('#didaMapping select').length})`);
 check(groups.sections===4&&groups.mappings===4,'all four preference groups and scene mapping controls exist: '+JSON.stringify(groups));await capture('settings-warm');
 check(await run(`$('#aiSettingsSlot').querySelector('button')!==null&&$('#settingsDialog .modal').children.length===3`),'AI entry belongs to the scrollable preference group, not an extra footer');
 const original=await run('JSON.stringify({shortcut:state.shortcut,mapping:state.didaListIds})'),before=writes;
 await run(`$('#hotkey').value='Control+Alt+J';const s=$('#didaMapping select');s.value='demo-study';s.dispatchEvent(new Event('change'))`);await click('#settingsCancel');
 check(await run(`!$('#settingsDialog').open&&JSON.stringify({shortcut:state.shortcut,mapping:state.didaListIds})===${JSON.stringify(original)}`),'cancel closes and discards unsaved shortcut/mapping');check(writes===before,'cancel writes no config');
 await click('#settingsBtn');check(await run(`$('#hotkey').value===state.shortcut&&$('#didaMapping select').value===state.didaListIds.clinical`),'reopening restores saved controls');
 await run(`$('#hotkey').value='Control+Alt+J'`);invalid=true;await click('#settingsSave');check(await run(`$('#settingsDialog').open&&$('#settingsSaveStatus').textContent.includes('占用')&&!$('#settingsSave').disabled`),'shortcut rejection stays visible and retry enabled');check(writes===before,'invalid shortcut writes no config');invalid=false;
 fail=true;slow=true;const prior=writes;await click('#settingsSave',30);
 check(await run(`settingsSaving&&$('#settingsClose').disabled&&$('#settingsCancel').disabled&&$('#hotkey').disabled&&$('#settingsSave').disabled`),'save locks new close/cancel controls and shortcut');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
 check(await run(`$('#settingsDialog').open`),'Escape cannot close during save');
 await run(`$('#settingsClose').click();$('#settingsCancel').click();void saveSettings()`);await wait(300);
 check(writes===prior+1,'repeat save rejected while in flight');check(await run(`$('#settingsDialog').open&&$('#hotkey').value==='Control+Alt+J'&&$('#settingsSaveStatus').textContent.includes('未保存')&&!$('#settingsCancel').disabled`),'save failure preserves draft and restores controls');slow=false;
 await click('#settingsSave');check(await run(`!$('#settingsDialog').open&&state.shortcut==='Control+Alt+J'`),'retry successfully saves shortcut');
 await load();check(await run(`state.shortcut==='Control+Alt+J'`),'saved shortcut survives isolated reload');
 await click('#settingsBtn');await click('#startupSettingsBtn');check(await run(`$('#startupDialog').open&&$('#aboutInfo').textContent.includes('构建标识')`),'startup/version subdialog opens and loads existing information');await capture('startup');await click('#startupDialog [data-close]');check(await run(`$('#settingsDialog').open&&!$('#startupDialog').open`),'closing child returns to settings draft');
 for(const theme of ['warm','peach','night']){
  await run(`state.theme=${JSON.stringify(theme)};renderAppearance();$('.settings-body').scrollTop=0`);await settle();await capture('settings-'+theme);
  check(await run(`getComputedStyle($('#settingsDialog')).backgroundColor!==getComputedStyle($('#settingsTitle')).color`),'distinct text/surface colors in '+theme);
 }
 for(const width of [1280,760,540,390,320]){
  win.setContentSize(width,820);await settle();await run(`$('.settings-body').scrollTop=0`);
  const m=await run(`(()=>{const d=$('#settingsDialog'),r=d.getBoundingClientRect(),footer=$('.settings-footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,dialog:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},horizontal:d.scrollWidth>d.clientWidth+1,footerBottom:footer.bottom,bodyScrollable:$('.settings-body').scrollHeight>$('.settings-body').clientHeight,buttons:[...$('.settings-footer').querySelectorAll('button')].map(n=>{const a=n.getBoundingClientRect();return {x:a.x,right:a.right,bottom:a.bottom}})}})()`);geometry.push(m);
  check(!m.horizontal&&m.dialog.x>=0&&m.dialog.right<=m.width+1&&m.dialog.bottom<=m.height+1,'settings stays inside viewport at '+width);
  check(m.buttons.every(b=>b.x>=m.dialog.x&&b.right<=m.dialog.right+1&&b.bottom<=m.height+1),'footer actions visible at '+width);
  if(width===390)await capture('settings-narrow');
 }
 win.setContentSize(1280,540);await settle();check(await run(`$('.settings-body').scrollHeight>$('.settings-body').clientHeight&&$('.settings-footer').getBoundingClientRect().bottom<=innerHeight`),'low-height settings scrolls body with visible footer');
 win.setContentSize(1280,900);win.webContents.setZoomFactor(1.25);await settle();check(await run(`$('#settingsDialog').scrollWidth<=$('#settingsDialog').clientWidth+1&&$('.settings-footer').getBoundingClientRect().bottom<=innerHeight`),'125 percent page zoom keeps footer accessible (not Windows DPI)');win.webContents.setZoomFactor(1);await settle();
 await click('#settingsClose');check(await run(`!$('#settingsDialog').open`),'header close is available');
 await click('#themeBtn');check(await run(`$('#themeDialog').open`),'appearance opens');await capture('appearance');await click('#appearanceCancel');
 await click('#aiSettings');check(await run(`$('#aiSettingsDialog').open&&$('#aiKey').type==='password'&&$('#aiKey').value===''`),'AI settings keeps blank password field without exposing saved key');await capture('assistant-settings');await click('#aiSettingsDialog [data-close]');
 await click('#pomoSettings');check(await run(`$('#pomoDialog').open`),'timer settings opens');await click('#pomoClose');
 check(errors.length===0,'no observed page errors');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,geometry,scope:'Actual isolated Electron renderer with synthetic config, hotkey and Dida APIs; native Electron input events; save failure/retry and reload. No real registry, account authorization, task or key changes. Page zoom is not Windows DPI.'},null,2));console.log('PASS '+checks.length+' settings UI checks.');win.destroy();clearTimeout(watchdog);app.quit();
})().catch(async e=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:e.stack,geometry},null,2));console.error(e);clearTimeout(watchdog);app.exit(1)});
