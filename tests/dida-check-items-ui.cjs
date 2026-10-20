'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCheckItemCompletion}=require('../dida-check-items.cjs'),{createDidaCompletion}=require('../dida-completion.cjs');
const output=path.resolve(__dirname,'../test-results/dida-check-items'),configFile=path.join(output,'ui-config.json'),cacheFile=path.join(output,'synthetic-cache.json');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const clone=x=>structuredClone(x),checks=[],errors=[],calls=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(v,label)=>{assert(v,label);checks.push(label);};
let win,ready=false,context,canComplete=false,source='live',reject=true,parentWrites=0,itemCalls=0,transitions=0;
let server={id:'t1',projectId:'p1',title:'合成父任务：核对实验安排',status:0,isAllDay:true,dueDate:'2026-10-21T00:00:00+0800',timeZone:'Asia/Shanghai',content:'保留这段合成备注',items:[{id:'i1',title:'准备合成材料',status:0},{id:'i2',title:'用于检查自动换行的合成长名称小项：核对材料、整理记录和阅读说明，不应遮挡完成方框',status:0},{id:'i3',title:'其他客户端完成的合成小项',status:0},{id:'i4',title:'待后续处理的小项',status:0},{id:'done',title:'之前已完成的合成小项',status:1}]};
const rawMissing={id:'missing',projectId:'p1',title:'合成缺失标识案例',status:0,items:[{id:'',title:'这个小项没有稳定 ID',status:0}]};
const dashboard=()=>({source,revision:context?.didaRevision||0,projects:[{id:'p1',name:'合成清单'}],failedProjectIds:source==='partial'?['p1']:[],tasks:[context.sanitizeDidaTask(server,'p1'),context.sanitizeDidaTask(rawMissing,'p1')]});
const transport=async(url,init)=>{
  const method=init.method||'GET';calls.push({method,url});await wait(60);
  if(url.endsWith('/complete')){parentWrites++;return {ok:false,status:500};}
  if(method==='POST'){if(reject)return {ok:false,status:403};const body=JSON.parse(init.body);check(!Object.hasOwn(body,'status')&&body.content===server.content,'actual main bridge writes items without parent completion fields and keeps notes');server={...server,items:body.items};return {ok:true,status:201};}
  return {ok:true,status:200,json:async()=>clone(server)};
};
ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));ipcMain.handle('test:save',async(_e,c)=>{await fs.writeFile(configFile,JSON.stringify(c));return true;});
ipcMain.handle('test:assistant-status',()=>({configured:false}));ipcMain.handle('test:dida-status',()=>({state:'connected',canComplete}));
ipcMain.handle('test:dida-dashboard',()=>{context.latestDidaDashboard=dashboard();return clone(context.latestDidaDashboard);});
ipcMain.handle('test:dida-complete-item',(_e,p,t,id,occurrence,item)=>{itemCalls++;return context.completeDidaTask(p,t,occurrence,id,item);});
ipcMain.handle('test:dida-complete',()=>{parentWrites++;return {ok:false};});ipcMain.handle('test:transition',()=>{transitions++;return {ok:true};});
ipcMain.on('test:page-ready',()=>ready=true);ipcMain.on('test:page-error',(_e,error)=>errors.push(error));ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const timeout=setTimeout(()=>app.exit(1),90000);
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const main=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8');let queue=Promise.resolve();
  context=vm.createContext({didaRevision:0,didaAuthorization:null,latestDidaDashboard:null,taskCompletionFlights:new Map(),queueDidaOperation:fn=>{const pending=queue.then(fn);queue=pending.catch(()=>{});return pending;},readProtectedJson:async()=>JSON.parse(await fs.readFile(cacheFile,'utf8')),writeProtectedJson:async(_p,c)=>fs.writeFile(cacheFile,JSON.stringify(c)),didaCachePath:()=>cacheFile,didaDashboard:async()=>dashboard()});
  vm.runInContext(main.slice(main.indexOf('function sanitizeDidaTask('),main.indexOf('async function loadDidaProjectData('))+main.slice(main.indexOf('function completeDidaTask('),main.indexOf('function showHomepage(')),context);
  const credential=async()=>({scope:'tasks:read tasks:write',accessToken:'synthetic-only'});
  context.checkItemCompletion=createCheckItemCompletion({getCredential:credential,getDashboard:()=>context.latestDidaDashboard,fetch:transport,apiUrl:'https://synthetic.invalid/open/v1'});
  context.taskCompletion=createDidaCompletion({getCredential:credential,getDashboard:()=>context.latestDidaDashboard,fetch:transport,apiUrl:'https://synthetic.invalid/open/v1'});
  context.latestDidaDashboard=dashboard();await fs.writeFile(cacheFile,JSON.stringify(dashboard()));
  const renderer=await fs.readFile(path.resolve(__dirname,'../src/renderer.js'),'utf8'),fixture=vm.createContext({URLSearchParams,location:{search:''},Date,Intl,Math,JSON});
  vm.runInContext(renderer.slice(0,renderer.indexOf('function entry(id)'))+'\nglobalThis.seed=JSON.parse(JSON.stringify(defaults));',fixture);
  fixture.seed.didaListIds={clinical:'p1',research:'p1',study:'p1',life:'p1'};await fs.writeFile(configFile,JSON.stringify(fixture.seed));await app.whenReady();
  const open=async()=>{
    ready=false;win=new BrowserWindow({show:false,width:1280,height:1050,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('did-fail-load',(_e,c)=>errors.push(`load:${c}`));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
    await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:{completionTest:'1'}});win.show();win.focus();for(let n=0;n<100&&!ready;n++)await wait(40);await wait(120);check(ready,'normal page initialization acknowledged');
  };
  const js=c=>win.webContents.executeJavaScript(c,true),click=id=>js(`document.getElementById('${id}').click()`),item=id=>js(`document.querySelector('[data-check-item-id="${id}"]').click()`);
  const shot=async name=>{await js(`window.scrollTo(0,0);document.querySelector('#tasks').scrollTop=0`);win.focus();await wait(300);await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());if(name==='items-after'){const rect=await js(`(()=>{const r=document.querySelector('.task-card').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(Math.min(r.height,innerHeight-r.y))};})()`);await fs.writeFile(path.join(output,'items-detail.png'),(await win.webContents.capturePage(rect)).toPNG());}};
  await open();check(await js(`document.querySelectorAll('[data-parent-task-id="t1"]').length===5`),'all five check items rendered from normal dashboard');
  check(await js(`(()=>{const p=document.querySelector('[data-task-id="t1"]').getBoundingClientRect(),b=document.querySelector('[data-check-item-id="i1"]'),r=b.getBoundingClientRect(),v=getComputedStyle(b,'::before');return p.width===22&&p.height===22&&r.width>=24&&r.height>=24&&parseFloat(v.width)===16&&parseFloat(v.height)===16&&v.borderTopWidth==='1px';})()`),'child visual is 16px with 1px border; parent remains 22px and child hit target remains 24px');
  check(await js(`document.querySelector('[data-check-item-id="done"]').getAttribute('aria-checked')==='true'&&document.querySelector('[data-check-item-id="done"]').disabled`),'official status 1 shown as checked, not treated as pending');
  check(await js(`getComputedStyle(document.querySelector('[data-check-item-id="done"]')).backgroundClip==='content-box'`),'checked fill stays inside the small visual, not the hit target');
  check(await js(`document.querySelector('[data-check-item-id=""]').disabled`),'missing stable item ID cannot submit');
  await item('i1');check(await js(`document.querySelector('#taskPermissionDialog').open`)&&itemCalls===0,'read-only click explains permission without task write or auto-authorization');await click('taskPermissionCancel');
  canComplete=true;await click('didaRefresh');await wait(220);await shot('items-before');
  const beforeCache=await fs.readFile(cacheFile,'utf8');
  const hit=await js(`(()=>{const b=document.querySelector('[data-check-item-id="i1"]'),r=b.getBoundingClientRect(),x=Math.floor(r.x+1),y=Math.floor(r.y+r.height/2);return {x,y,inside:document.elementFromPoint(x,y)===b};})()`);
  check(hit.inside,'transparent margin outside the small visual still belongs to child control');
  win.webContents.sendInputEvent({type:'mouseMove',x:hit.x,y:hit.y});await wait(30);check(await js(`getComputedStyle(document.querySelector('[data-check-item-id="i1"]')).backgroundClip==='content-box'`),'native hover does not enlarge the child visual fill');
  win.webContents.sendInputEvent({type:'mouseDown',x:hit.x,y:hit.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:hit.x,y:hit.y,button:'left',clickCount:1});await wait(25);await item('i1');await wait(25);
  check(itemCalls===1,'continuous duplicate clicks issue one item operation');
  check(await js(`document.querySelector('[data-task-id="t1"]').disabled&&document.querySelector('[data-check-item-id="i2"]').disabled`),'same parent and sibling controls locked while saving');
  await js(`requestPageTransition('quit')`);check(transitions===0&&await js(`document.querySelector('#toast').textContent.includes('正在同步')`),'exit request while saving stays in page');
  await wait(300);check(await js(`document.querySelector('[data-check-item-id="i1"]').getAttribute('aria-checked')==='false'&&document.querySelector('.check-item .task-complete-error').textContent.includes('拒绝')`),'known failure leaves item unchecked with inline text');
  check(await fs.readFile(cacheFile,'utf8')===beforeCache,'failed write never changes isolated cached completion');
  reject=false;await item('i1');await wait(350);
  check(await js(`document.querySelector('[data-check-item-id="i1"]').getAttribute('aria-checked')==='true'&&!!document.querySelector('[data-task-id="t1"]')`),'acknowledged item remains checked while parent remains visible');
  const cached=JSON.parse(await fs.readFile(cacheFile,'utf8')).tasks.find(t=>t.id==='t1');check(cached.status===0&&cached.checkItems.find(i=>i.id==='i1').status===1,'actual main wrapper patches isolated cache with child only');
  check(parentWrites===0,'item operation never calls parent completion endpoint');
  const previous=itemCalls;await item('i1');check(itemCalls===previous,'checked disabled item cannot submit or undo');
  await js(`document.querySelector('[data-check-item-id="i2"]').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(350);
  check(await js(`document.querySelector('[data-check-item-id="i2"]').getAttribute('aria-checked')==='true'&&!document.querySelector('#taskCompleteConfirmDialog').open`),'native Space checks a child without opening parent confirmation');
  const postCount=calls.filter(c=>c.method==='POST').length;server.items.find(i=>i.id==='i3').status=1;await item('i3');await wait(180);check(calls.filter(c=>c.method==='POST').length===postCount&&await js(`document.querySelector('[data-check-item-id="i3"]').getAttribute('aria-checked')==='true'`),'remote completion is reconciled without a second update');
  await click('editBtn');check(await js(`document.querySelector('[data-check-item-id="i4"]').disabled`),'layout edit blocks task writes');await click('cancelEditBtn');
  for(let scene=0;scene<5;scene++){await js(`document.querySelector('#sceneNav').children[${scene}].click()`);await wait(65);check(await js(`document.querySelector('[data-check-item-id="i1"]').getAttribute('aria-checked')==='true'`),`scene ${scene} retains acknowledged check by stable ID`);}
  source='cache';await click('didaRefresh');await wait(180);check(await js(`document.querySelector('[data-check-item-id="i4"]').disabled`),'offline cached items are read-only');
  source='partial';await click('didaRefresh');await wait(180);check(await js(`document.querySelector('[data-check-item-id="i4"]').disabled`),'failed partial project item cannot write');
  source='live';await click('didaRefresh');await wait(180);await shot('items-after');
  for(const theme of ['night','peach']){await click('themeBtn');await js(`document.querySelector('#theme').value='${theme}';document.querySelector('#theme').dispatchEvent(new Event('input'))`);await click('appearanceSave');await wait(100);check(await js(`document.querySelector('#tasks').scrollWidth<=document.querySelector('#tasks').clientWidth`),`${theme} item list has no horizontal clipping`);check(await js(`parseFloat(getComputedStyle(document.querySelector('[data-check-item-id="i4"]'),'::before').width)===16`),`${theme} keeps secondary checkbox small`);await shot('items-'+theme);}
  for(const width of [900,520]){win.setSize(width,950);await wait(120);check(await js(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#tasks').scrollWidth<=document.querySelector('#tasks').clientWidth`),`${width}px long item wraps without overflow`);if(width===520)await shot('items-narrow');}
  for(const zoom of [1.25,1.5]){win.webContents.setZoomFactor(zoom);await wait(120);check(await js(`document.documentElement.scrollWidth<=innerWidth`),`${zoom} page zoom preserves readable item layout`);}win.webContents.setZoomFactor(1);
  win.destroy();await open();check(await js(`document.querySelector('[data-check-item-id="i1"]').getAttribute('aria-checked')==='true'`),'reopening uses confirmed service state rather than local fake check');
  check(!JSON.stringify(JSON.parse(await fs.readFile(configFile,'utf8'))).includes('checkItems'),'layout config never stores task completion data');check(errors.length===0,'no initialization or unhandled errors');
  await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,parentWrites,itemCalls,scope:'Real Electron initialization, controls and native Space; synthetic Dida transport, production completion/cache wrapper extracted from main, actual isolated disk cache. No real task/account/authorization, desktop mounting or Windows DPI test.'},null,2));win.destroy();clearTimeout(timeout);app.exit(0);
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify({pageLoaded:ready,checks,errors,failure:String(error.stack)},null,2));clearTimeout(timeout);app.exit(1);});
