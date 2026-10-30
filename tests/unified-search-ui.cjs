'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../test-results/unified-search');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win,ready=0,saves=0,icons=0,reads=0,launches=0,writes=0;
const errors=[],checks=[];const check=(value,label)=>{assert(value,label);checks.push(label);};
const dashboard={source:'live',revision:1,projects:[{id:'c',name:'合成临床'},{id:'r',name:'合成科研'},{id:'u',name:'合成其他'}],tasks:[
 {id:'same',projectId:'c',title:'整理临床记录',status:0,dueDate:'2026-11-01',isAllDay:true},
 {id:'same',projectId:'r',title:'整理科研记录',status:0,dueDate:'2026-11-02',isAllDay:true,checkItems:[{id:'i1',title:'核对试剂库存',status:0},{id:'i2',title:'已完成库存',status:1}]},
 {id:'legacy',projectId:'r',title:'合成旧式父任务',status:0,subtasks:[{title:'无标识旧式小项',status:0}]},
 {id:'done',projectId:'r',title:'已结束父任务',status:2},
 {id:'unmapped',projectId:'u',title:'尚未关联场景的任务',status:0},
 {id:'html',projectId:'r',title:'<img src=x onerror=alert(1)>',status:0}
]};
const watchdog=setTimeout(()=>app.exit(1),110000);
async function main(){
 await fs.mkdir(output,{recursive:true});await app.whenReady();
 ipcMain.handle('test:load',()=>({config:null}));ipcMain.handle('test:save',()=>{saves++;return true;});
 ipcMain.handle('test:dida-status',()=>{reads++;return {state:'connected',canComplete:true};});
 ipcMain.handle('test:dida-dashboard',()=>{reads++;return dashboard;});
 ipcMain.handle('test:search-icon',()=>{icons++;return {kind:'fallback'};});
 ipcMain.handle('test:launch-entry',()=>{launches++;return {ok:true};});
 ipcMain.handle('test:dida-complete',()=>{writes++;return {ok:false};});ipcMain.handle('test:dida-complete-item',()=>{writes++;return {ok:false};});
 ipcMain.on('test:page-ready',()=>ready++);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('did-fail-load',(_e,code)=>errors.push('load:'+code));win.webContents.on('render-process-gone',(_e,detail)=>errors.push(detail.reason));
 const run=code=>win.webContents.executeJavaScript(code,true);
 const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await wait(30);}throw Error('Timed out: '+code);};
 const click=async selector=>{const r=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...r});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...r});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...r});await wait(80);};
 const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(60);};
 const search=async text=>{await click('#search');await key('A',['control']);await win.webContents.insertText(text);await until(`document.querySelector('#search').value===${JSON.stringify(text)}&&document.querySelector('#search').getAttribute('aria-expanded')==='true'`);await wait(50);};
 const capture=async name=>fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
 await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1',searchTest:'1'}});await until(`homepageReady===true&&!refreshInFlight`);check(ready===1,'sandboxed real Electron page loaded and reported ready');win.show();win.focus();
 await run(`state.didaListIds={clinical:'c',research:'r'};state.taskView={range:'inbox',dates:'today',inboxProjectId:'c'};state.taskViews['总览']={...state.taskView};state.scenes['🔬 科研'].layout.modules.visible.tasks=false;state.library.synthetic={name:'专用科研入口',type:'软件',description:'仅合成入口',kind:'application',target:'C:\\synthetic.exe',icon:'⌘'};state.scenes['🔬 科研'].apps.push('synthetic');render();`);await wait(300);
 const counts={saves,icons,reads};
 await run(`window.__task=document.querySelector('#tasks').firstChild;window.__grid=document.querySelector('#appGrid').firstChild;window.__audio=document.querySelector('#musicAudio');window.__calendar=document.querySelector('#calendarGrid').firstChild;window.__view=JSON.stringify(state.taskView);`);
 await search('专用科研入口');
 check(await run(`searchRows.length===1&&searchRows[0].scenes[0]==='🔬 科研'`),'finds entry from another scene');
 await key('Down');check(await run(`document.querySelector('#search').getAttribute('aria-activedescendant')===document.querySelector('#searchResults [role=option]').id`),'native arrow updates active descendant without leaving input');await key('Return');
 check(launches===1,'native Enter launches selected entry through existing bridge');
 check(await run(`document.querySelector('#search').getAttribute('aria-expanded')==='false'`),'selection closes search panel');
 await search('Obsidian');check(await run(`searchRows.filter(r=>r.kind==='entry').length===1&&searchRows[0].scenes.length>1`),'shared entry appears once with multiple scenes');
 await key('Escape');check(await run(`document.querySelector('.unified-search').hidden&&document.querySelector('#search').value==='Obsidian'`),'native Escape closes and keeps query');
 await click('#sceneNav');await key('K',['control']);check(await run(`document.activeElement===document.querySelector('#search')`),'Ctrl+K focuses search');
 await search('核对试剂');check(await run(`searchRows[0].kind==='subtask'&&document.querySelector('#searchResults').textContent.includes('整理科研记录')`),'unfinished small item includes parent title and list');
 await capture('task-results');await click('#searchResults [role=option]');
 check(await run(`state.scene==='🔬 科研'&&searchTaskLocation.taskId==='same'&&searchTaskLocation.projectId==='r'`),'native subtask selection locates exact project plus task identity');
 check(await run(`!document.querySelector('[data-card=tasks]').hidden&&document.querySelector('#tasks .search-hit').dataset.searchItem==='i1'`),'temporarily reveals hidden task module and highlights exact small item');
 check(await run(`document.querySelector('#tasks .search-hit').closest('details').open&&document.querySelector('#taskDates').value==='all'&&document.querySelector('#taskRange').disabled`),'opens date group and temporarily shows all dates without editable filter mismatch');
 check(await run(`JSON.stringify(state.taskView)===__view&&state.scenes['🔬 科研'].layout.modules.visible.tasks===false`),'saved task filters and hidden module preference unchanged');
 await capture('task-location');await click('#searchLocationBack');
 check(await run(`state.scene==='总览'&&!searchTaskLocation&&JSON.stringify(state.taskView)===__view&&!document.querySelector('#taskRange').disabled`),'return restores original scene and filters');
 check(await run(`document.querySelector('#musicAudio')===__audio&&document.querySelector('#calendarGrid').firstChild===__calendar`),'shared music/calendar identities survive task location and return');
 await search('无标识旧式小项');await key('Return');check(await run(`document.querySelector('#tasks .search-hit').textContent.includes('无标识旧式小项')`),'legacy text subtask locates by parent and item index');await click('#searchLocationBack');
 await search('无标识旧式小项');await run(`didaDashboard.tasks.find(t=>t.id==='legacy').subtasks.unshift({title:'新插入的不同小项',status:0});chooseSearchResult(0);`);await wait(80);
 check(await run(`!searchTaskLocation&&document.querySelector('#toast').textContent.includes('已变化')`),'stale legacy child index cannot select a different newly inserted item');
 await run(`didaDashboard.tasks.find(t=>t.id==='legacy').subtasks.shift();invalidateSearch()`);
 await search('尚未关联场景');await key('Return');check(await run(`state.scene==='总览'&&document.querySelector('#tasks .search-hit').dataset.searchTask===JSON.stringify(['u','unmapped'])`),'unmapped list task is located in overview');await click('#searchLocationBack');
 await run(`didaDashboard.tasks.push(...Array.from({length:35},(_,i)=>({id:'scroll-'+i,projectId:'c',title:'合成滚动任务 '+i,status:0,dueDate:'2026-11-05',isAllDay:true})));state.taskView.dates='all';collapsedTaskGroups.add('未设日期');renderTasks();document.querySelector('#tasks').scrollTop=90;window.__originalScroll=document.querySelector('#tasks').scrollTop;invalidateSearch();`);
 check(await run(`__originalScroll>0`),'synthetic task list has real scrollable content');
 await search('无标识旧式小项');await key('Return');await click('#searchLocationBack');
 check(await run(`document.querySelector('#tasks').scrollTop===__originalScroll&&collapsedTaskGroups.has('未设日期')`),'return restores real task scroll position and original collapsed groups');
 await search('已结束父任务');check(await run(`searchRows.length===0`),'completed parent excluded');await search('已完成库存');check(await run(`searchRows.length===0`),'completed small item excluded');
 await search('<img');check(await run(`!document.querySelector('#searchResults img')&&document.querySelector('#searchResults').textContent.includes('<img')`),'task titles rendered as text without HTML execution');
 await search('整理科研');dashboard.tasks=dashboard.tasks.filter(t=>t.id!=='same'||t.projectId!=='r');await run(`applyDidaDashboard(${JSON.stringify(dashboard)});`);await wait(120);check(await run(`searchRows.length===0`),'open results refresh when snapshot changes');
 dashboard.source='cache';dashboard.revision++;await run(`applyDidaDashboard(${JSON.stringify(dashboard)})`);await search('整理');check(await run(`document.querySelector('#searchStatus').textContent.includes('离线缓存')`),'offline cache clearly labelled');
 dashboard.source='partial';dashboard.failedCount=1;dashboard.failedProjectIds=['c'];dashboard.revision++;await run(`applyDidaDashboard(${JSON.stringify(dashboard)})`);await search('整理');check(await run(`searchRows.every(r=>r.projectId!=='c')&&document.querySelector('#searchStatus').textContent.includes('不完整')`),'failed lists excluded and partial scope disclosed');
 dashboard.failedProjectIds=[];dashboard.revision++;await run(`applyDidaDashboard(${JSON.stringify(dashboard)})`);await search('旧式');check(await run(`searchRows.length===0`),'unknown partial failure does not claim task completeness');
 dashboard.source='error';dashboard.revision++;await run(`applyDidaDashboard(${JSON.stringify(dashboard)})`);await search('专用');check(await run(`searchRows.length===1&&document.querySelector('#searchStatus').textContent.includes('仅搜索入口')`),'entry search works when task reads fail');
 await key('Escape');await click('#editBtn');await search('专用');await key('Return');check(launches===1,'edit mode search cannot launch applications');check(await run(`editing&&document.querySelector('#toast').textContent.includes('保存或取消')`),'unsaved editor remains active with clear guidance');await key('Escape');await click('#cancelEditBtn');
 await run(`searchInput.value='';searchInput.dispatchEvent(new Event('input'));searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);
 check(await run(`searchInput.getAttribute('aria-expanded')==='false'&&!searchInput.hasAttribute('aria-activedescendant')`),'empty query arrows do not reactivate stale hidden options (synthetic boundary event)');
 await run(`searchInput.value='专用';searchInput.dispatchEvent(new Event('input'));searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);await wait(70);
 check(await run(`searchInput.getAttribute('aria-activedescendant')==='search-result-0'`),'arrow during queued input keeps selection after next frame (synthetic boundary event)');
 // Repeated native text input must leave grid/task DOM intact and avoid side effects.
 await run(`window.__task=document.querySelector('#tasks').firstChild;window.__grid=document.querySelector('#appGrid').firstChild;`);
 const idle={saves,icons,reads,launches};for(let i=0;i<15;i++)await search(i%2?'专用':'整理');
 check(await run(`document.querySelector('#tasks').firstChild===__task&&document.querySelector('#appGrid').firstChild===__grid`),'repeated typing preserves task and entry grid DOM');
 check(saves===idle.saves&&icons===idle.icons&&reads===idle.reads&&launches===idle.launches&&writes===0,'typing triggers zero config writes, extra icon reads, Dida reads/writes or launches');
 for(const theme of ['warm','peach','night']){
   await run(`state.theme=${JSON.stringify(theme)};renderAppearance()`);await search('专用');await key('Down');await capture(theme);
   check(await run(`getComputedStyle(document.querySelector('.unified-search')).backgroundColor!=='rgba(0, 0, 0, 0)'&&document.querySelector('[role=option][aria-selected=true]')!==null`),theme+' popup has opaque themed surface and active selection');
 }
 for(const desktop of [false,true]){
  await key('Escape');await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1',searchTest:'1',...(desktop?{desktop:'1'}:{})}});await until(`homepageReady===true&&!refreshInFlight`);
  for(const width of [1440,900,590,320]){win.setContentSize(width,800);await wait(70);await search('Obsidian');check(await run(`(()=>{const r=document.querySelector('.unified-search').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1})()`),`${desktop?'desktop CSS':'window'} ${width}px popup contained in viewport`);}
 }
 check(errors.length===0,'no load or renderer errors');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:true,passed:checks.length,checks,errors,counts:{saves,icons,reads,launches,writes},scope:'Sandboxed real Electron UI, native mouse and keyboard, synthetic tasks/config/APIs. Desktop CSS only, no native desktop mount, real account, user files or music.'},null,2));
 console.log(`PASS ${checks.length} unified search checks`);clearTimeout(watchdog);win.destroy();app.exit(0);
}
main().catch(async error=>{errors.push(error.stack);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready>0,passed:checks.length,checks,errors},null,2));console.error(error);app.exit(1);});
