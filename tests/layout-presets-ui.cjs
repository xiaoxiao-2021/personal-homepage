'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results/layout-presets');
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const checks=[],errors=[];let ready=false,win,writes=0,items=0,parents=0,fail=false,focuses=0,savedConfig=null,failSave=false;
const dashboard={source:'live',revision:1,projects:[{id:'r',name:'合成科研清单'}],tasks:[{id:'a',projectId:'r',title:'把阅读笔记慢慢整理好',content:'把今天发现的小灵感记下来。\n<img src=x onerror=alert(1)>',dueDate:'2026-10-31T00:00:00+0800',timeZone:'Asia/Shanghai',isAllDay:true,status:0,checkItems:Array.from({length:6},(_,i)=>({id:'i'+i,title:['挑一篇想读的文章','记下两个新想法','整理图表','核对引用','写个小结','给自己一点鼓励'][i],status:i===0?1:0}))},...Array.from({length:22},(_,i)=>({id:'t'+i,projectId:'r',title:'合成任务 '+i,status:0}))]};
ipcMain.handle('test:load',()=>({config:savedConfig}));ipcMain.handle('test:save',(_e,value)=>{writes++;if(failSave)return false;savedConfig=structuredClone(value);return true;});ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete:true}));ipcMain.handle('test:dida-dashboard',()=>dashboard);ipcMain.handle('test:assistant-status',()=>({configured:false}));
ipcMain.handle('test:dida-complete-item',async(_e,p,t,id)=>{items++;await new Promise(r=>setTimeout(r,160));if(fail)return {ok:false,message:'合成失败，请重试'};dashboard.tasks[0].checkItems.find(i=>i.id===id).status=1;dashboard.revision++;return {ok:true,dashboard};});
ipcMain.handle('test:dida-complete',()=>{parents++;return {ok:false,message:'合成父任务未提交'};});ipcMain.handle('test:pomo-focus-task',()=>{focuses++;return {ok:true};});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,e)=>errors.push(e));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),run=s=>win.webContents.executeJavaScript(s,true),check=(v,s)=>{assert(v,s);checks.push(s);};
async function click(selector){const r=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);await wait(70);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...r,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(110);}
async function shot(name){await wait(220);await fs.writeFile(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
const watchdog=setTimeout(()=>app.exit(1),100000);
(async()=>{await fs.mkdir(out,{recursive:true});await app.whenReady();win=new BrowserWindow({show:false,width:1440,height:1000,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('did-fail-load',(_e,c)=>errors.push('load:'+c));
await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1'}});win.show();win.focus();for(let i=0;i<100&&!ready;i++)await wait(30);check(ready,'actual Electron page loaded');await wait(200);
await run(`state.didaListIds.research='r';state.scene=SCENES[2];render();window.__audio=$('#musicAudio');window.__calendar=$('#calendarGrid').firstChild;window.__query=$('#search').value='保留搜索';`);
const base=writes;
check(await run(`current().layout.viewportPreset==='custom'&&$('#workspace').dataset.density==='custom'`),'legacy config stays custom with no visual overlay');
await click('#editBtn');check(await run(`!$('#layoutPresetBar').hidden`),'native edit reveals density choices');
await click('[data-viewport-preset=compact]');check(await run(`$('#workspace').dataset.density==='compact'&&$('#taskColumn').classList.contains('fit-window')`),'compact preview activates real viewport sizing before save');
check(writes===base,'preview performs no configuration save');await shot('compact-preview');await click('#cancelEditBtn');
check(await run(`!editing&&current().layout.viewportPreset==='custom'&&$('#workspace').dataset.density==='custom'`),'cancel restores original preset and exits preview');
await click('#editBtn');await click('[data-viewport-preset=compact]');failSave=true;await click('#editBtn');check(await run(`editing&&current().layout.viewportPreset==='compact'`),'failed save retains editable preview');failSave=false;await click('#editBtn');
check(await run(`!editing&&$('#layoutPresetBar').hidden&&current().layout.viewportPreset==='compact'`),'successful save commits selected preset');
const key=savedConfig.scenes['🔬 科研'].layout;check(key.viewportPreset==='compact','saved configuration contains scene preference');
await run(`state.scene=SCENES[1];render()`);check(await run(`$('#workspace').dataset.density==='custom'`),'another scene retains its original custom layout');
await run(`state.scene=SCENES[2];render()`);check(await run(`$('#workspace').dataset.density==='compact'`),'returning scene restores its saved preset');
check(await run(`$('#musicAudio')===__audio&&$('#search').value===__query`),'preview and rollback preserve audio element and search');
await click('#editBtn');await click('[data-viewport-preset=relaxed]');await click('#editBtn');
for(const [width,height] of [[1680,1050],[1440,900],[1200,800],[900,700],[520,720],[390,720],[320,650],[1440,560]]){
 win.setContentSize(width,height);await wait(220);check(await run(`document.documentElement.scrollWidth<=innerWidth+1`),'no horizontal overflow '+width+'x'+height);
 check(await run(`$('#workspace').dataset.density===(innerWidth<1450||innerHeight<850?'compact':'relaxed')`),'relaxed preset adapts density '+width+'x'+height);
 if(width>1100&&height>=800){check(await run(`$('#taskColumn').getBoundingClientRect().bottom<=innerHeight+1&&$('#moduleCard').getBoundingClientRect().bottom<=innerHeight+1`),'left and right rails fit available viewport '+width);}
 if(width===1680||width===390)await shot('layout-'+width);
}
win.setContentSize(1440,1000);await wait(100);
for(const scene of ['总览','🏥 临床','🔬 科研','📚 学习','🏠 生活']){await run(`state.scene=${JSON.stringify(scene)};render()`);await wait(120);check(await run(`document.documentElement.scrollWidth<=innerWidth+1&&$('#musicAudio')===__audio`),'scene layout is stable '+scene);}
await run(`state.scene=SCENES[2];render()`);
for(const theme of ['warm','peach','night']){await run(`state.theme='${theme}';renderAppearance()`);await shot(theme);check(await run(`getComputedStyle($('#workspace .card')).color!==getComputedStyle($('#workspace .card')).backgroundColor`),'readable theme '+theme);}
for(const count of [6,24]){await run(`state.library={...state.library,...Object.fromEntries(Array.from({length:${count}},(_,i)=>['synthetic-'+i,{name:'合成入口 '+i,icon:'⌘'}]))};state.scenes[state.scene].apps=Array.from({length:${count}},(_,i)=>'synthetic-'+i);renderApps()`);await wait(100);check(await run(`$('#appGrid').children.length===${count}&&document.documentElement.scrollWidth<=innerWidth+1`),'natural entry wrapping '+count);}
await run(`didaDashboard.tasks=didaDashboard.tasks.slice(0,1);renderTasks()`);await wait(120);check(await run(`$('#taskColumn').getBoundingClientRect().bottom<=innerHeight+1`),'short task list recalculates viewport budget');
const sizeBefore=await run(`JSON.stringify([current().layout.entrySize,current().layout.entryStyle,current().layout.modules,state.tools,state.assistantLayout])`);
await click('#editBtn');await click('[data-viewport-preset=custom]');await click('#editBtn');check(await run(`JSON.stringify([current().layout.entrySize,current().layout.entryStyle,current().layout.modules,state.tools,state.assistantLayout])===${JSON.stringify(sizeBefore)}`),'preset does not overwrite entry geometry, module visibility, tools or assistant preferences');
await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1',desktop:'1'}});await wait(350);check(await run(`state.scenes['🔬 科研'].layout.viewportPreset==='custom'&&homepageReady`),'saved preset reloads in desktop page');
check(items===0&&parents===0,'layout changes never write remote tasks');check(errors.length===0,'no load or renderer errors');
await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,scope:'Real sandbox Electron native mouse, synthetic config/services. Window sizes in CSS pixels, desktop page styling only; no Explorer mount or real Windows DPI change.'},null,2));console.log('PASS '+checks.length+' layout checks');win.destroy();clearTimeout(watchdog);app.exit(0);
})().catch(async e=>{console.error(e);await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,failure:e.stack},null,2));clearTimeout(watchdog);app.exit(1)});
