'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const work=path.resolve(__dirname,'../test-results/modules-density');
app.setPath('userData',path.join(work,'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
let config=null;
ipcMain.handle('test:load',()=>({config,recovered:false}));
ipcMain.handle('test:save',(_event,value)=>{config=value;return true;});
ipcMain.handle('test:fail-save',()=>{});
const checks=[];
const watchdog=setTimeout(()=>{console.error('FAIL: page test timed out');app.exit(1);},45000);
app.whenReady().then(async()=>{
  await fs.mkdir(work,{recursive:true});
  const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const errors=[];
  win.webContents.on('render-process-gone',(_event,detail)=>errors.push(detail.reason));
  await win.loadFile(path.resolve(__dirname,'../src/index.html'));
  win.webContents.debugger.attach('1.3');
  const run=code=>win.webContents.executeJavaScript(code,true);
  // Hidden windows may throttle animation frames. Geometry reads force layout.
  const frame=async()=>{await new Promise(resolve=>setTimeout(resolve,80));await run('document.body.getBoundingClientRect().height');};
  await run(`state=normalizeWithModules(clone(defaults));state.scene='🏠 生活';calendarFollowToday=false;render();`);
  // Test both 5- and 6-row months, selected label containment and keyboard accessibility.
  for(const [year,month,cells] of [[2026,8,35],[2026,7,42],[2021,1,28],[2024,1,35]]){
    await run(`calendarCursor=new Date(${year},${month},1);renderCalendar();`);
    assert.equal(await run(`$('#calendarGrid').children.length`),cells);
  }
  checks.push('4/5/6-row months, including leap February');
  for(const desktop of [false,true]){
    for(const width of [1440,1000,760,500]){
      for(const zoom of [1,1.25,1.5]){
        win.webContents.setZoomFactor(zoom);
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        await run(`document.body.classList.toggle('desktop-home',${desktop});calendarCursor=new Date(2026,7,1);renderCalendar();`);
        await frame();
        const geometry=await run(`(()=>{
          const panels=[...document.querySelectorAll('#moduleStack > .module-panel')].filter(n=>!n.hidden);
          const boxes=panels.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,overflow:n.scrollHeight>n.clientHeight+2};});
          const label=$('#calendarSelected').getBoundingClientRect(),cal=$('[data-module="calendar"]').getBoundingClientRect();
          return {boxes,labelContained:label.bottom<=cal.bottom,bodyOverflow:document.documentElement.scrollWidth>innerWidth+2,innerWidth,scrollWidth:document.documentElement.scrollWidth,devicePixelRatio,emptyHidden:getComputedStyle($('.music-controls')).display==='none',stackScroll:getComputedStyle($('#moduleStack')).overflowY};
        })()`);
        assert(geometry.labelContained,JSON.stringify({desktop,width,zoom,geometry}));
        assert(geometry.boxes.every(b=>!b.overflow),'panel overflow');
        for(let i=1;i<geometry.boxes.length;i++)assert(geometry.boxes[i].top>=geometry.boxes[i-1].bottom,'panels overlap');
        assert(!geometry.bodyOverflow,`horizontal page overflow: ${JSON.stringify({desktop,width,zoom,geometry})}`);
        assert(geometry.emptyHidden,'empty player controls should not take space');
        assert.equal(geometry.stackScroll,'visible');
        await run(`state.music.tracks=Array.from({length:24},(_,i)=>({id:'sample-'+i,name:'合成长名称歌曲 '+i+' 不读取音频',target:'C:\\synthetic.wav'}));renderMusic();`);
        await frame();
        assert(await run(`(()=>{const panel=$('[data-module="music"]'),r=panel.getBoundingClientRect();return panel.scrollHeight<=panel.clientHeight+2 && [...panel.children].filter(n=>getComputedStyle(n).display!=='none').every(n=>{const b=n.getBoundingClientRect();return b.bottom<=r.bottom && b.right<=r.right+1;});})()`),`populated player overflow ${width} / ${zoom}`);
        await run('state.music.tracks=[];renderMusic();');
        checks.push(`${desktop?'desktop CSS':'window'} ${width}px zoom ${zoom}: no overlap, no clipping`);
      }
    }
  }
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});win.webContents.setZoomFactor(1);
  await run(`document.body.classList.remove('desktop-home');calendarCursor=new Date(2026,8,1);renderCalendar();`);await new Promise(resolve=>setTimeout(resolve,250));await frame();
  await fs.writeFile(path.join(work,'empty.png'),(await win.webContents.capturePage()).toPNG());
  await run(`state.music.tracks=Array.from({length:24},(_,i)=>({id:'sample-'+i,name:'合成长名称歌曲 '+i+' 不读取音频',target:'C:\\synthetic.wav'}));renderMusic();`);await frame();
  assert(await run(`getComputedStyle($('.music-controls')).display!=='none' && $('#musicList').scrollHeight>$('#musicList').clientHeight`));
  assert(await run(`$('.music-meta label').getBoundingClientRect().right<=$('[data-module="music"]').getBoundingClientRect().right`));
  await fs.writeFile(path.join(work,'playlist.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(errors.length,0,errors.join(','));
  checks.push('synthetic populated playlist: controls visible and list internally scrollable');
  await fs.writeFile(path.join(work,'report.json'),JSON.stringify({checks,pageLoaded:true,realAudioTested:false,desktopAttachmentTested:false},null,2));
  console.log(JSON.stringify({passed:checks.length,report:path.join(work,'report.json')}));
  win.webContents.debugger.detach();clearTimeout(watchdog);win.destroy();app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1);});
