'use strict';
const {parseBili}=require('./bili-source.cjs');
const path=require('node:path'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
// Only an explicitly picked, validated video is addressable; paths stay in main.
function createAmbientWindow({BrowserWindow,screen,ipcMain,dialog,protocol,net,validateEntry,favorites={request:async()=>({ok:true,items:[]})},onPlay=()=>{},openExternal=async()=>{}}){
  let win=null,disposed=false,selected=null,choosing=false,bili=null,compact=false,preferences={},saveTimer=null,lastFocus=null,focusGeneration=0,opening=null;
  const authorized=e=>win&&!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame;
  const channels=['ambient:action','ambient:choose','ambient:bili','ambient:favorites'];
  function fitted(bounds){
    const area=screen.getDisplayMatching(bounds).workArea;
    const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
    return {width,height,x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+area.width-width))),
      y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)))};
  }
  function clamp(){if(win&&!win.isDestroyed())win.setBounds(fitted(win.getBounds()));}
  function saveWindow(){
    if(!win||win.isDestroyed())return;
    const bounds=win.getBounds(),previous=preferences.window;
    preferences.window={...bounds,width:compact?bounds.width:(previous?.width||408),
      height:compact?bounds.height:(previous?.height||230),top:win.isAlwaysOnTop()};
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{void favorites.request({action:'remember',window:preferences.window});},350);
  }
  function setView(next){
    if(!win||win.isDestroyed()||win.webContents.isDestroyed())return {ok:false};
    if(next&&!bili)return {ok:false,message:'请先载入B站视频。'};
    if(compact)saveWindow();
    compact=next;
    const bounds=win.getBounds(),width=compact?(preferences.window?.width||408):408;
    win.setResizable(compact);
    win.setMinimumSize(compact?280:300,compact?158:300);
    win.setAspectRatio(compact?16/9:0);
    win.setBounds(fitted({...bounds,width,height:compact?Math.round(width*9/16):562}));
    win.webContents.send('ambient:view',{compact});return {ok:true,compact};
  }
  async function syncFocus(state){
    const prior=lastFocus;lastFocus={phase:state.phase,status:state.status,revision:state.revision};
    if(state.status==='paused'||state.status==='idle'||state.phase!=='focus')focusGeneration++;
    if(state.phase!=='focus')return;
    if(state.status==='completed'&&prior?.status!=='completed'){
      focusGeneration++;
      if(preferences.focusEnd)pause();
      return;
    }
    if(state.status!=='running'||prior?.status==='running'&&prior.phase==='focus')return;
    const token=++focusGeneration;
    const saved=await favorites.request({action:'list'});
    if(disposed||token!==focusGeneration||!saved?.ok)return;
    preferences=saved.playback;
    if(!preferences?.focusStart)return;
    const item=saved.items.find(item=>item.id===saved.playback.lastId)||saved.items[0];
    if(!item)return;
    if(!(await show()).ok||token!==focusGeneration)return;
    preferences=saved.playback;
    win.webContents.send('ambient:focus-play',item);
  }
  async function remote(action,value){
    if(!win||win.isDestroyed()||win.webContents.isDestroyed()||!bili)return {ok:false,message:'请先载入 B 站视频。'};
    const source=bili,owner=win;
    let frame;try{frame=win.webContents.mainFrame.frames.find(frame=>{try{const url=new URL(frame.url);return url.origin==='https://player.bilibili.com'&&url.pathname==='/player.html'&&parseBili(frame.url).web===source.web&&url.searchParams.get('homepage_session')===source.token;}catch{return false;}});}catch{return {ok:false,message:'播放器已关闭，请重新打开。'};}
    if(!frame)return {ok:false,message:'播放器尚未就绪，请稍候，或点击播放器内的播放按钮。'};
    const volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0.25;
    try{
      const result=await frame.executeJavaScript(`(async()=>{
        const video=document.querySelector('video');
        if(!video)return {ok:false,message:'播放器尚未就绪，请点击画面内的播放按钮。'};
        switch(${JSON.stringify(action)}){
          case 'play':
            await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error()),6000))]);
            break;
          case 'pause': video.pause();break;
          case 'mute': video.muted=!video.muted;break;
          case 'volume': video.volume=${volume};break;
        }
        return {ok:true,playing:!video.paused,muted:video.muted,ready:video.readyState};
      })()`,action==='play');
      return win===owner&&bili===source?{...result,url:source.web}:{ok:false};
    }catch{return {ok:false,message:'播放操作未成功，请重试或在播放器内操作。'};}
  }
  function pause(){void remote('pause');if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('ambient:pause');}
  function show(){if(!opening)opening=openWindow().finally(()=>{opening=null;});return opening;}
  async function openWindow(){
    if(disposed)return {ok:false};
    if(win&&!win.isDestroyed()){clamp();win.showInactive();return {ok:true};}
    const saved=await favorites.request({action:'list'});
    if(disposed)return {ok:false};
    preferences=saved?.playback||{};
    const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const current=new BrowserWindow({width:408,height:562,x:Math.round(a.x+a.width-428),y:Math.round(a.y+a.height-582),show:false,frame:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,skipTaskbar:true,alwaysOnTop:true,title:'个人首页 · 白噪音',backgroundColor:'#faf9f4',webPreferences:{preload:path.join(__dirname,'preload-ambient.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win=current;compact=false;
    if(preferences.window)current.setBounds(fitted({...current.getBounds(),x:preferences.window.x,y:preferences.window.y}));
    current.setAlwaysOnTop(preferences.window?.top!==false,'floating');
    current.on('moved',saveWindow);current.on('resized',()=>{if(compact)saveWindow();});
    current.on('close',saveWindow);
    current.webContents.once('did-finish-load',()=>{if(!current.isDestroyed())current.webContents.send('ambient:top',current.isAlwaysOnTop());});current.webContents.on('before-input-event',(event,input)=>{if(compact&&input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();current.webContents.send('ambient:escape');}});
    current.webContents.setWindowOpenHandler(()=>({action:'deny'}));current.webContents.on('will-navigate',e=>e.preventDefault());
    for(const eventName of ['media-started-playing','media-paused'])current.webContents.on(eventName,async()=>{const result=await remote('state');if(result.ok&&win===current&&!current.isDestroyed()&&!current.webContents.isDestroyed()){if(result.playing)onPlay();current.webContents.send('ambient:remote-playing',{playing:result.playing,muted:result.muted,url:result.url});}});
    current.on('closed',()=>{if(win===current){win=null;selected=null;bili=null;compact=false;}});
    current.on('hide',()=>{if(!current.webContents.isDestroyed())current.webContents.send('ambient:visible',false);});
    current.on('show',()=>{if(!current.webContents.isDestroyed())current.webContents.send('ambient:visible',true);});
    try{await current.loadFile(path.join(__dirname,'src/ambient.html'));if(disposed||current.isDestroyed())return {ok:false};clamp();current.showInactive();return {ok:true};}
    catch{if(!current.isDestroyed())current.destroy();return {ok:false,message:'白噪音小窗暂时无法打开，请重试。'};}
  }
  ipcMain.handle(channels[0],(event,action)=>{
    if(!authorized(event))return {ok:false};
    if(action==='video-only')return setView(true);
    if(action==='panel')return setView(false);
    if(action==='hide'){win.hide();return {ok:true};}
    if(action==='playing'){onPlay();return {ok:true};}
    if(action==='clear'){selected=null;return {ok:true};}
    if(action==='top'){const top=!win.isAlwaysOnTop();win.setAlwaysOnTop(top,'floating');saveWindow();return {ok:true,top};}
    return {ok:false};
  });
  ipcMain.handle(channels[1],async (event,kind)=>{
    if(!authorized(event)||choosing)return {ok:false};choosing=true;
    const owner=win;
    try{
      const media=kind==='media';const extensions=media?['webm','mp4','m4v','ogv','mp3','wav','m4a','aac','ogg','flac']:['webm','mp4','m4v','ogv'];
      const result=await dialog.showOpenDialog(owner,{title:media?'选择本地音频或视频（播放原声）':'选择视频画面（原声静音）',properties:['openFile'],filters:[{name:media?'音频或视频':'本地视频',extensions}]});
      if(disposed||win!==owner||owner.isDestroyed())return {ok:false};
      if(result.canceled)return {ok:false,canceled:true};
      const target=result.filePaths[0];
      if(typeof target!=='string'||!extensions.includes(path.extname(target).slice(1).toLowerCase()))return {ok:false,message:'请选择支持的本地音频或视频。'};
      const checked=await validateEntry({kind:'file',target});
      if(!checked.ok)return {ok:false,message:'视频不可用，或路径属于受保护、链接区域。请重新选择。'};
      if(disposed||win!==owner||owner.isDestroyed())return {ok:false};
      selected={target:checked.target,token:randomUUID()};
      return {ok:true,url:`home-ambient://clip/${selected.token}`,kind:['.webm','.mp4','.m4v','.ogv'].includes(path.extname(checked.target).toLowerCase())?'video':'audio'};
    }catch{return {ok:false,message:'未能选择视频，请重试。'};}finally{choosing=false;}
  });
  ipcMain.handle(channels[2],async(event,value)=>{
    if(!authorized(event))return {ok:false};
    try{
      if(value?.action==='load'){
        const next=parseBili(value.url);
        await remote('pause');
        if(!authorized(event))return {ok:false};
        bili={...next,token:randomUUID()};
        const embed=new URL(next.embed);
        embed.searchParams.set('homepage_session',bili.token);
        if(value.muted===true)embed.searchParams.set('muted','1');
        return {ok:true,url:embed.href,web:next.web};
      }
      if(value?.action==='clear'){await remote('pause');if(compact)setView(false);bili=null;return {ok:true};}
      if(value?.action==='external'){if(!bili)return {ok:false};await openExternal(bili.web);return {ok:true};}
      if(['play','pause','state','volume','mute'].includes(value?.action)){const result=await remote(value.action,value.volume);if(value.action==='play'&&result.ok&&result.playing)onPlay();return result;}
      return {ok:false};
    }catch(error){return {ok:false,message:error.message||'未能载入视频，请重试。'};}
  });
  ipcMain.handle(channels[3],async(event,value)=>{
    if(!authorized(event))return {ok:false};
    const result=await favorites.request(value);
    if(result.ok&&result.playback)preferences=result.playback;
    return result;
  });
  protocol.handle('home-ambient',async request=>{
    try{
      const entry=selected;
      if(!entry||disposed||!['GET','HEAD'].includes(request.method)||request.url!==`home-ambient://clip/${entry.token}`)return new Response(null,{status:404});
      const checked=await validateEntry({kind:'file',target:entry.target});
      if(!checked.ok||entry!==selected)return new Response(null,{status:404});
      return await net.fetch(pathToFileURL(checked.target).href,{method:request.method,headers:request.headers});
    }catch{return new Response(null,{status:404});}
  });
  screen.on('display-removed',clamp);screen.on('display-metrics-changed',clamp);
  return {show,pause,syncFocus,dispose(){saveWindow();clearTimeout(saveTimer);if(preferences.window)void favorites.request({action:'remember',window:preferences.window});disposed=true;focusGeneration++;selected=null;bili=null;for(const c of channels)ipcMain.removeHandler(c);protocol.unhandle('home-ambient');screen.removeListener('display-removed',clamp);screen.removeListener('display-metrics-changed',clamp);if(win&&!win.isDestroyed())win.destroy();win=null;}};
}
module.exports={createAmbientWindow};
