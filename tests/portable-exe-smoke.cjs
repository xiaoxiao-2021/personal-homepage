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
const page=expression=>main(`(async()=>{const w=${electron}.BrowserWindow.getAllWindows()[0];return await w.webContents.executeJavaScript(${JSON.stringify(expression)},true);})()`);
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
  check(manifest.files.every(file=>!/(credential|homepage-config|assistant-submission|debug\.log|\.png$|\.mp3$)/i.test(file.path)),'ZIP inventory has no profiles, account credentials, media or runtime logs');
  const {createHash}=require('node:crypto');for(const file of manifest.files){const bytes=await fs.readFile(path.join(directory,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  check(true,'all extracted runtime and application files match manifest SHA256');
  await launch();
  check(await page(`document.querySelector('#guideDialog').open`),'fresh packaged profile opens optional setup guide');
  await nativeClick('#guideSkip');check(await page(`!document.querySelector('#guideDialog').open`),'native skip closes setup guide');
  check(await page(`(async()=>{const s=await homeApi.startupSettings();return s.state==='preview'&&!s.supported&&!(await homeApi.saveStartupSettings({enabled:true})).ok;})()`),'real startup IPC refuses writes in preview');
  check(await page(`(async()=>{const d=await homeApi.didaStatus();return d.state==='unconnected';})()`),'actual app has no inherited Dida login');
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
  await page(`didaDashboard=__searchPreviousDashboard;searchInput.value='';closeSearch();render();true`);
  await nativeClick('#editBtn');check(await page(`editing===true`),'native edit button enters edit mode');
  const before=await page(`state.tools.musicCollapsed`);await page(`state.tools.musicCollapsed=${!before};renderModules();true`);
  await nativeClick('#cancelEditBtn');check(await page(`!editing&&state.tools.musicCollapsed===${before}`),'native cancel restores synthetic layout draft');
  await nativeClick('#editBtn');await page(`state.tools.musicCollapsed=true;renderModules();true`);await nativeClick('#editBtn');
  await until(()=>page(`!editing`),'native save layout');check(await page(`state.tools.musicCollapsed===true`),'native save persists changed tool preference');
  check(await page(`(async()=>{await homeApi.pomodoroCommand('start');await new Promise(r=>setTimeout(r,1200));const s=await homeApi.pomodoroState();await homeApi.pomodoroCommand('pause');const p=await homeApi.pomodoroState();await homeApi.pomodoroCommand('reset');return s.status==='running'&&s.remainingMs<1500000&&p.status==='paused';})()`),'actual packaged timer IPC starts, advances, pauses and resets');
  await nativeClick('#settingsBtn');check(await page(`document.querySelector('#settingsDialog').open`),'native settings opens in packaged page');
  check(await page(`(async()=>{const r=await homeApi.helpMetadata();return r.version===${JSON.stringify(manifest.version)}&&r.build===${JSON.stringify(manifest.buildId)};})()`),'packaged help metadata matches build');
  await nativeClick('#helpCheck');
  check(await page(`document.querySelector('#helpUpdateStatus').textContent.includes('隔离测试')`),'packaged update IPC respects offline isolated mode');
  await nativeClick('#helpDiagnosticDetails summary');
  check(await page(`(async()=>{const r=await homeApi.diagnosticSummary();return r.ok&&r.text.includes('免安装版')&&!r.text.includes('Users')&&!r.text.includes('AppData');})()`),'actual diagnostic IPC excludes user paths');
  await main(`(()=>{const e=${electron};globalThis.__helpCopy='';globalThis.__helpLink='';globalThis.__originalHelpCopy=e.clipboard.writeText;globalThis.__originalHelpOpen=e.shell.openExternal;e.clipboard.writeText=s=>{globalThis.__helpCopy=s;};e.shell.openExternal=async s=>{globalThis.__helpLink=s;};return true;})()`);
  check(await page(`(async()=>{return (await homeApi.copyDiagnostic()).ok;})()`)&&await main(`globalThis.__helpCopy.includes('个人首页')&&!globalThis.__helpCopy.includes('AppData')`),'actual copy IPC writes only generated summary (clipboard sink intercepted)');
  check(await page(`(async()=>{return !(await homeApi.openHelp('https://evil.invalid')).ok&&!(await homeApi.openHelp('__proto__')).ok;})()`)&&await main(`globalThis.__helpLink===''`),'actual help IPC rejects arbitrary links');
  check(await page(`(async()=>{return (await homeApi.openHelp('feedback')).ok;})()`)&&await main(`globalThis.__helpLink==='https://github.com/xiaoxiao-2021/personal-homepage/issues'`),'actual feedback IPC selects fixed destination (browser sink intercepted)');
  await main(`(()=>{const e=${electron};e.clipboard.writeText=globalThis.__originalHelpCopy;e.shell.openExternal=globalThis.__originalHelpOpen;return true;})()`);
  await screenshot('help');
  check(await page(`document.querySelector('#sceneSub').closest('[hidden]')!==null&&document.querySelectorAll('#settingsDialog .settings-section').length===5&&document.querySelector('#aiSettingsSlot button')!==null`),'packaged greeting has no scene subtitle and grouped preferences include AI entry');
  check(await page(`(()=>{const r=document.querySelector('.settings-footer').getBoundingClientRect();return r.bottom<=innerHeight&&document.querySelector('#settingsCancel').getBoundingClientRect().height>0;})()`),'packaged settings footer and cancel stay visible');
  await page(`Array.from(document.querySelectorAll('#settingsDialog button')).find(b=>b.textContent.includes('登录启动')).setAttribute('data-portable-startup','1');true`);
  await nativeClick('[data-portable-startup="1"]');
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
  await launch();check(await page(`(async()=>{return !(await homeApi.assistantSession()).recovery&&document.querySelector('#aiRecovery').hidden;})()`),'discard survives a second full process restart');await quit();
  await fs.writeFile(path.join(output,'exe-report.json'),JSON.stringify({passed:checks.length,checks,errors,localeProbe,stability,scope:'Actual ZIP extracted to a Unicode/space directory, relocated packaged exe, sandboxed actual preload/main, native mouse buttons plus synthetic draft mutation, isolated disk save and process restart. External services blocked. Non-bundled --lang launch tested; no assertion that Windows language changed. No real Dida/DeepSeek/Codex, startup writes, desktop mounting, audio playback, Windows DPI or publisher signing acceptance.'},null,2));console.log(`PASS ${checks.length} real packaged-exe checks.`);
})().catch(async error=>{
  errors.push(error.message);if(client)try{await main(`${electron}.app.exit(1)`);}catch{}if(socket)socket.close();
  if(child&&child.exitCode===null)child.kill(); // Only the child created by this test; never an existing homepage.
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'exe-report.json'),JSON.stringify({passed:checks.length,checks,errors,launchDiagnostics,failure:error.stack},null,2));console.error(error.message);process.exitCode=1;
});
