'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../test-results/scene-background');
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const errors=[];
let ready=false;
ipcMain.handle('test:load',()=>({config:null,recovered:false}));
ipcMain.handle('test:save',()=>true);
ipcMain.handle('test:fail-save',()=>true);
ipcMain.on('test:page-ready',()=>{ready=true;});
ipcMain.on('test:page-error',(_event,message)=>errors.push(message));
ipcMain.on('test:music-state',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  await fs.mkdir(output,{recursive:true});
  await app.whenReady();
  const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:path.join(__dirname,'ui-smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('did-fail-load',(_event,code,description)=>errors.push(`${code}: ${description}`));
  win.webContents.on('render-process-gone',(_event,detail)=>errors.push(detail.reason));
  await win.loadFile(path.resolve(__dirname,'../src/index.html'));
  for(let i=0;i<100&&!ready;i++)await wait(50);
  assert.ok(ready,'renderer initialization failed');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#status')===null`,true),true,'duplicate footer removed');
  assert.equal(await win.webContents.executeJavaScript(`(()=>{$('#appBanner').click();const accessible=$('#modeInfoDialog').open&&!$('#hideBtn').hidden;$('#modeInfoDialog').close();return accessible})()`,true),true,'tray action remains accessible from mode dialog');
  const measure=async scene=>win.webContents.executeJavaScript(`(()=>{state.scene=${JSON.stringify(scene)};render();const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {scene:state.scene,viewport:innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,gutter:getComputedStyle(document.documentElement).scrollbarGutter,htmlOverflow:getComputedStyle(document.documentElement).overflowY,wallpaper:getComputedStyle(document.body).backgroundImage,top:rect('.top'),workspace:rect('#workspace'),task:rect('.task-card'),apps:rect('.apps-card'),tools:rect('.modules-card')}})()`,true);
  const measurements=[];
  for(const scene of ['📚 学习','🔬 科研','📚 学习']){
    measurements.push(await measure(scene));
    const file=scene==='🔬 科研'?'research.png':measurements.length===1?'study.png':null;
    if(file){await wait(100);await fs.writeFile(path.join(output,file),(await win.webContents.capturePage()).toPNG());}
  }
  assert.equal(measurements[0].clientWidth,measurements[1].clientWidth,'root scroll track changed available width');
  assert.equal(measurements[0].workspace.width,measurements[1].workspace.width,'three-column workspace shifted');
  assert.equal(measurements[0].workspace.x,measurements[1].workspace.x,'three-column workspace moved');
  assert.equal(measurements[0].wallpaper,measurements[1].wallpaper,'wallpaper changed by scene');
  assert.equal(measurements[0].clientWidth,measurements[2].clientWidth,'switching back changed available width');
  const report={pageLoaded:ready,measurements,errors,checks:['duplicate footer removed','tray action accessible from mode dialog','stable client width','stable workspace x and width','shared background style','stable return width']};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await win.destroy();
  if(errors.length)throw new Error(errors.join('\n'));
}
run().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)});
