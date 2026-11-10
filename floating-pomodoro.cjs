'use strict';
const path=require('node:path');
function createFloatingTimer({BrowserWindow,screen,ipcMain,snapshot,command,onHome,onAmbient=()=>({ok:false})}){
  let win=null,disposed=false;
  const channels=['focus-float:state','focus-float:action'];
  const safeState=()=>{const s=snapshot();return {phase:s.phase,status:s.status,remainingMs:s.remainingMs,revision:s.revision,sample:s.sample,title:s.task?.title||'专注这一刻',hasTask:Boolean(s.task)};};
  function clamp(){if(!win||win.isDestroyed())return;const b=win.getBounds(),a=screen.getDisplayMatching(b).workArea;win.setPosition(Math.round(Math.max(a.x,Math.min(b.x,a.x+a.width-b.width))),Math.round(Math.max(a.y,Math.min(b.y,a.y+a.height-b.height))));}
  function update(){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('focus-float:state',safeState());}
  async function show(){
    if(disposed)return {ok:false};
    if(win&&!win.isDestroyed()){clamp();win.showInactive();update();return {ok:true};}
    const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const current=new BrowserWindow({width:320,height:168,x:Math.round(a.x+a.width-338),y:Math.round(a.y+a.height-186),show:false,frame:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,skipTaskbar:true,alwaysOnTop:true,title:'个人首页 · 悬浮专注',backgroundColor:'#faf9f4',webPreferences:{preload:path.join(__dirname,'preload-floating.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win=current;current.setAlwaysOnTop(true,'floating');
    current.webContents.setWindowOpenHandler(()=>({action:'deny'}));current.webContents.on('will-navigate',event=>event.preventDefault());
    current.on('closed',()=>{if(win===current)win=null;});
    try{await current.loadFile(path.join(__dirname,'src/floating-timer.html'));if(disposed||current.isDestroyed())return {ok:false};clamp();current.showInactive();update();return {ok:true};}
    catch{if(!current.isDestroyed())current.destroy();return {ok:false,message:'悬浮计时器暂时无法打开，请重试。'};}
  }
  const authorized=e=>win&&!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===e.sender.mainFrame;
  ipcMain.handle(channels[0],event=>authorized(event)?safeState():null);
  ipcMain.handle(channels[1],async(event,action)=>{
    if(!authorized(event))return {ok:false};
    if(action==='hide'){win.hide();return {ok:true};}
    if(action==='ambient')return onAmbient();
    if(action==='home'){onHome();return {ok:true};}
    const state=snapshot();
    if(['complete','continue-focus','take-break'].includes(action)){
      if(state.status!=='completed'||state.phase!=='focus')return {ok:false,message:'计时状态已变化，请重新查看。'};
      if(action==='complete'){if(!state.task)return {ok:false};onHome({...state.task});return {ok:true};}
      try{const result=await command(action);update();return result;}catch{return {ok:false,message:'操作暂未成功，请重试。'};}
    }
    if(action!=='toggle')return {ok:false};
    if(!['running','paused'].includes(state.status))return {ok:false,message:'本轮已结束，请回首页开始下一轮。'};
    try{const result=await command(state.status==='running'?'pause':'start');update();return result;}catch{return {ok:false,message:'操作暂未成功，请重试。'};}
  });
  screen.on('display-removed',clamp);screen.on('display-metrics-changed',clamp);
  return {show,update,dispose(){disposed=true;screen.removeListener('display-removed',clamp);screen.removeListener('display-metrics-changed',clamp);for(const c of channels)ipcMain.removeHandler(c);if(win&&!win.isDestroyed())win.destroy();win=null;}};
}
module.exports={createFloatingTimer};
