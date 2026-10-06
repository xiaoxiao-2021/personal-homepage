'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../test-results/responsiveness');
const configFile=path.join(output,'isolated-config.json');
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>app.exit(1),60000);
let ready=0,fail=false,slow=false,musicReports=0;
async function main(){
 await fs.mkdir(output,{recursive:true});await fs.writeFile(configFile,'null');await app.whenReady();
 ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8'))}));
 ipcMain.handle('test:save',async(_e,c)=>{if(fail){fail=false;throw Error('synthetic failure');}if(slow)await wait(600);await fs.writeFile(configFile,JSON.stringify(c));return true;});
 ipcMain.handle('test:fail-save',()=>{fail=true;return true;});
 ipcMain.on('test:page-ready',()=>ready++);ipcMain.on('test:music-state',()=>musicReports++);
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('did-fail-load',(_e,c,d)=>errors.push(`${c} ${d}`));win.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));
 ipcMain.on('test:page-error',(_e,message)=>errors.push(message));
 const run=s=>win.webContents.executeJavaScript(s,true);
 const until=async expression=>{for(let i=0;i<60;i++){if(await run(expression))return;await wait(40);}throw Error('Timed out: '+expression);};
 const load=async desktop=>{let prev=ready;await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:desktop?{desktop:'1'}:{}});for(let i=0;i<50&&ready===prev;i++)await wait(50);assert(ready>prev);await wait(100);};
 await load(false);win.showInactive();
 await run(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));`);
 const checks=[];
 assert.equal(await run(`document.body.classList.contains('effects-smooth')`),true);
 checks.push('new/default config uses reversible smooth policy');
 await run(`window.__calendar=document.querySelector('#calendarGrid').firstChild;window.__audio=document.querySelector('#musicAudio');window.__task=document.querySelector('#tasks').firstChild;document.querySelector('#search').value='Obsidian';document.querySelector('#search').dispatchEvent(new Event('input'));`);
 await until(`document.querySelectorAll('#appGrid .entry').length===1`);
 assert.equal(await run(`document.querySelector('#tasks').firstChild===__task&&document.querySelector('#appGrid .entry').dataset.entry==='obsidian'`),true);
 await run(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));`);await wait(100);
 const musicBefore=musicReports;slow=true;
 await run(`document.querySelectorAll('[data-scene]')[2].click()`);
 await until(`document.querySelector('#sceneTitle').textContent==='🔬 科研'`);
 assert.equal(await run(`document.querySelector('#calendarGrid').firstChild===__calendar&&document.querySelector('#musicAudio')===__audio`),true);
 await wait(700);slow=false;assert.equal(musicReports,musicBefore);
 checks.push('search keeps task DOM; scene renders before slow disk save; shared calendar/audio identity and tray reports stable');
 // Silent synthetic PCM only: exercises the real media element, not file access.
 const wav=Buffer.alloc(44+16000*2*8);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await run(`(async()=>{const a=document.querySelector('#musicAudio');a.muted=true;a.src='data:audio/wav;base64,${wav.toString('base64')}';await a.play();})()`);
 await wait(300);const audioBefore=await run(`document.querySelector('#musicAudio').currentTime`);
 await run(`document.querySelectorAll('[data-scene]')[3].click()`);await wait(400);
 assert.equal(await run(`document.querySelector('#musicAudio')===__audio&&!__audio.paused&&__audio.currentTime>${audioBefore}`),true);
 await run(`document.querySelector('#musicAudio').pause()`);
 checks.push('synthetic silent WAV decoded and progressed across scene change; same media element (not local file/tray/native mode validation)');
 await run(`document.querySelector('[data-calendar-nav="next"]').click();window.__month=document.querySelector('#calendarLabel').textContent;document.querySelectorAll('[data-scene]')[4].click()`);await wait(100);
 assert.equal(await run(`document.querySelector('#calendarLabel').textContent===__month`),true);
 await run(`document.querySelector('#themeBtn').click();document.querySelector('#renderQuality').value='full';document.querySelector('#renderQuality').dispatchEvent(new Event('input',{bubbles:true}));`);
 assert.equal(await run(`getComputedStyle(document.querySelector('.apps-card')).backdropFilter.includes('blur')`),true);
 await run(`document.querySelector('#appearanceCancel').click()`);await wait(60);
 assert.equal(await run(`getComputedStyle(document.querySelector('.apps-card')).backdropFilter`),'none');
 await run(`document.querySelector('#themeBtn').click();document.querySelector('#renderQuality').value='full';document.querySelector('#renderQuality').dispatchEvent(new Event('input',{bubbles:true}));`);
 fail=true;await run(`document.querySelector('#appearanceSave').click()`);await wait(150);
 assert.equal(await run(`document.querySelector('#themeDialog').open&&document.querySelector('#toast').textContent.includes('失败')`),true);
 await run(`document.querySelector('#appearanceSave').click()`);await until(`!document.querySelector('#themeDialog').open`);
 assert.equal(JSON.parse(await fs.readFile(configFile,'utf8')).appearance.renderQuality,'full');
 await load(false);assert.equal(await run(`document.body.classList.contains('effects-smooth')`),false);
 checks.push('quality preview/cancel/failure/retry and on-disk reload verified');
 await run(`document.querySelector('#themeBtn').click();document.querySelector('#renderQuality').value='smooth';document.querySelector('#renderQuality').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#theme').value='night';document.querySelector('#theme').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#appearanceSave').click()`);await until(`!document.querySelector('#themeDialog').open`);
 await run(`document.querySelector('#editBtn').click();document.querySelector('.display-settings summary').click()`);
 assert.equal(await run(`document.querySelector('#cancelEditBtn').hidden`),false);
 await wait(150);
 assert.equal(await run(`document.querySelector('#editBtn').textContent`),'保存布局');
 await fs.writeFile(path.join(output,'night-edit.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('#cancelEditBtn').click()`);
 for(const desktop of [false,true]){
  await load(desktop);
  for(const width of [1440,900,590]){
   win.setContentSize(width,900);await wait(100);
   for(const index of [0,1,2,3,4]){
    await run(`document.querySelectorAll('[data-scene]')[${index}].click()`);await wait(80);
    assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth+1`),true,`overflow: desktop CSS ${desktop}, ${width}, scene ${index}`);
    assert.equal(await run(`getComputedStyle(document.querySelector('.apps-card')).backdropFilter`),'none');
   }
  }
 }
 checks.push('five scenes x three widths x ordinary/desktop CSS; no horizontal overflow (not native desktop attachment)');
 await load(false);assert.equal(await run(`document.body.classList.contains('effects-smooth')`),true);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,pageLoaded:true,limits:['mock system APIs','no native desktop attachment','no real music or Dida data']},null,2));
 console.log(JSON.stringify({checks,errors}));clearTimeout(watchdog);win.destroy();app.exit(0);
}
main().catch(async e=>{console.error(e);await fs.writeFile(path.join(output,'failure.txt'),String(e.stack));app.exit(1);});
