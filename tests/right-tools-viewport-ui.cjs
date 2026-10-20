'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../test-results/right-tools-viewport'),baseline=process.argv.includes('--baseline');
app.setPath('userData',path.join(output,baseline?'before-profile':'after-profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const checks=[],errors=[],configFile=path.join(output,baseline?'before-config.json':'after-config.json');let win,ready=false,saves=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(v,name)=>{assert(v,name);checks.push(name);};
ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));ipcMain.handle('test:save',async(_e,c)=>{saves++;await fs.writeFile(configFile,JSON.stringify(c));return true;});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
ipcMain.handle('test:assistant-status',()=>({configured:false,model:'deepseek-flash'}));
ipcMain.handle('test:quota-read',()=>({status:'ok',stale:false,fetchedAt:Date.now(),windows:[{id:'codex:primary',bucket:'codex',remainingPercent:72,windowDurationMins:300,resetsAt:Date.UTC(2026,9,18,12)},{id:'codex:secondary',bucket:'codex',remainingPercent:38,windowDurationMins:10080,resetsAt:Date.UTC(2026,9,21,12)}],resetCredits:{availableCount:2,expirations:[Date.UTC(2026,9,25,12)]}}));
const watchdog=setTimeout(()=>app.exit(1),90000);
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const source=await fs.readFile(path.resolve(__dirname,'../src/renderer.js'),'utf8'),context=vm.createContext({URLSearchParams,location:{search:''},Date,Intl,Math,JSON});
  vm.runInContext(source.slice(0,source.indexOf('function entry(id)'))+'\nglobalThis.seed=JSON.parse(JSON.stringify(defaults));',context);
  const seed=context.seed;seed.assistantLayout={version:1,visible:true,height:'medium',fitWindow:true};
  for(let i=1;i<=24;i++)seed.library['synthetic-'+i]={name:i===6?'一个用于验证自适应网格与长名称显示的合成软件入口':`合成软件 ${String(i).padStart(2,'0')}`,type:'软件',icon:'⌘',description:'隔离合成入口'};
  Object.values(seed.scenes).forEach(scene=>{scene.apps=Array.from({length:12},(_,i)=>'synthetic-'+(i+1));scene.side=[];scene.layout.heights={tasks:'medium',apps:'medium',side:'medium'};});
  await fs.writeFile(configFile,JSON.stringify(seed));await app.whenReady();
  const js=code=>win.webContents.executeJavaScript(code,true),click=id=>js(`document.getElementById('${id}').click()`);
  const open=async desktop=>{ready=false;win=new BrowserWindow({show:false,width:1560,height:1140,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('did-fail-load',(_e,c,d)=>errors.push(`${c}:${d}`));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{quotaTest:'1',...(desktop?{desktop:'1'}:{})}});win.show();win.focus();for(let i=0;i<100&&!ready;i++)await wait(40);check(ready,'normal page initialization ready');await wait(250);await js('window.confirm=()=>true;void 0');};
  const shot=async name=>{win.show();win.focus();await js(`window.scrollTo(0,0);${name==='short-expanded'?'':"document.querySelector('#moduleCard').scrollTop=0;"}new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await wait(350);await fs.writeFile(path.join(output,(baseline?'before-':'after-')+name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const metrics=()=>js(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width};};const rail=document.querySelector('#moduleCard');return {viewport:{width:innerWidth,height:innerHeight},calendar:rect('[data-module="calendar"]'),rail:rect('#moduleCard'),quota:rect('[data-module="codexQuota"]'),task:rect('.task-card'),apps:rect('.apps-card'),scrollHeight:rail.scrollHeight,clientHeight:rail.clientHeight,aligned:document.querySelector('#workspace').classList.contains('align-top')};})()`);
  await open();const initial=await metrics();await shot('overview');
  if(baseline){await fs.writeFile(path.join(output,'before-metrics.json'),JSON.stringify(initial,null,2));win.destroy();clearTimeout(watchdog);app.exit(0);return;}
  const natural=()=>js(`!document.querySelector('#workspace').classList.contains('align-top')&&getComputedStyle(document.querySelector('[data-module="calendar"]')).alignContent!=='space-between'`);
  const bounded=()=>js(`(()=>{const r=document.querySelector('#moduleCard').getBoundingClientRect();return document.querySelector('#moduleCard').classList.contains('fit-viewport')&&r.bottom<=innerHeight-10&&r.top>=0;})()`);
  check(await natural(),'calendar and apps are not stretched for equal bottom edges');check(await bounded(),'wide tool rail stays inside viewport');
  check(initial.clientHeight<=initial.viewport.height-initial.rail.top-10,'all tools share a viewport-sized rail without shrinking the calendar');
  await js(`document.querySelector('#moduleCard').focus();document.querySelector('#moduleCard').scrollTop=0;window.scrollTo(0,0)`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await wait(250);
  check(await js(`document.activeElement.id==='moduleCard'&&document.querySelector('#moduleCard').scrollTop>0&&window.scrollY===0`),'native End key scrolls the focused tool rail without moving the page');
  await js(`document.querySelector('#moduleCard').scrollTop=document.querySelector('#moduleCard').scrollHeight`);
  check(await js(`(()=>{const r=document.querySelector('#moduleCard').getBoundingClientRect(),q=document.querySelector('[data-module="codexQuota"]').getBoundingClientRect();return q.bottom<=r.bottom&&q.top>=r.top;})()`),'last compact tool is fully reachable without page scrolling');
  await js(`document.querySelector('#moduleCard').scrollTop=0`);
  const before=JSON.parse(await fs.readFile(path.join(output,'before-metrics.json'),'utf8'));check(initial.calendar.height<before.calendar.height-30,'calendar actually removes former artificial height');
  for(let i=0;i<5;i++){await js(`document.querySelector('#sceneNav').children[${i}].click()`);await wait(100);check(await natural()&&await bounded(),`scene ${i}: natural calendar and viewport rail`);}
  const months=new Set();for(let i=0;i<9;i++){months.add(await js(`document.querySelector('#calendarGrid').children.length/7`));check(await bounded()&&await natural(),`month ${i}: tool rail contained without stretching calendar`);await js(`document.querySelector('[data-calendar-nav="next"]').click()`);await wait(70);}
  check([4,5,6].every(n=>months.has(n)),'four/five/six-row calendars exercised using actual month controls');await js(`document.querySelector('[data-calendar-nav="today"]').click()`);await wait(90);
  const viewConfig=await fs.readFile(configFile,'utf8');
  for(const [width,height] of [[1280,1000],[1560,900],[1560,1140]]){win.setSize(width,height);await wait(160);check(await bounded()&&await natural(),`${width}x${height}: wide rail contained`);check(await js('document.documentElement.scrollWidth<=innerWidth'),'no horizontal page overflow');}
  check(await js(`(()=>{const r=document.querySelector('#moduleCard');return r.scrollHeight<=r.clientHeight+2;})()`),'all compact tools fit without internal scrolling when viewport height is sufficient');await shot('comfortable');
  check(await fs.readFile(configFile,'utf8')===viewConfig,'window resize never rewrites saved module or scene preferences');
  for(const zoom of [1.25,1.5]){win.webContents.setZoomFactor(zoom);await wait(140);check(await js('document.documentElement.scrollWidth<=innerWidth'),`${zoom} page zoom no horizontal overflow`);if(await js('innerWidth>1100'))check(await bounded(),'wide zoom still bounds rail');}win.webContents.setZoomFactor(1);await wait(120);
  await click('quotaCollapse');await click('editBtn');await wait(160);check(await bounded(),'expanded quota still bounded after layout save');
  win.setSize(1280,800);await wait(180);const overflow=await js(`(()=>{const r=document.querySelector('#moduleCard');return r.scrollHeight>r.clientHeight+2;})()`);check(overflow&&await bounded(),'short wide window uses scrolling rather than cutting controls');
  await js(`document.querySelector('#moduleCard').scrollTop=document.querySelector('#moduleCard').scrollHeight`);check(await js(`(()=>{const r=document.querySelector('#moduleCard').getBoundingClientRect(),b=document.querySelector('#quotaRefresh').getBoundingClientRect();return b.bottom<=r.bottom&&b.top>=r.top;})()`),'bottom quota controls can be reached inside rail');await shot('short-expanded');
  await click('editBtn');await wait(90);check(await js(`!document.querySelector('#moduleCard').classList.contains('fit-viewport')`),'editing uses natural page flow without trapping layout controls');await click('cancelEditBtn');await wait(130);check(await bounded(),'cancel returns to bounded browse layout');
  for(const [width,height] of [[900,950],[520,850],[1280,500]]){win.setSize(width,height);await wait(160);check(await js(`!document.querySelector('#moduleCard').classList.contains('fit-viewport')&&document.documentElement.scrollWidth<=innerWidth`),`${width}x${height}: narrow/very-low window uses accessible page flow`);}await shot('low-height');
  win.setSize(1560,1140);await wait(140);await click('themeBtn');await js(`document.querySelector('#theme').value='night';document.querySelector('#theme').dispatchEvent(new Event('input'))`);await click('appearanceSave');await wait(100);check(await bounded(),'night theme preserves bounded tools');await shot('night');
  win.destroy();await open(true);check(await bounded()&&await natural(),'desktop CSS page uses same natural viewport rules');await shot('desktop-css');
  check(errors.length===0,'no initialization/render/load/unhandled errors');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,initial,before,saves,scope:'Real Electron normal initialization and controls, isolated config and synthetic quota. Desktop CSS only; not native desktop mounting or Windows DPI.'},null,2));win.destroy();clearTimeout(watchdog);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:String(error.stack)},null,2));clearTimeout(watchdog);app.exit(1);});
