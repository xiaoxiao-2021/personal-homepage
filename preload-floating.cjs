'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('floatingTimer',{
  state:()=>ipcRenderer.invoke('focus-float:state'),
  action:value=>ipcRenderer.invoke('focus-float:action',value),
  onState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('focus-float:state',listener);return ()=>ipcRenderer.removeListener('focus-float:state',listener);}
});
