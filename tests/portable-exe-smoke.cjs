'use strict';
// Actual relocated packaged exe. Loopback Node inspector is used only by this test,
// not enabled in normal launches. Never attaches to an existing app/process.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const zip=path.resolve(process.argv[2]||'');
const suffix=process.argv[3]||'';if(!/^[a-z0-9-]*$/.test(suffix))throw Error('Invalid test run suffix');
const output=path.resolve(__dirname,'../test-results/portable-exe'+suffix),extractRoot=path.join(output,'中文 空格 路径');
const checks=[],errors=[];let child,socket,client,exe,directory;const launchDiagnostics=[];
let stability=null;
function check(value,label){assert(value,label);checks.push(label);}
async function until(predicate,label,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){try{if(await predicate())return;}catch{}await wait(100);}throw Error('Timeout: '+label);}
function inspector(ws){let id=0;const pending=new Map();ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}});return async expression=>{
  const request=++id,result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(request);reject(Error('Inspector evaluation timeout'));},15000);pending.set(request,{resolve,reject,timer});ws.send(JSON.stringify({id:request,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;
};}
const {isolatedProfile}=require('../portable-runtime.cjs');
const testProfile=()=>isolatedProfile(exe,require('node:os').tmpdir());
const electron="process.mainModule.require('electron')";
const main=expression=>client(expression);
const page=expression=>main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));return await w.webContents.executeJavaScript(${JSON.stringify(expression)},true);})()`);
async function launch(locale){
  let endpoint='',stderr='';const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  child=spawn(exe,['--personal-homepage-isolated-test','--inspect=127.0.0.1:0',...(locale?['--lang='+locale]:[])],{cwd:output,windowsHide:true,env,stdio:['ignore','ignore','pipe']});
  child.once('error',error=>errors.push('launch:'+error.code));child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-20000);endpoint=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0]||endpoint;});
  await until(()=>endpoint||child.exitCode!==null,'packaged inspector startup');if(!endpoint){launchDiagnostics.push({exitCode:child.exitCode,signal:child.signalCode,stderr});throw Error('Packaged exe exited before inspector was ready');}
  socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Loopback inspector unavailable')),{once:true});});client=inspector(socket);
  await until(()=>main(`${electron}.BrowserWindow.getAllWindows().length===1`),'packaged BrowserWindow');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];globalThis.__portableErrors=[];w.webContents.on('did-fail-load',(_e,c)=>globalThis.__portableErrors.push('load:'+c));w.webContents.on('render-process-gone',(_e,d)=>globalThis.__portableErrors.push('renderer:'+d.reason));})()`);
  await until(()=>page(`window.homepageReady===true&&typeof window.homeApi==='object'&&document.querySelector('#sceneNav').children.length===5&&document.querySelectorAll('#appGrid .entry').length>0`),'actual homepage initialization');
  const facts=await main(`(async()=>{const e=${electron};return {packaged:e.app.isPackaged,profile:e.app.getPath('userData'),app:e.app.getAppPath(),windows:e.BrowserWindow.getAllWindows().length,electron:process.versions.electron};})()`);
  check(facts.packaged===true,'actual standalone executable reports packaged mode');
  check(facts.profile===testProfile(),'actual app uses stable short isolated profile, not source or normal preview profile');
  check(facts.app===path.join(directory,'resources','app'),'actual application loads its bundled source rather than original project');
  const expected=JSON.parse(await fs.readFile(path.join(directory,'portable-manifest.json'),'utf8'));
  check(await page(`(async()=>{const a=await homeApi.about();return a.version===${JSON.stringify(expected.version)}&&a.buildId===${JSON.stringify(expected.buildId)}&&a.distribution.includes('免安装测试版');})()`),'actual preload reports expected version/build/channel');
  check(await page(`(async()=>{const s=await homeApi.assistantStatus();return !s.configured;})()`),'test does not inherit a formal DeepSeek key');
  check(await page(`typeof homeApi.assistantManualDraft==='function'&&typeof homeApi.pomodoroFocusTask==='function'&&!!document.querySelector('#aiQuickAdd')&&!!document.querySelector('#pomoTask')`),'packaged bridge and page expose manual task and focus controls');
  check(await page(`(async()=>{const r=await homeApi.assistantManualDraft({scene:state.scene});return r.ok===false&&/清单|连接|便签/.test(r.message);})()`),'actual packaged main blocks manual draft without live lists or pending recovery');
  check(await page(`(async()=>{const r=await homeApi.pomodoroFocusTask({projectId:'synthetic-missing',taskId:'synthetic-missing'}),s=await homeApi.pomodoroState();return r.ok===false&&s.task===null;})()`),'actual packaged main rejects unknown focus task and starts without association');
  const styleProbe=await page(`(()=>{const details=document.querySelector('.display-settings');return {display:getComputedStyle(details).display,allSheetsReadable:[...document.styleSheets].every(s=>{try{return s.cssRules.length>0}catch{return false}}),assistantReady:!!document.querySelector('#aiLayoutFit')}})()`);
  check(styleProbe.display==='none','packaged normal view hides layout-only display settings through final styles');
  check(styleProbe.allSheetsReadable&&styleProbe.assistantReady,'all packaged styles load and assistant script initializes in relocated Unicode path');
}
async function nativeClick(selector){
  const point=await page(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing test control');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];w.webContents.sendInputEvent({type:'mouseMove',x:${point.x},y:${point.y}});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:${point.x},y:${point.y}});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:${point.x},y:${point.y}});})()`);await wait(150);
}
async function screenshot(name){await page(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await wait(350);const target=path.join(output,name+'.png');await main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];const image=await w.webContents.capturePage();process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(target)},image.toPNG());})()`);}
async function quit(){
  await page(`setTimeout(()=>homeApi.performTransition('quit'),100);true`);socket.close();
  await until(()=>child.exitCode!==null,'normal packaged app exit');check(child.exitCode===0,'packaged app exits normally through existing quit workflow');client=null;socket=null;child=null;
}
(async()=>{
  if(!zip.endsWith('.zip'))throw Error('Pass the newly built ZIP path');await fs.mkdir(output,{recursive:true});
  const reuse=process.argv.includes('--reuse-extracted');if(!reuse)await fs.mkdir(extractRoot); // no overwrite
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  if(!reuse)await run(powershell,['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:HOMEPAGE_TEST_ZIP,$env:HOMEPAGE_TEST_EXTRACT)"],{windowsHide:true,timeout:120000,env:{...process.env,HOMEPAGE_TEST_ZIP:zip,HOMEPAGE_TEST_EXTRACT:extractRoot}});
  directory=path.join(extractRoot,path.basename(zip,'.zip'));exe=path.join(directory,'个人首页.exe');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'portable-manifest.json'),'utf8'));
  check(manifest.files.every(file=>['resources/app/src/assets/morning-lake.png','resources/app/src/assets/your-name.webp'].includes(file.path)||!/(credential|homepage-config|assistant-submission|debug\.log|\.(?:png|webp)$|\.mp3$)/i.test(file.path)),'ZIP inventory allows only reviewed built-in wallpapers, no user profiles, credentials, personal media or logs');
  const {createHash}=require('node:crypto');for(const file of manifest.files){const bytes=await fs.readFile(path.join(directory,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  check(true,'all extracted runtime and application files match manifest SHA256');
  await launch();
  check(await page(`document.querySelector('#guideDialog').open`),'fresh packaged profile opens optional setup guide');
  await nativeClick('#guideSkip');check(await page(`!document.querySelector('#guideDialog').open`),'native skip closes setup guide');
  check(await page(`(async()=>{const s=await homeApi.startupSettings();return s.state==='preview'&&!s.supported&&!(await homeApi.saveStartupSettings({enabled:true})).ok;})()`),'real startup IPC refuses writes in preview');
  check(await page(`(async()=>{const d=await homeApi.didaStatus();return d.state==='unconnected';})()`),'actual app has no inherited Dida login');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];w.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control']});w.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['control']});return true;})()`);
  await until(()=>page(`!searchPanel.hidden&&searchRows.length===8`),'packaged Ctrl+K palette');
  check(await page(`searchRows.every(r=>r.kind==='command')`),'packaged Ctrl+K shows bounded fixed actions');
  await nativeClick('#search-result-0');await until(()=>page(`!searchCommandBusy`),'manual command settles');
  check(await page(`!document.querySelector('#aiPreviewDialog').open&&/清单|连接|便签/.test(document.querySelector('#toast').textContent)`),'packaged new-task command explains missing live lists without creating task');
  await nativeClick('#search');await main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];await w.webContents.insertText('> 设置');return true;})()`);
  await until(()=>page(`searchRows.length===1&&searchRows[0].id==='settings'`),'packaged settings action');await nativeClick('#search-result-0');
  check(await page(`document.querySelector('#settingsDialog').open`),'packaged action opens existing settings');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});return true;})()`);
  await until(()=>page(`!document.querySelector('#settingsDialog').open`),'packaged settings Escape');
  await nativeClick('#editBtn');await nativeClick('[data-viewport-preset=compact]');
  check(await page(`editing&&document.querySelector('#workspace').dataset.density==='compact'`),'packaged native compact preset previews before save');await nativeClick('#cancelEditBtn');
  check(await page(`!editing&&current().layout.viewportPreset==='custom'`),'packaged cancel restores custom preset');
  await nativeClick('#editBtn');await nativeClick('[data-viewport-preset=compact]');await nativeClick('#editBtn');
  check(await page(`!editing&&current().layout.viewportPreset==='compact'`),'packaged native save commits preset');
  await nativeClick('[data-task-date=week]');check(await page(`sceneTaskView().dates==='week'&&document.querySelector('[data-task-date=week]').getAttribute('aria-pressed')==='true'`),'packaged native week filter selects and persists');
  await screenshot('overview');
  await nativeClick('[data-calendar-nav="next"]');check(await page(`calendarFollowToday===false`),'native calendar next enters manual browse');
  await nativeClick('[data-calendar-nav="today"]');check(await page(`calendarFollowToday===true`),'native Today restores follow mode');
  for(let i=0;i<5;i++){await nativeClick(`#sceneNav > :nth-child(${i+1})`);check(await page(`state.scene===SCENES[${i}]&&document.documentElement.scrollWidth<=innerWidth`),`native scene ${i+1} switch loads without horizontal overflow`);}
  check(await page(`typeof HomeSearch?.collect==='function'&&document.querySelector('#search').getAttribute('role')==='combobox'`),'packaged bundle includes unified search module and accessible input');
  await page(`globalThis.__searchPreviousDashboard=didaDashboard;applyDidaDashboard({source:'cache',revision:9999,projects:[{id:'search-list',name:'合成搜索清单'}],tasks:[{id:'search-task',projectId:'search-list',title:'合成搜索父任务',status:0,checkItems:[{id:'search-item',title:'合成搜索小项',status:0}]}]});true`);
  await nativeClick('#search');await main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];await w.webContents.insertText('合成搜索小项');return true;})()`);await until(()=>page(`searchRows.length===1&&!document.querySelector('.unified-search').hidden`),'native packaged search input');
  check(await page(`document.querySelector('#searchStatus').textContent.includes('缓存')&&document.querySelector('#searchResults').textContent.includes('合成搜索父任务')`),'packaged search shows cached subtask with parent context');await screenshot('search');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];for(const keyCode of ['Down','Return']){w.webContents.sendInputEvent({type:'keyDown',keyCode});w.webContents.sendInputEvent({type:'keyUp',keyCode});}return true;})()`);await until(()=>page(`!!searchTaskLocation`),'native packaged keyboard task location');
  check(await page(`document.querySelector('#tasks .search-hit')?.dataset.searchItem==='search-item'&&document.querySelector('#taskRange').disabled`),'packaged native keyboard locates exact small item in temporary view');
  await nativeClick('#searchLocationBack');check(await page(`!searchTaskLocation&&!document.querySelector('#taskRange').disabled`),'packaged return restores normal task view');
  await page(`taskFocusView.open('search-list','search-task');true`);
  check(await page(`document.querySelector('#focusViewDialog').open&&document.querySelector('#focusViewTitle').textContent==='合成搜索父任务'&&document.querySelectorAll('#focusViewSteps .check-item').length===1&&document.querySelector('#focusViewComplete').disabled`),'packaged focus surface renders synthetic cached task with completion blocked');
  await nativeClick('#focusViewClose');check(await page(`!document.querySelector('#focusViewDialog').open`),'packaged native return closes focus surface');
  await page(`didaDashboard=__searchPreviousDashboard;searchInput.value='';closeSearch();render();true`);
  await nativeClick('#editBtn');check(await page(`editing===true`),'native edit button enters edit mode');
  const before=await page(`state.tools.musicCollapsed`);await page(`state.tools.musicCollapsed=${!before};renderModules();true`);
  await nativeClick('#cancelEditBtn');check(await page(`!editing&&state.tools.musicCollapsed===${before}`),'native cancel restores synthetic layout draft');
  await nativeClick('#editBtn');await page(`state.tools.musicCollapsed=true;renderModules();true`);await nativeClick('#editBtn');
  await until(()=>page(`!editing`),'native save layout');check(await page(`state.tools.musicCollapsed===true`),'native save persists changed tool preference');
  check(await page(`(async()=>{await homeApi.pomodoroCommand('start');await new Promise(r=>setTimeout(r,1200));const s=await homeApi.pomodoroState();await homeApi.pomodoroCommand('pause');const p=await homeApi.pomodoroState();await homeApi.pomodoroCommand('reset');return s.status==='running'&&s.remainingMs<1500000&&p.status==='paused';})()`),'actual packaged timer IPC starts, advances, pauses and resets');
  await until(()=>page('!!document.querySelector("#personalPlanFilter")'),'actual local work UI initializes');
  check(await page('(async()=>{const r=await homeApi.personalWorkRead();return r.loaded&&r.ok&&r.sessions.some(s=>s.activeMs>=1000&&s.status==="interrupted");})()'),'real main records actual elapsed timer time after pause and reset');
  check(await page('(async()=>{const r=await homeApi.personalWorkChange({action:"pin",id:"synthetic-missing",projectId:"synthetic-missing"});return !r.ok;})()'),'real main rejects pinning an unknown task without writing Dida');
  await nativeClick('#personalFocusSummary');
  check(await page('document.querySelector("#focusJournalDialog").open&&document.querySelectorAll(".personal-day").length===7'),'packaged native summary opens seven-day focus journal');
  await nativeClick('#focusJournalClose');
  await until(()=>main('process.mainModule.require("node:fs").existsSync(process.mainModule.require("node:path").join('+electron+'.app.getPath("userData"),"personal-work.bin"))'),'encrypted local journal reaches disk');
  check(await main('(()=>{const f=process.mainModule.require("node:fs"),p=process.mainModule.require("node:path"),b=f.readFileSync(p.join('+electron+'.app.getPath("userData"),"personal-work.bin"));return !b.includes(Buffer.from("\\"sessions\\""));})()'),'packaged local work store is Windows encrypted on isolated disk');

  check(await page(`(async()=>{const image=new Image();image.src='assets/your-name.webp';await image.decode();return image.naturalWidth>1000&&state.appearance.builtinWallpaper==='your-name'&&getComputedStyle(document.body).backgroundImage.includes('your-name.webp');})()`),'packaged default Your Name wallpaper is bundled decodable and effective after relocation');
  await nativeClick('#themeBtn');await nativeClick('[data-wallpaper-preset=morning-lake]');
  check(await page(`document.body.dataset.wallpaper==='morning-lake'`),'actual packaged native background switch previews Morning Lake');
  await nativeClick('#appearanceCancel');
  check(await page(`document.body.dataset.wallpaper==='your-name'`),'actual packaged Cancel restores Your Name background and palette');
  await nativeClick('#settingsBtn');check(await page(`document.querySelector('#settingsDialog').open`),'native settings opens in packaged page');
  check(await page(`(async()=>{const r=await homeApi.helpMetadata();return r.version===${JSON.stringify(manifest.version)}&&r.build===${JSON.stringify(manifest.buildId)};})()`),'packaged help metadata matches build');
  const themeBeforeSettings=await page(`state.theme`);
  await nativeClick('[data-settings-tab=appearance]');await nativeClick('[data-theme-swatch=night]');
  check(await page(`state.theme==='night'&&document.querySelector('#settingsAppearanceContent').contains(document.querySelector('#theme'))&&!document.querySelector('#themeDialog').open`),'packaged appearance swatch previews in single settings surface');
  await nativeClick('#settingsCancel');
  check(await page(`state.theme===${JSON.stringify(themeBeforeSettings)}&&document.querySelector('#themeDialog').contains(document.querySelector('#theme'))`),'packaged native cancel restores appearance and original controls');
  await nativeClick('#settingsBtn');
  await nativeClick('[data-settings-tab=about]');await nativeClick('#helpCheck');
  check(await page(`document.querySelector('#helpUpdateStatus').textContent.includes('隔离测试')`),'packaged update IPC respects offline isolated mode');
  await nativeClick('#helpDiagnosticDetails summary');
  check(await page(`(async()=>{const r=await homeApi.diagnosticSummary();return r.ok&&r.text.includes('免安装版')&&!r.text.includes('Users')&&!r.text.includes('AppData');})()`),'actual diagnostic IPC excludes user paths');
  await main(`(()=>{const e=${electron};globalThis.__helpCopy='';globalThis.__helpLink='';globalThis.__originalHelpCopy=e.clipboard.writeText;globalThis.__originalHelpOpen=e.shell.openExternal;e.clipboard.writeText=s=>{globalThis.__helpCopy=s;};e.shell.openExternal=async s=>{globalThis.__helpLink=s;};return true;})()`);
  check(await page(`(async()=>{return (await homeApi.copyDiagnostic()).ok;})()`)&&await main(`globalThis.__helpCopy.includes('个人首页')&&!globalThis.__helpCopy.includes('AppData')`),'actual copy IPC writes only generated summary (clipboard sink intercepted)');
  check(await page(`(async()=>{return !(await homeApi.openHelp('https://evil.invalid')).ok&&!(await homeApi.openHelp('__proto__')).ok;})()`)&&await main(`globalThis.__helpLink===''`),'actual help IPC rejects arbitrary links');
  check(await page(`(async()=>{return (await homeApi.openHelp('feedback')).ok;})()`)&&await main(`globalThis.__helpLink==='https://github.com/xiaoxiao-2021/personal-homepage/issues'`),'actual feedback IPC selects fixed destination (browser sink intercepted)');
  await main(`(()=>{const e=${electron};e.clipboard.writeText=globalThis.__originalHelpCopy;e.shell.openExternal=globalThis.__originalHelpOpen;return true;})()`);
  await screenshot('help');
  check(await page(`document.querySelector('#sceneSub').closest('[hidden]')!==null&&document.querySelectorAll('[data-settings-tab]').length===6&&document.querySelector('#aiSettingsSlot button')!==null`),'packaged greeting has no scene subtitle and grouped preferences include AI entry');
  check(await page(`(()=>{const r=document.querySelector('.settings-footer').getBoundingClientRect();return r.bottom<=innerHeight&&document.querySelector('#settingsCancel').getBoundingClientRect().height>0;})()`),'packaged settings footer and cancel stay visible');
  await page(`Array.from(document.querySelectorAll('#settingsDialog button')).find(b=>b.textContent.includes('登录启动')).setAttribute('data-portable-startup','1');true`);
  await nativeClick('[data-settings-tab=accounts]');await nativeClick('[data-portable-startup="1"]');
  await until(()=>page(`document.querySelector('#startupEnabled').disabled`),'preview startup controls');await screenshot('settings');
  check(await page(`document.querySelector('#startupApply').disabled&&document.querySelector('#aboutInfo').textContent.includes(${JSON.stringify(manifest.buildId)})`),'actual version dialog shows build and disables preview startup writes');
  await page(`document.querySelector('#startupDialog').close();true`);await nativeClick('#settingsClose');
  check(await page(`!document.querySelector('#settingsDialog').open`),'native settings header close returns to homepage');
  await main(`${electron}.BrowserWindow.getAllWindows()[0].setSize(900,900)`);await wait(300);check(await page(`document.documentElement.scrollWidth<=innerWidth`),'900px packaged window has no horizontal overflow');await screenshot('narrow');
  check((await main(`globalThis.__portableErrors`)).length===0,'packaged page has no observed load or renderer-crash events');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];w.webContents.debugger.attach('1.3');return true;})()`);
  await main(`(async()=>{const d=${electron}.BrowserWindow.getAllWindows()[0].webContents.debugger;await d.sendCommand('Performance.enable');await d.sendCommand('HeapProfiler.enable');return true;})()`);
  await nativeClick('#sceneNav > :nth-child(1)');await page(`globalThis.__stableCalendar=document.querySelector('#calendarGrid');globalThis.__stableAudio=document.querySelector('#musicAudio');true`);
  const metricProbe=()=>main(`(async()=>{const e=${electron},d=e.BrowserWindow.getAllWindows()[0].webContents.debugger;await d.sendCommand('HeapProfiler.collectGarbage');const m=await d.sendCommand('Performance.getMetrics');return Object.fromEntries(m.metrics.filter(x=>['Nodes','JSEventListeners','JSHeapUsedSize'].includes(x.name)).map(x=>[x.name,x.value]));})()`);
  const beforeStability=await metricProbe(),resources=[],started=Date.now();
  for(let i=0;i<60;i++){
    await nativeClick(`#sceneNav > :nth-child(${i%5+1})`);
    if(i%10===0)resources.push(await main(`(()=>{const m=${electron}.app.getAppMetrics();return {processCount:m.length,cpuPercent:m.reduce((n,p)=>n+p.cpu.percentCPUUsage,0),workingSetMB:m.reduce((n,p)=>n+p.memory.workingSetSize,0)/1024};})()`));
  }
  await nativeClick('#sceneNav > :nth-child(1)');const afterStability=await metricProbe();
  stability={sceneSwitches:60,elapsedMs:Date.now()-started,before:beforeStability,after:afterStability,resources};
  check(await page(`globalThis.__stableCalendar===document.querySelector('#calendarGrid')&&globalThis.__stableAudio===document.querySelector('#musicAudio')&&document.querySelector('#musicAudio').paused`),'sixty native scene switches preserve shared calendar and audio elements');
  check(afterStability.JSEventListeners<=beforeStability.JSEventListeners+10,'sixty native scene switches do not accumulate page listeners after garbage collection');
  check((await main(`globalThis.__portableErrors`)).length===0,'short repeated-operation stability run observes no renderer errors');
  await main(`${electron}.BrowserWindow.getAllWindows()[0].webContents.debugger.detach();true`);
  const recoverySeed={version:1,savedAt:new Date().toISOString(),preview:{id:'synthetic-restart-note',revision:1,scene:'总览',projects:[{id:'synthetic-list',name:'合成清单'}],timeZone:'Asia/Shanghai',sentAt:'2026-10-29 15:00',source:'manual',task:{title:'合成重启恢复便签',projectId:'synthetic-list',content:'仅测试',date:'2026-10-29',time:'',dateKind:'due',isAllDay:true}}};
  await main(`(()=>{const e=${electron},fs=process.mainModule.require('node:fs'),p=process.mainModule.require('node:path');fs.writeFileSync(p.join(e.app.getPath('userData'),'assistant-draft.bin'),e.safeStorage.encryptString(${JSON.stringify(JSON.stringify(recoverySeed))}));return true;})()`);
  await quit();await launch('ja-JP');
  check(await page('(async()=>{const r=await homeApi.personalWorkRead();return r.sessions.some(s=>s.activeMs>=1000)&&r.sessions.every(s=>!["running","paused"].includes(s.status));})()'),'focus records survive full executable restart without resuming timer');

  const localeProbe=await main(`({requested:process.argv.includes('--lang=ja-JP'),effective:${electron}.app.getLocale()})`);
  check(localeProbe.requested&&typeof localeProbe.effective==='string'&&localeProbe.effective.length>0,'explicit non-bundled locale launch loads page and reports effective locale');
  check(await page(`state.tools.musicCollapsed===true`),'saved preference survives full packaged process restart');
  check(await page(`!document.querySelector('#guideDialog').open`),'skipped setup stays dismissed after real restart');
  check(await page(`(async()=>{return (await homeApi.pomodoroState()).status==='idle'&&document.querySelector('#musicAudio').paused;})()`),'timer restarts idle and music paused');
  check(await page(`(async()=>{const s=await homeApi.assistantSession();return s.recovery?.preview?.task.title==='合成重启恢复便签'&&!s.preview&&!document.querySelector('#aiRecovery').hidden&&!document.querySelector('#aiPreviewDialog').open;})()`),'real process restart reads native encrypted draft and offers explicit recovery');
  check(await page(`(async()=>{const r=await homeApi.assistantRecover({action:'restore'});return r.ok===false&&!!(await homeApi.assistantSession()).recovery;})()`),'actual packaged recovery refuses offline stale list and retains note');
  await main(`(()=>{const e=${electron},w=e.BrowserWindow.getAllWindows()[0];for(let i=0;i<5;i++){w.hide();w.show();e.powerMonitor.emit('resume');}return true;})()`);await wait(400);
  check(await page(`homepageReady===true&&calendarFollowToday===true&&!document.querySelector('#aiRecovery').hidden`),'five real hide/show cycles and synthetic resume events preserve page and recovery');
  await screenshot('recovery');await page(`window.confirm=()=>true;true`);await nativeClick('#aiDiscardRecovery');
  check(await page(`(async()=>{return !(await homeApi.assistantSession()).recovery&&document.querySelector('#aiRecovery').hidden;})()`),'native discard clears real main recovery state');
  check(await main(`(()=>{const e=${electron},fs=process.mainModule.require('node:fs'),p=process.mainModule.require('node:path');return !fs.existsSync(p.join(e.app.getPath('userData'),'assistant-draft.bin'));})()`),'native discard removes encrypted copy on isolated disk');
  await quit();
  await launch();check(await page(`state.taskViews['总览'].dates==='week'`),'week filter preference survives full executable process restart');check(await page(`state.scenes['总览'].layout.viewportPreset==='compact'&&document.querySelector('#workspace').dataset.density==='compact'`),'compact preset survives actual executable restart');check(await page(`(async()=>{return !(await homeApi.assistantSession()).recovery&&document.querySelector('#aiRecovery').hidden;})()`),'discard survives a second full process restart');
  check(await page(`(async()=>{const r=await homeApi.showFloatingTimer();return r.ok;})()`),'actual home IPC loads bundled floating window');
  check(await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('floating-timer.html'));return w&&w.isAlwaysOnTop()&&w.isVisible();})()`),'actual packaged floating window is visible and topmost');
  check(await main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('floating-timer.html'));return await w.webContents.executeJavaScript("typeof floatingTimer==='object'&&typeof homeApi==='undefined'&&document.getElementById('time').textContent==='25:00'");})()`),'actual floating preload and script load with restricted bridge');
  check(await page(`(async()=>{return (await homeApi.showAmbient()).ok;})()`),'packaged main opens bundled ambient window');
  const ambientPage=code=>main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html'));return await w.webContents.executeJavaScript(${JSON.stringify(code)},true);})()`);
  check(await ambientPage(`typeof ambientApi==='object'&&typeof homeApi==='undefined'&&document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'packaged ambient bridge is restricted and starts paused');
  check(await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html'));return w.isVisible()&&w.isAlwaysOnTop();})()`),'packaged ambient window is visible and topmost');
  check(await ambientPage(`(async()=>{return !(await ambientApi.bili({action:'load',url:'https://example.com/'})).ok;})()`),'packaged Bili bridge rejects arbitrary websites');
  check(await ambientPage(`(async()=>{const r=await ambientApi.bili({action:'load',url:'BV1B7411m7LV'});await ambientApi.bili({action:'clear'});return r.ok&&r.url.startsWith('https://player.bilibili.com/player.html?')&&r.url.includes('autoplay=0')&&!document.querySelector('#biliPlayer').getAttribute('src');})()`),'packaged Bili parser canonicalizes ID without loading network until UI requests it');
  check(await ambientPage(`(async()=>{await ambientApi.bili({action:'load',url:'BV1B7411m7LV'});return (await ambientApi.action('video-only')).ok;})()`),'actual restricted bridge switches native window to video-only');
  await until(()=>main(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html')).getSize()[1]===230`),'packaged compact window size');
  check(await ambientPage(`document.body.classList.contains('video-only')&&document.querySelector('#scene').clientHeight===innerHeight`),'packaged pure-video layout fills native compact window');
  await ambientPage(`ambientApi.action('panel')`);await until(()=>main(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html')).getSize()[1]===562`),'packaged panel size');
  check(await ambientPage(`!document.body.classList.contains('video-only')`),'packaged expanded panel restores controls');await ambientPage(`ambientApi.bili({action:'clear'})`);
  // The test mutes OS output; standard AudioContext still executes normally.
  await main(`${electron}.app.commandLine.appendSwitch('mute-audio');true`);
  await page(`homeApi.onMusicCommand(command=>{if(command==='pause')globalThis.__ambientMusicPaused=true;});true`);
  await ambientPage(`document.querySelector('#sourceMode').value='synth';document.querySelector('#sourceMode').dispatchEvent(new Event('change'));true`);await wait(200);
  await ambientPage(`document.querySelector('#volume').value=0;document.querySelector('#volume').dispatchEvent(new Event('input'));document.querySelector('#play').click();true`);await wait(250);
  check(await ambientPage(`document.querySelector('#play').getAttribute('aria-pressed')==='true'`),'actual packaged sound engine starts through genuine bridge');
  check(await page(`globalThis.__ambientMusicPaused===true`),'starting environment sound asks existing music player to pause');
  await main(`(()=>{const e=${electron},w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));e.ipcMain.emit('music:state',{sender:w.webContents},{playing:true,title:'合成静音音乐状态'});return true;})()`);await wait(200);
  check(await ambientPage(`document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'actual music state pauses environment sound');
  await ambientPage(`ambientApi.action('hide')`);check(await main(`!${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html')).isVisible()`),'packaged ambient hide preserves application');
  check(await main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('floating-timer.html'));return (await w.webContents.executeJavaScript("floatingTimer.action('ambient')")).ok;})()`),'timer window can reopen ambient through restricted bridge');
  check(await ambientPage(`(async()=>{const r=await ambientApi.favorites({action:'add',url:'https://www.bilibili.com/video/BV1B7411m7LV/?spm_id_from=synthetic',name:'合成雨声收藏'});return r.ok&&r.items.length===1&&!r.items[0].url.includes('spm_id');})()`),'actual favorite IPC commits canonical favorite');
  check(await ambientPage(`(async()=>{
    const r=await ambientApi.favorites({action:'add',url:'https://www.bilibili.com/video/av123/',name:'第二段收藏'});
    if(!r.ok)return false;
    const saved=await ambientApi.favorites({action:'remember',url:r.items[1].url,volume:.42});
    return saved.ok&&saved.playback.lastId===r.items[1].id;
  })()`),'packaged playback memory saves selected favorite and volume');
  check(await ambientPage(`(async()=>{const r=await ambientApi.favorites({action:'remember',focusStart:false,focusEnd:true});return r.ok&&r.playback.focusEnd&&!r.playback.focusStart;})()`),'packaged focus linkage settings saved separately');
  await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html'));w.setPosition(80,90);return true;})()`);
  await ambientPage(`ambientApi.action('top')`);await wait(700);
  await quit();await launch();check(await page(`(async()=>{return (await homeApi.showAmbient()).ok;})()`),'favorite window opens after full executable restart');
  await until(()=>ambientPage(`document.querySelector('#favoriteSelect').options[0].textContent==='合成雨声收藏'`),'actual favorite UI restore');
  check(await ambientPage(`document.querySelector('#sourceMode').value==='bili'&&!document.querySelector('#biliPlayer').getAttribute('src')&&document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'favorites survive full process restart with no network load or autoplay');
  check(await ambientPage(`(async()=>{const r=await ambientApi.favorites({action:'list'});return r.items.length===2&&r.items[0].name==='合成雨声收藏';})()`),'restart uses real main-profile favorite store');
  check(await ambientPage(`document.querySelector('#favoriteSelect').selectedOptions[0].textContent==='第二段收藏'&&document.querySelector('#volume').value==='0.42'&&document.querySelector('#level').textContent==='42%'`),'real process restart restores last played favorite and volume');
  check(await ambientPage(`(async()=>{const r=await ambientApi.favorites({action:'list'});return r.playback.focusEnd&&!r.playback.focusStart&&document.querySelector('#focusEnd').checked;})()`),'focus options survive actual executable restart');
  check(await main(`(()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/ambient.html'));return !w.isAlwaysOnTop()&&w.getBounds().x===80&&w.getBounds().y===90;})()`),'actual process restart restores placement and top preference');
  await quit();

  await fs.writeFile(path.join(output,'exe-report.json'),JSON.stringify({passed:checks.length,checks,errors,localeProbe,stability,scope:'Actual ZIP extracted to a Unicode/space directory, relocated packaged exe, sandboxed actual preload/main, native mouse buttons plus synthetic draft mutation, isolated disk save and process restart. External services blocked. Non-bundled --lang launch tested; no assertion that Windows language changed. No real Dida/DeepSeek/Codex, startup writes, desktop mounting, audio playback, Windows DPI or publisher signing acceptance.'},null,2));console.log(`PASS ${checks.length} real packaged-exe checks.`);
})().catch(async error=>{
  errors.push(error.message);if(client)try{await main(`${electron}.app.exit(1)`);}catch{}if(socket)socket.close();
  if(child&&child.exitCode===null)child.kill(); // Only the child created by this test; never an existing homepage.
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'exe-report.json'),JSON.stringify({passed:checks.length,checks,errors,launchDiagnostics,failure:error.stack},null,2));console.error(error.message);process.exitCode=1;
});
