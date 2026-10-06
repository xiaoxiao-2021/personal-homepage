'use strict';
// Real, sandboxed Electron renderer; synthetic input/data, never production config.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const stage=process.argv.includes('--after')?'after':'before';
const output=path.resolve(__dirname,'../test-results/scroll-performance',stage);
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>{console.error('Timed out');app.exit(1);},90000);
const scenes=['总览','🏥 临床','🔬 科研','📚 学习','🏠 生活'];
let config,ready=0,saves=0,musicReports=0;
function fixture(count){
 const ids=Array.from({length:count},(_,i)=>`synthetic-${i}`);
 return {version:1,scene:scenes[0],theme:'warm',shortcut:'Control+Alt+H',
  library:Object.fromEntries(ids.map((id,i)=>[id,{name:`合成入口 ${i+1}`,type:'软件',icon:'◇',description:'仅测试，无本机地址'}])),
  scenes:Object.fromEntries(scenes.map(s=>[s,{apps:ids,side:[],layout:{heights:{tasks:'content',apps:'content',side:'content'}}}])),
  tools:{version:1,visible:{time:true,calendar:true,music:true},order:['time','calendar','music'],sizes:{time:'medium',calendar:'medium',music:'medium'}},
  appearance:{glass:'frosted',dim:8,fit:'cover',position:'center'}, music:{tracks:[],volume:.8}};
}
async function main(){
 console.log('probe starting');await fs.mkdir(output,{recursive:true});await app.whenReady();console.log('app ready');
 ipcMain.handle('test:load',()=>({config,recovered:false}));
 ipcMain.handle('test:save',async(_e,c)=>{saves++;config=c;await fs.writeFile(path.join(output,'isolated-config.json'),JSON.stringify(c));return true;});
 ipcMain.handle('test:fail-save',()=>false);
 ipcMain.on('test:page-ready',()=>ready++);
 ipcMain.on('test:music-state',()=>musicReports++);
 const win=new BrowserWindow({show:false,width:1440,height:720,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
 ipcMain.on('test:page-error',(_e,message)=>errors.push(message));
 win.webContents.on('did-fail-load',(_e,c,d)=>errors.push(`${c}: ${d}`));
 win.webContents.debugger.attach('1.3');
 win.webContents.debugger.on('message',(_e,m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails.text+': '+p.exceptionDetails.exception?.description);});
 const run=code=>win.webContents.executeJavaScript(code,true);
 const metrics=async()=>Object.fromEntries((await win.webContents.debugger.sendCommand('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const loadPage=async()=>{const previous=ready;await win.loadFile(path.resolve(__dirname,'../src/index.html'));for(let i=0;i<50&&ready===previous;i++)await wait(100);assert(ready>previous,'pageReady required');assert.equal(await run(`document.querySelectorAll('#sceneNav button').length`),5);};
 const results=[];
 for(const count of [6,24]){
  config=fixture(count);console.log('loading',count);await loadPage();console.log('page ready',count);win.showInactive();await wait(500);
  await win.webContents.debugger.sendCommand('Runtime.enable');
  await win.webContents.debugger.sendCommand('Performance.enable');
  // Same generated gradient is already the default synthetic background.
  const variants=stage==='before'?['original','no-blur']:['smooth','full'];
  for(const variant of variants){
   let css;
   if(variant==='no-blur')css=await win.webContents.insertCSS('.card,.top,.scenes,.status{backdrop-filter:none!important}');
   if(stage==='after')await run(`document.querySelector('#themeBtn').click();document.querySelector('#renderQuality').value='${variant}';document.querySelector('#renderQuality').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#appearanceSave').click();`);
   await wait(300);await run('window.scrollTo(0,0)');
   const before=await metrics();const countBefore={saves,musicReports};
   await run(`window.__perf={frames:[],longTasks:[],last:0,mutations:0};window.__perf.observer=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__perf.longTasks.push(e.duration)});window.__perf.observer.observe({type:'longtask',buffered:false});window.__perf.mutation=new MutationObserver(rs=>window.__perf.mutations+=rs.length);window.__perf.mutation.observe(document.querySelector('#appGrid'),{childList:true,subtree:true,attributes:true});window.__perf.tick=t=>{if(window.__perf.last)window.__perf.frames.push(t-window.__perf.last);window.__perf.last=t;window.__perf.raf=requestAnimationFrame(window.__perf.tick)};window.__perf.raf=requestAnimationFrame(window.__perf.tick);`);
   const resources=[];let maxScroll=0;
   for(let i=0;i<80;i++){
    // Actual Electron input dispatch, not CSS class toggles; not physical mouse validation.
    const entry=await run(`(()=>{const n=document.querySelectorAll('.entry')[${i%count}];const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.max(1,Math.min(1400,entry.x)),y:Math.max(1,Math.min(620,entry.y))});
    win.webContents.sendInputEvent({type:'mouseWheel',x:15,y:400,deltaY:i%40<20?-50:50,deltaX:0});
    if(i%10===0){resources.push(app.getAppMetrics().map(m=>({cpu:m.cpu.percentCPUUsage,workingSetKB:m.memory.workingSetSize})));maxScroll=Math.max(maxScroll,await run('scrollY'));}
    await wait(50);
   }
   const sample=await run(`(()=>{const p=window.__perf;cancelAnimationFrame(p.raf);p.observer.disconnect();p.mutation.disconnect();return {frames:p.frames,longTasks:p.longTasks,mutations:p.mutations,hover:!!document.querySelector('.entry:hover'),backdrop:getComputedStyle(document.querySelector('.apps-card')).backdropFilter}})()`);
   const after=await metrics();const sorted=sample.frames.slice().sort((a,b)=>a-b);
   const totals=resources.map(group=>({cpu:group.reduce((n,m)=>n+m.cpu,0),mb:group.reduce((n,m)=>n+m.workingSetKB,0)/1024}));
   const result={count,variant,frames:sorted.length,p50ms:sorted[Math.floor(sorted.length*.5)],p95ms:sorted[Math.floor(sorted.length*.95)],over50ms:sorted.filter(n=>n>50).length,longTasks:sample.longTasks,gridMutations:sample.mutations,backdrop:sample.backdrop,maxScroll,
    taskMs:(after.TaskDuration-before.TaskDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,
    cpuSampleMean:totals.reduce((n,m)=>n+m.cpu,0)/totals.length,workingSetMeanMB:totals.reduce((n,m)=>n+m.mb,0)/totals.length,writesDuringInput:saves-countBefore.saves,musicReportsDuringInput:musicReports-countBefore.musicReports};
   assert(maxScroll>0,'wheel must actually scroll the document');assert.equal(result.writesDuringInput,0);assert.equal(result.gridMutations,0);
   results.push(result);console.log(JSON.stringify(result));
   await run('window.scrollTo(0,0)');await wait(100);await fs.writeFile(path.join(output,`${count}-${variant}.png`),(await win.webContents.capturePage()).toPNG());
   if(css)await win.webContents.removeInsertedCSS(css);
  }
 }
 assert.deepEqual(errors,[]);
 const report={stage,pageLoaded:true,syntheticInput:true,electron:process.versions.electron,window:[1440,720],gpu:app.getGPUFeatureStatus(),results,errors};
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));clearTimeout(timeout);win.destroy();app.exit(0);
}
main().catch(async e=>{console.error(e);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.txt'),String(e.stack));app.exit(1);});
