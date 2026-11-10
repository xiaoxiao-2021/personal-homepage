'use strict';
const {parseBili}=require('./bili-source.cjs'),{randomUUID}=require('node:crypto');
function createFavorites({fs,path,file}){
  let tail=Promise.resolve();
  async function ordinary(){
    const target=path.resolve(file),lower=target.replace(/\//g,'\\').toLowerCase(),root='d:\\k science\\r 软件资料';
    if(lower===root||lower.startsWith(root+'\\'))throw Error('Protected path');
    let current=path.parse(target).root;
    for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){
      current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Linked storage');}catch(error){if(error.code==='ENOENT')break;throw error;}
    }
  }
  function normalize(value){
    if(value?.version!==1||!Array.isArray(value.items)||value.items.length>50)throw Error('Invalid favorites');
    const ids=new Set(),urls=new Set();
    const items=value.items.map(item=>{
      if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60||/[\x00-\x1f]/.test(item.name))throw Error('Invalid favorite');
      const url=parseBili(item.url).web;if(urls.has(url))throw Error('Duplicate favorite');ids.add(item.id);urls.add(url);return {id:item.id,name:item.name,url};
    });
    const saved=value.playback;
    const volume=Number.isFinite(saved?.volume)&&saved.volume>=0&&saved.volume<=1?saved.volume:0.25;
    return {items,playback:{volume,lastId:ids.has(saved?.lastId)?saved.lastId:null,
      focusStart:saved?.focusStart===true,focusEnd:saved?.focusEnd===true,
      window:normalizeWindow(saved?.window)}};
  }
  function normalizeWindow(value){
    if(!value||!['x','y','width','height'].every(key=>Number.isFinite(value[key])))return null;
    return {x:Math.round(Math.max(-100000,Math.min(100000,value.x))),y:Math.round(Math.max(-100000,Math.min(100000,value.y))),
      width:Math.round(Math.max(280,Math.min(1600,value.width))),height:Math.round(Math.max(158,Math.min(900,value.height))),top:value.top!==false};
  }
  async function load(){
    await ordinary();try{if((await fs.stat(file)).size>65536)throw Error('Oversize favorites');return normalize(JSON.parse(await fs.readFile(file,'utf8')));}catch(error){if(error.code==='ENOENT')return {items:[],playback:{volume:0.25,lastId:null,focusStart:false,focusEnd:false,window:null}};throw error;}
  }
  async function write(items,playback){
    await ordinary();await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify({version:1,items,playback}),{encoding:'utf8',flag:'wx'});await ordinary();await fs.rename(temporary,file);}
    finally{try{await fs.unlink(temporary);}catch{/* A failed save never replaces the prior file. */}}
  }
  function request(value){
    const pending=tail.then(async()=>{
      try{
        const {items,playback}=await load();
        if(value?.action==='list')return {ok:true,items,playback};
        if(value?.action==='remember'){
          const next={...playback};
          if(Number.isFinite(value.volume))next.volume=Math.min(1,Math.max(0,value.volume));
          if(typeof value.url==='string'){
            const match=items.find(item=>item.url===parseBili(value.url).web);
            if(match)next.lastId=match.id;
          }
          for(const key of ['focusStart','focusEnd'])if(typeof value[key]==='boolean')next[key]=value[key];
          if(value.window)next.window=normalizeWindow(value.window)??playback.window;
          if(JSON.stringify(next)!==JSON.stringify(playback))await write(items,next);
          return {ok:true,playback:next};
        }
        if(value?.action==='add'){
          const url=parseBili(value.url).web;
          if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>60||/[\x00-\x1f]/.test(value.name)))return {ok:false,message:'收藏名称最多60个字，请去掉换行。'};
          const name=value.name?.trim()||`B站 · ${url.split('/video/')[1].replace('/?p=',' · P')}`;
          const existing=items.find(item=>item.url===url);
          if(existing){if(existing.name!==name){existing.name=name;await write(items,playback);}return {ok:true,items,id:existing.id,duplicate:true};}
          if(items.length>=50)return {ok:false,message:'已收藏50项，请先移除不再需要的链接。'};
          const item={id:randomUUID(),name,url};items.push(item);await write(items,playback);return {ok:true,items,id:item.id};
        }
        if(value?.action==='remove'){
          const next=items.filter(item=>item.id!==value.id);
          if(next.length!==items.length){
            if(playback.lastId===value.id)playback.lastId=null;
            await write(next,playback);
          }
          return {ok:true,items:next};
        }
        return {ok:false,message:'无效的收藏操作。'};
      }catch{return {ok:false,message:'收藏未能读取或保存，原文件已保留，请重试。'};}
    });tail=pending.catch(()=>{});return pending;
  }
  return {request};
}
module.exports={createFavorites};
