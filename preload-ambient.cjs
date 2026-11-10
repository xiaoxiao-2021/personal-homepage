'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const listen=(channel,callback)=>{const fn=(_event,value)=>callback(value);ipcRenderer.on(channel,fn);return ()=>ipcRenderer.removeListener(channel,fn);};
contextBridge.exposeInMainWorld('ambientApi',{
  onFocusPlay:callback=>listen('ambient:focus-play',callback),
  onTop:callback=>listen('ambient:top',callback),
  onEscape:callback=>listen('ambient:escape',callback),
  onView:callback=>listen('ambient:view',callback),
  favorites:value=>ipcRenderer.invoke('ambient:favorites',value),
  action:action=>ipcRenderer.invoke('ambient:action',action),
  chooseMedia:()=>ipcRenderer.invoke('ambient:choose','media'),
  bili:value=>ipcRenderer.invoke('ambient:bili',value),
  onRemotePlaying:callback=>listen('ambient:remote-playing',callback),
  chooseVideo:()=>ipcRenderer.invoke('ambient:choose'),
  onPause:callback=>listen('ambient:pause',callback),
  onVisible:callback=>listen('ambient:visible',callback)
});
