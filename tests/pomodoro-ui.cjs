'use strict';
// Normal renderer initialization + actual isolated disk; only external services
// and OS notification delivery are substituted. Clock jumps do not touch Windows.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createTimer,validateSettings,normalizeSettings}=require('../pomodoro.cjs');
const output=path.resolve(__dirname,'../test-results/pomodoro-ui'),configFile=path.join(output,'config.json');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win,ready=false,savedPreferences={focus:25,break:5},offset=0,completions=0,settingsWrites=0,failSettings=false,failSave=false,configWrites=0,aiCalls=0,reading=0,keyboardEvidence=null;
const checks=[],errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
const check=(value,label)=>{assert(value,label);checks.push(label);};
const timer=createTimer({now:()=>Date.now()+offset,monotonic:()=>performance.now()+offset,onComplete:()=>{completions++;push();}});
function push(){if(win&&!win.isDestroyed())win.webContents.send('test:pomo-state',timer.snapshot());}
let queue=Promise.resolve(),settingBusy=false;
const enqueue=work=>{const pending=queue.then(work);queue=pending.catch(()=>{});return pending;};
const load=async()=>JSON.parse(await fs.readFile(configFile,'utf8'));
const write=async value=>{await fs.writeFile(configFile+'.tmp',JSON.stringify(value));await fs.rename(configFile+'.tmp',configFile);};
ipcMain.handle('test:load',async()=>({config:await load()}));
ipcMain.handle('test:save',(_e,value)=>enqueue(async()=>{configWrites++;await wait(60);if(failSave){failSave=false;return false;}await write({...value,pomodoroSettings:savedPreferences});return true;}));
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
ipcMain.handle('test:assistant-status',()=>({configured:false,model:'deepseek-flash'}));
ipcMain.handle('test:assistant-session',()=>null);ipcMain.on('test:assistant-input',()=>{});
ipcMain.handle('test:assistant-clear',()=>({ok:true}));ipcMain.handle('test:assistant-cancel',()=>({ok:true}));
ipcMain.handle('test:assistant-generate',()=>{aiCalls++;return {ok:false,message:'合成响应，无网络请求。'};});
ipcMain.handle('test:pomo-state',()=>{reading++;return timer.snapshot();});
ipcMain.handle('test:pomo-command',(_e,action)=>{if(settingBusy)return {ok:false,message:'正在保存时长，请稍候。'};const state=timer.command(action);push();return {ok:true,state};});
ipcMain.handle('test:pomo-settings',async(_e,value)=>{
  try{
    const next=validateSettings(value);
    if(settingBusy||['running','paused'].includes(timer.snapshot().status))return {ok:false,message:'请先重置当前计时，再修改时长。'};
    settingBusy=true;
    return await enqueue(async()=>{await wait(180);if(failSettings){failSettings=false;return {ok:false,message:'合成写入失败，原设置已保留。'};}const config=await load();await write({...config,pomodoroSettings:next});settingsWrites++;savedPreferences=next;timer.configure(next);push();return {ok:true,state:timer.snapshot()};});
  }finally{settingBusy=false;}
});
const watchdog=setTimeout(()=>app.exit(1),90000);
(async()=>{
  const restart=process.argv.includes('--verify-restart');
  await fs.mkdir(output,{recursive:true});if(!restart)await fs.writeFile(configFile,'null');else{savedPreferences=normalizeSettings((await load()).pomodoroSettings);timer.configure(savedPreferences);}await app.whenReady();
  const open=async()=>{
    ready=false;win=new BrowserWindow({width:1280,height:1000,show:false,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('did-fail-load',(_e,code,description)=>errors.push(`${code}:${description}`));win.webContents.on('render-process-gone',(_e,details)=>errors.push(details.reason));
    await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{assistantTest:'1',pomodoroTest:'1'}});win.showInactive();
    for(let i=0;i<100&&!ready;i++)await wait(50);check(ready,'normal page initialization acknowledged');await wait(250);
    await win.webContents.executeJavaScript('window.confirm=()=>true;void 0',true);
  };
  const js=code=>win.webContents.executeJavaScript(code,true),click=id=>js(`document.getElementById('${id}').click();void 0`);
  const shot=async name=>fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const naturalTools=()=>js(`(()=>{const r=document.querySelector('#moduleCard').getBoundingClientRect();return !document.querySelector('#workspace').classList.contains('align-top')&&getComputedStyle(document.querySelector('[data-module="calendar"]')).alignContent!=='space-between'&&r.bottom<=innerHeight-10;})()`);
  await open();
  if(restart){check(timer.snapshot().status==='idle'&&timer.snapshot().settings.focus===3,'fresh Electron process preserves saved duration but starts idle');check(await js(`document.querySelector('#pomoTime').textContent==='03:00'&&document.querySelector('#pomoStart').textContent==='开始'&&!document.querySelector('[data-module="pomodoro"]').hidden`),'fresh renderer loads persisted display and idle duration');check(errors.length===0,'fresh process page loads without errors');await fs.writeFile(path.join(output,'restart-report.json'),JSON.stringify({pageLoaded:ready,checks,errors,scope:'New isolated Electron process reading previous real disk config; no automatic start.'},null,2));win.destroy();clearTimeout(watchdog);app.exit(0);return;}
  check(await js(`document.querySelector('#pomoTime').textContent==='25:00'&&!document.querySelector('[data-module="pomodoro"]').hidden`),'default 25 minute shared timer visible');
  check(await js(`document.querySelector('#aiSend').disabled&&document.querySelector('#aiSend svg').getAttribute('width')==='16'`),'empty input disables small send arrow');
  check(await js(`(()=>{const b=document.querySelector('#aiSend').getBoundingClientRect();return b.width>=28&&b.height>=28&&!document.querySelector('#aiSend').classList.contains('primary');})()`),'send target retains compact click area and no primary fill');
  await js(`document.querySelector('#aiInput').value='合成输入';document.querySelector('#aiInput').dispatchEvent(new Event('input'))`);
  check(await js(`!document.querySelector('#aiSend').disabled`),'typing enables arrow');
  await click('aiClear');await wait(60);check(await js(`document.querySelector('#aiSend').disabled`),'clear returns empty arrow to disabled');
  check(await naturalTools(),'upper cards are not forced equal and shared tools stay in viewport');
  check(await js(`document.querySelector('[data-module="pomodoro"]').getBoundingClientRect().bottom<=innerHeight-14`),'Pomodoro fits first screen in wide adequate-height window');await shot('overview');
  await click('pomoStart');await wait(1200);check(timer.snapshot().status==='running'&&timer.snapshot().remainingMs<1499000,'real clock advances after actual Start button');
  check(await js(`document.querySelector('#pomoTime').textContent!=='25:00'&&document.querySelector('#pomoStart').textContent==='暂停'`),'visible countdown refreshes');
  await click('pomoStart');const paused=timer.snapshot().remainingMs;await wait(1100);check(timer.snapshot().remainingMs===paused,'actual Pause remains stable');
  await click('pomoSettings');await wait(50);await js(`document.querySelector('#pomoFocus').value='3';document.querySelector('#pomoForm').requestSubmit();void 0`);await wait(80);
  check(await js(`document.querySelector('#pomoSaveStatus').textContent.includes('重置')`),'paused timing blocks duration change');await click('pomoClose');
  await js(`window.confirm=()=>false;void 0`);await click('pomoReset');check(timer.snapshot().status==='paused','reset confirmation cancellation keeps timer');await js(`window.confirm=()=>true;void 0`);await click('pomoStart');await wait(70);
  const revision=timer.snapshot().revision;
  for(let scene=0;scene<5;scene++){
    await js(`document.querySelector('#sceneNav').children[${scene}].click()`);await wait(100);
    check(await js(`document.querySelectorAll('[data-module="pomodoro"]').length===1&&document.querySelector('#pomoStart').textContent==='暂停'`),`scene ${scene} keeps one running timer`);
    check(timer.snapshot().revision===revision,`scene ${scene} does not restart main timer`);
    check(await naturalTools(),`scene ${scene} keeps natural bounded tools`);
  }
  await shot('life-running');
  await click('editBtn');await click('moduleManagerBtn');await js(`document.querySelector('[data-tool-visible="pomodoro"]').checked=false`);await click('moduleSave');await wait(100);
  check(await js(`document.querySelector('[data-module="pomodoro"]').hidden`),'module hide preview works');check(timer.snapshot().status==='running','hidden module keeps timing');
  const readsBefore=reading,writesBefore=configWrites;await wait(1400);check(reading===readsBefore&&configWrites===writesBefore,'hidden card stops page polling and performs no writes');
  await click('cancelEditBtn');await wait(100);check(await js(`!document.querySelector('[data-module="pomodoro"]').hidden&&document.querySelector('#pomoStart').textContent==='暂停'`),'cancel restores visibility without resetting session');
  win.destroy();await open();check(timer.snapshot().revision===revision&&await js(`document.querySelector('#pomoStart').textContent==='暂停'`),'window recreation shares main-process running session');
  win.hide();offset+=1600000;timer.snapshot(true);await wait(80);check(completions===1&&timer.snapshot().status==='completed','hidden simulated resume completes once');timer.snapshot(true);timer.snapshot();check(completions===1,'repeated resume does not repeat completion');win.showInactive();await wait(80);
  check(await js(`document.querySelector('#pomoStatus').textContent.includes('专注已完成')&&document.querySelector('#pomoStart').textContent==='开始休息'`),'completed state awaits manual next phase');await shot('completed');
  await click('pomoStart');await wait(70);check(timer.snapshot().phase==='break'&&timer.snapshot().status==='running','manual next stage starts break');await click('pomoReset');await wait(70);check(timer.snapshot().status==='idle'&&timer.snapshot().phase==='focus','confirmed reset returns ready focus');
  await click('pomoSettings');await wait(70);await js(`document.querySelector('#pomoFocus').value='0';document.querySelector('#pomoForm').requestSubmit();void 0`);await wait(70);check(settingsWrites===0,'native form blocks out of range');
  await js(`document.querySelector('#pomoFocus').value='2';document.querySelector('#pomoBreak').value='1';document.querySelector('#pomoForm').requestSubmit();document.querySelector('#pomoForm').requestSubmit();void 0`);
  check(await js(`document.querySelector('#pomoFocus').disabled&&document.querySelector('#pomoClose').disabled`),'duration save locks duplicate and cancel controls');await js(`requestPageTransition('quit');void 0`);check(await js(`document.querySelector('#pomoDialog').open`),'save-in-progress exit request leaves settings and input intact');await wait(240);check(settingsWrites===1,'duplicate duration submit writes once');await click('pomoClose');
  check((await load()).pomodoroSettings.focus===2&&await js(`document.querySelector('#pomoTime').textContent==='02:00'`),'duration changes truly persist on isolated disk');
  const originalToolOrder=(await load()).tools.order;
  await click('editBtn');await click('moduleManagerBtn');await js(`document.querySelector('#toolOrder').value='pomodoro'`);await click('toolUp');await click('moduleSave');
  await click('pomoSettings');await wait(70);await js(`document.querySelector('#pomoFocus').value='3';document.querySelector('#pomoForm').requestSubmit();void 0`);await wait(240);await click('pomoClose');await click('cancelEditBtn');await wait(70);
  check((await load()).pomodoroSettings.focus===3&&JSON.stringify((await load()).tools.order)===JSON.stringify(originalToolOrder),'cancel layout keeps independently saved duration and original order');
  await click('editBtn');await click('moduleManagerBtn');await js(`document.querySelector('[data-tool-visible="pomodoro"]').checked=false`);await click('moduleSave');failSave=true;await click('editBtn');await wait(130);
  check(await js(`document.querySelector('#editBtn').textContent==='保存布局'`),'layout save failure preserves edit draft');await click('editBtn');await wait(130);check((await load()).tools.visible.pomodoro===false,'layout retry truly persists visibility');
  win.destroy();await open();check(await js(`document.querySelector('[data-module="pomodoro"]').hidden`),'reopen preserves hidden preference');
  await click('editBtn');await click('moduleManagerBtn');await js(`document.querySelector('[data-tool-visible="pomodoro"]').checked=true`);await click('moduleSave');await click('editBtn');await wait(130);
  await click('pomoSettings');await wait(70);failSettings=true;await js(`document.querySelector('#pomoFocus').value='4';document.querySelector('#pomoForm').requestSubmit();void 0`);await wait(240);check((await load()).pomodoroSettings.focus===3&&timer.snapshot().settings.focus===3,'settings failure retains prior disk and runtime preference');
  check(await js(`!document.querySelector('#pomoFocus').disabled&&document.querySelector('#pomoSaveStatus').textContent.includes('失败')`),'settings failure restores controls and explicit message');await shot('settings');await click('pomoClose');
  for(const theme of ['warm','peach','night']){
    await click('themeBtn');await js(`document.querySelector('#theme').value='${theme}';document.querySelector('#theme').dispatchEvent(new Event('input'))`);await click('appearanceSave');await wait(140);
    check(await js(`!document.querySelector('#themeDialog').open&&document.querySelector('[data-module="pomodoro"]').getBoundingClientRect().width>0`),`${theme} actual theme save and unobstructed timer`);
    await js(`document.querySelector('#aiInput').value='合成消息';document.querySelector('#aiInput').dispatchEvent(new Event('input'))`);await shot(theme);
  }
  for(const width of [1280,960,520]){win.setSize(width,1000);await wait(160);check(await js(`document.documentElement.scrollWidth<=innerWidth`),`${width}px responsive page has no horizontal overflow`);check(await js(`(()=>{const p=document.querySelector('[data-module="pomodoro"]'),b=document.querySelector('#pomoStart');return b.getBoundingClientRect().right<=p.getBoundingClientRect().right&&b.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom;})()`),`${width}px timer controls inside card`);if(width===520){await shot('narrow');await js(`document.querySelector('[data-module="pomodoro"]').scrollIntoView({block:'end'})`);await wait(3300);await shot('narrow-tools');await js(`window.scrollTo(0,0)`);}}
  win.setSize(1280,1000);for(const zoom of [1.25,1.5]){win.webContents.setZoomFactor(zoom);await wait(130);check(await js(`document.documentElement.scrollWidth<=innerWidth`),`page zoom ${zoom} no overflow`);}win.webContents.setZoomFactor(1);await wait(130);
  await click('themeBtn');await js(`document.querySelector('#theme').value='warm';document.querySelector('#theme').dispatchEvent(new Event('input'))`);await click('appearanceSave');await wait(140);
  await click('editBtn');await click('moduleManagerBtn');await shot('modules');await click('moduleCancel');await click('cancelEditBtn');await wait(120);
  check(!JSON.stringify(await load()).includes('remainingMs')&&!JSON.stringify(await load()).includes('wallDeadline'),'disk never stores runtime session');check(aiCalls===0,'timer and settings do not send AI requests');check(errors.length===0,'no load initialization or unhandled errors');
  // A native Enter has both a key and a character event. It is not a DOM class
  // toggle; Electron also requires the test BrowserWindow to be focused.
  win.focus();await wait(200);await js(`document.querySelector('#pomoStart').focus();window.__pomoKeys=[];['keydown','keypress','keyup','click'].forEach(type=>document.querySelector('#pomoStart').addEventListener(type,event=>window.__pomoKeys.push({type,key:event.key})));void 0`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await wait(160);
  keyboardEvidence={focused:win.isFocused(),...(await js(`({active:document.activeElement.id,events:window.__pomoKeys})`)),status:timer.snapshot().status};check(timer.snapshot().status==='running','keyboard Enter activates focused Start control');check(keyboardEvidence.active==='pomoStart','keyboard focus returns after busy button is enabled');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,completions,settingsWrites,configWrites,keyboardEvidence,scope:'Real Electron normal page/DOM interaction, main timer module and isolated disk. Synthetic resume/time jumps, AI/Dida substitutes. No native desktop mount, notification delivery or real sleep tested.'},null,2));
  win.destroy();clearTimeout(watchdog);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,keyboardEvidence,failure:String(error.stack)},null,2));clearTimeout(watchdog);app.exit(1);});
