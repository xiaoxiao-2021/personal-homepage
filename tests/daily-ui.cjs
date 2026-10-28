'use strict';
// Actual local Electron renderer; all content and integration APIs are synthetic.
const {app,BrowserWindow,ipcMain}=require('electron');
const fsSync=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results/daily-ui');
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
let ready=false,writes=0,launches=0,win;const errors=[],checks=[],measurements=[];
const check=(value,label)=>{assert(value,label);checks.push(label);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
ipcMain.handle('test:load',()=>({config:null}));
ipcMain.handle('test:save',()=>{writes++;return true;});
ipcMain.handle('test:fail-save',()=>false);
ipcMain.handle('test:launch-entry',()=>{launches++;return {ok:true};});
ipcMain.handle('test:assistant-status',()=>({configured:false,model:'deepseek-flash',session:{messages:[],input:'',preview:null}}));
ipcMain.on('test:page-ready',()=>{ready=true;});
ipcMain.on('test:page-error',(_e,error)=>errors.push(error));
ipcMain.on('test:music-state',()=>{});ipcMain.on('test:calendar-state',()=>{});
const run=code=>win.webContents.executeJavaScript(code,true);
async function settle(){await wait(120);await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function screenshot(name){win.webContents.sendInputEvent({type:'mouseMove',x:1,y:1});await settle();await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function click(selector,button='left'){
  const rect=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...rect});
  win.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...rect});
  win.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...rect});await settle();
}
const fixture=`(()=>{
  state=normalizeWithModules(clone(defaults));state.scene=SCENES[2];
  const names=['Zotero','Obsidian','浏览器','ChatGPT','Prism','VS Code','文献资料','项目文件','滴答清单','Word','PDF 阅读','参考书签'];
  for(let i=0;i<24;i++)state.library['sample-'+i]={name:names[i%names.length]+(i>=12?' '+(i+1):''),type:'网站',kind:'website',target:'https://example.invalid/'+i,icon:['Z','◈','◎','⌘','◭','⌨','▤','▱'][i%8],description:''};
  for(const scene of SCENES){state.scenes[scene].apps=Array.from({length:12},(_,i)=>'sample-'+i);state.scenes[scene].layout.modules.visible.side=false;state.scenes[scene].layout.heights.apps='content';}
  state.tools.codexQuotaCollapsed=true;
  dida={state:'connected',canComplete:true};
  const key=todayKey(),date=key+'T14:00:00+0800';
  const projects=SCENES.slice(1).map((scene,i)=>({id:'demo-p'+i,name:scene}));
  DIDA_GROUPS.forEach((group,i)=>state.didaListIds[group.key]='demo-p'+i);
  didaDashboard={source:'live',revision:1,projects,failedProjectIds:[],tasks:projects.flatMap(p=>[
    {id:p.id+'-1',projectId:p.id,title:'整理阅读笔记',status:0,dueDate:date,isAllDay:false},
    {id:p.id+'-2',projectId:p.id,title:'准备讨论提纲',status:0,checkItems:[{id:p.id+'-a',title:'选好参考资料',status:0},{id:p.id+'-b',title:'列出讨论要点',status:0}]},
    {id:p.id+'-3',projectId:p.id,title:'完善项目计划',status:0}
  ])};render();
  document.querySelector('#aiMessages').replaceChildren();
  for(const [role,text] of [['assistant','今天想安排些什么？'],['user','明天下午三点整理文献']]){const n=document.createElement('div');n.className='ai-message '+role;n.textContent=text;document.querySelector('#aiMessages').append(n);}
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="a" x2="0" y2="1"><stop stop-color="#e1ebe6"/><stop offset="1" stop-color="#eee4d3"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1600v1000H0z"/><path fill="#b6c9ba" opacity=".55" d="M0 720Q250 540 510 770T1020 730T1600 650v350H0Z"/><path fill="#d3ddcd" opacity=".8" d="M0 840Q400 700 800 860T1600 800v200H0Z"/></svg>';
  document.body.style.setProperty('--wallpaper-image','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
})()`;
async function load(file,query){ready=false;await win.loadFile(file,query?{query}:undefined);for(let i=0;i<100&&!ready;i++)await wait(50);check(ready,'page initialized: '+path.basename(file));await run(fixture);await settle();}
const watchdog=setTimeout(()=>{console.error('Daily UI test timed out');app.exit(1);},120000);
(async()=>{
  await fs.mkdir(output,{recursive:true});await app.whenReady();
  win=new BrowserWindow({show:false,width:1600,height:1000,useContentSize:true,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('did-fail-load',(_e,code)=>errors.push('load:'+code));
  win.webContents.on('render-process-gone',(_e,detail)=>errors.push('renderer:'+detail.reason));
  // Previous build's HTML, toolbar renderer and CSS, using the same synthetic content.
  const backup=path.resolve(root,'../homepage-backup-20261028-toolbar');
  if(fsSync.existsSync(path.join(backup,'src/index.html'))){
  let before=await fs.readFile(path.join(backup,'src/index.html'),'utf8');
  before=before.replace(/(href|src)="([^":]+\.(?:css|js))"/g,(_m,attr,file)=>`${attr}="${pathToFileURL(path.join(['renderer.js','daily-ui.css'].includes(file)?path.join(backup,'src'):path.join(root,'src'),file)).href}"`);
  const beforeFile=path.join(output,'before.html');await fs.writeFile(beforeFile,before);
  await load(beforeFile);await screenshot('before-1600');
  }
  await load(path.join(root,'src/index.html'));await screenshot('research-1600');
  check(await run(`$('#sceneNav').parentElement===document.querySelector('.top')`),'single toolbar contains scene navigation');
  const shared=await run(`window.__dailyTools=$('#moduleStack');window.__dailyAudio=$('#musicAudio');true`);
  const startingWrites=writes;
  for(let i=0;i<5;i++){
    await click('#sceneNav > :nth-child('+(i+1)+')');
    check(await run(`state.scene===SCENES[${i}]&&window.__dailyTools===$('#moduleStack')&&window.__dailyAudio===$('#musicAudio')`),'scene '+i+' retains shared tools/audio DOM');
    if([0,4].includes(i))await screenshot(i?'life-1600':'overview-1600');
  }
  check(writes-startingWrites===5,'each scene change keeps the existing single scene-preference save');
  await run('state.scene=SCENES[2];render()');await settle();
  for(const width of [1600,1440,1100,900,720,590,390,320]){
    win.setContentSize(width,1000);await settle();
    const metrics=await run(`(()=>{const r=n=>{const a=n.getBoundingClientRect();return {x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height}};const tools=$('#moduleCard'),send=$('#aiSend'),input=$('#aiInput'),assistant=$('#assistantCard');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,toolbar:r($('.top')),nav:r($('#sceneNav')),rail:r(tools),assistant:r(assistant),send:r(send),input:r(input),fit:$('#taskColumn').classList.contains('fit-window'),buttons:[...document.querySelectorAll('.top button')].filter(n=>!n.hidden).map(r),calendar:[...$('#calendarGrid').children].map(r)}})()`);
    measurements.push(metrics);check(!metrics.overflow,'no horizontal overflow at '+width);
    check(metrics.buttons.every(r=>r.x>=metrics.toolbar.x-1&&r.right<=metrics.toolbar.right+1),'toolbar buttons contained at '+width);
    check(metrics.send.bottom<=metrics.assistant.bottom&&metrics.send.y>=metrics.input.y,'assistant send control visible at '+width);
    check(metrics.calendar.every(r=>r.right<=metrics.rail.right+1&&r.x>=metrics.rail.x-1),'calendar columns contained at '+width);
    if(width>1100){check(metrics.fit,'left stack fits viewport at '+width);check(metrics.rail.bottom<=1000,'right rail fits viewport at '+width);}
    if(width===900||width===390)await screenshot('width-'+width);
  }
  win.setContentSize(1600,1000);await settle();
  for(const count of [6,24]){
    await run(`current().apps=Array.from({length:${count}},(_,i)=>'sample-'+i);renderApps()`);await settle();
    const values=await run(`(()=>{const cells=[...$('#appGrid').children].filter(n=>n.matches('.entry'));return {count:cells.length,columns:getComputedStyle($('#appGrid')).gridTemplateColumns,rows:new Set(cells.map(n=>n.offsetTop)).size,style:getComputedStyle(cells[0]).transform}})()`);
    check(values.count===count&&values.rows>1&&values.style==='none','adaptive grid wraps '+count+' entries without transforms');
    await screenshot('entries-'+count);
  }
  for(const theme of ['warm','peach','night']){await run(`state.theme=${JSON.stringify(theme)};render()`);await settle();check(await run(`getComputedStyle($('#aiSend')).backgroundColor!==getComputedStyle($('#aiSend')).color`),'send contrast has distinct colors in '+theme);await screenshot(theme);}
  await run(`state.theme='warm';render();$('#search').value='sample';$('#search').value='';renderApps()`);
  await click('#editBtn');check(await run('editing'),'native Electron edit input enters editing');
  check(await run(`$('#editBtn').getAttribute('aria-label')==='保存布局'&&$('#editBtn').classList.contains('is-editing')&&getComputedStyle($('#editBtn .toolbar-label')).position==='static'`),'editing exposes a readable save label instead of an ambiguous pencil');
  await run(`current().layout.entrySize='small';current().layout.spacing='spacious';renderLayout()`);await settle();
  check(await run(`$('#workspace').style.getPropertyValue('--entry-height')==='86px'&&$('#workspace').style.getPropertyValue('--entry-gap')==='19px'`),'saved entry size and gap continue to control grid');
  await click('#cancelEditBtn');check(await run('!editing&&current().layout.entrySize===\'medium\''),'cancel restores scene size preference');
  check(await run(`$('#editBtn').getAttribute('aria-label')==='编辑布局'&&$('#editBtn').getBoundingClientRect().width===36`),'cancel restores compact edit action');
  await click('#appGrid .entry','right');check(await run(`!$('#entryContextMenu').hidden`),'right-click menu still opens');
  await run('closeEntryMenu()');await click('#appGrid .entry');check(launches===1,'entry click reaches synthetic launch IPC once');
  const writesBeforeHover=writes;
  for(let i=0;i<6;i++){const p=await run(`(()=>{const r=$$('#appGrid .entry')[${i}].getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...p});await wait(20);}
  check(writes===writesBeforeHover,'native pointer sweep causes no config writes');
  await load(path.join(root,'src/index.html'),{desktop:'1'});check(await run(`document.body.classList.contains('desktop-home')&&document.documentElement.scrollWidth<=innerWidth`),'desktop page styling loads and fits');await screenshot('desktop-style');
  check(await run(`$('#desktopModeBtn').getAttribute('aria-label')==='返回普通窗口'`),'desktop page icon describes returning to an ordinary window');
  check(errors.length===0,'no observed page load or renderer errors');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,measurements,scope:'Isolated real Electron page, synthetic tasks/entries/wallpaper, native Electron input events, 320–1600 CSSpx. Desktop page styling only; no desktop mounting, physical pointer feel, DPI, real account writes or performance benchmark.'},null,2));
  console.log('PASS '+checks.length+' daily UI checks.');win.destroy();clearTimeout(watchdog);app.quit();
})().catch(async error=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({pageLoaded:ready,passed:checks.length,checks,errors,failure:error.stack,measurements},null,2));console.error(error);clearTimeout(watchdog);app.exit(1);});
