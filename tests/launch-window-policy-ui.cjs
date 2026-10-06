'use strict';
// Real sandboxed renderer/window with synthetic IPC and target; never opens a user app.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const output=path.resolve(__dirname,'../test-results/launch-window-policy');
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const watchdog=setTimeout(()=>{console.error('FAIL: launch window policy test timed out');app.exit(1);},60000);

async function main(){
  await fs.mkdir(output,{recursive:true});await app.whenReady();
  const source=await fs.readFile(path.resolve(__dirname,'../main.cjs'),'utf8');
  const launchSource=source.match(/async function launchEntry\(entry\) \{[\s\S]*?\n\}/)?.[0];
  assert(launchSource,'production launchEntry function is present');
  let launchMode='success',launchCalls=0,ready=0;
  const policy={shell:{},launchValidatedEntry:async()=>{launchCalls++;await wait(80);return launchMode==='failure'?{ok:false,error:'合成启动失败'}:{ok:true};}};
  vm.createContext(policy);vm.runInContext(launchSource,policy);
  ipcMain.handle('test:load',()=>({config:null,recovered:false}));
  ipcMain.handle('test:save',()=>true);ipcMain.handle('test:fail-save',()=>true);
  ipcMain.handle('test:launch-entry',(_event,entry)=>vm.runInContext(`launchEntry(${JSON.stringify(entry)})`,policy));
  ipcMain.on('test:page-ready',()=>ready++);ipcMain.on('test:music-state',()=>{});ipcMain.on('test:page-error',(_event,message)=>errors.push(message));
  let win;
  ipcMain.handle('test:hide',()=>{if(win&&!win.isDestroyed())win.hide();});
  const errors=[];
  win=new BrowserWindow({show:false,width:1100,height:760,skipTaskbar:false,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('did-fail-load',(_e,code,description)=>errors.push(`${code}: ${description}`));
  win.webContents.on('render-process-gone',(_e,detail)=>errors.push(detail.reason));
  const run=code=>win.webContents.executeJavaScript(code,true);
  const load=async desktop=>{const before=ready;await win.loadFile(path.resolve(__dirname,'../src/index.html'),{query:desktop?{desktop:'1'}:{}});for(let i=0;i<50&&ready===before;i++)await wait(50);assert(ready>before,'pageReady required');await run(`state.library.browser={...state.library.browser,kind:'website',target:'https://example.invalid/'};renderApps()`);};
  const clickBrowser=async()=>{const before=launchCalls;await run(`document.querySelector('[data-entry="browser"]').click()`);for(let i=0;i<30&&launchCalls===before;i++)await wait(30);assert(launchCalls>before,'page click reaches launch IPC');await wait(120);};

  await load(false);win.showInactive();await wait(150);
  assert(win.isVisible()&&!win.isMinimized(),'ordinary homepage starts visible');
  await clickBrowser();assert(win.isVisible()&&!win.isMinimized(),'successful entry launch leaves ordinary homepage visible');
  launchMode='failure';await clickBrowser();assert(win.isVisible()&&!win.isMinimized(),'failed launch leaves ordinary homepage visible');
  assert.equal(await run(`document.querySelector('#toast').textContent.includes('合成启动失败')`),true,'failure is shown in page');
  launchMode='success';win.maximize();await wait(150);await clickBrowser();assert(win.isVisible(),'maximized homepage remains visible after launch');
  await run(`document.querySelector('#appBanner').click();document.querySelector('#hideBtn').click()`);for(let i=0;i<30&&win.isVisible();i++)await wait(20);assert.equal(win.isVisible(),false,'explicit minimize-to-tray action still hides');
  win.showInactive();await wait(100);assert(win.isVisible(),'window can be shown again after explicit hide');
  await load(true);win.showInactive();await clickBrowser();assert(win.isVisible(),'desktop-mode page launch does not hide or destroy its host window');
  assert.deepEqual(errors,[]);
  const report={pageLoaded:true,launchCalls,checks:['ordinary success stays visible','ordinary failure stays visible and reports error','maximized stays visible','explicit tray hide remains','desktop-mode page host stays visible'],limits:['synthetic launch target','does not prove Windows taskbar button or target-app focus','not a native desktop attachment test']};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));clearTimeout(watchdog);win.destroy();app.exit(0);
}
main().catch(async error=>{console.error(error);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.txt'),String(error.stack));app.exit(1);});
