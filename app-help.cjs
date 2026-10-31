'use strict';
const https=require('node:https');
const REPO='https://github.com/xiaoxiao-2021/personal-homepage';
const LINKS=Object.freeze({website:'https://personal-homepage-xiaoxiao.lilac-venus-8349.chatgpt.site/',help:REPO+'#readme',feedback:REPO+'/issues',releases:REPO+'/releases'});
const API='https://api.github.com/repos/xiaoxiao-2021/personal-homepage/releases?per_page=100';
function version(value){const m=/^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-preview\.(\d{1,5}))?$/.exec(value||'');return m?m.slice(1).map((x,i)=>x===undefined&&i===3?Infinity:Number(x)):null;}
function compare(a,b){for(let i=0;i<4;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;}
function selectRelease(list,current){
  if(!Array.isArray(list)||!version(current))throw Error('invalid');
  const candidates=list.filter(r=>r&&r.draft===false&&version(r.tag_name)&&typeof r.published_at==='string'&&Number.isFinite(Date.parse(r.published_at))&&r.html_url===REPO+'/releases/tag/'+r.tag_name);
  candidates.sort((a,b)=>compare(version(b.tag_name),version(a.tag_name)));
  if(!candidates.length)return {state:'empty',code:'NO_RELEASE'};
  const r=candidates[0],v=version(r.tag_name),c=version(current);
  const delta=compare(v,c);
  const state=delta===0?'current':delta>0?'available':'ahead';
  return {state,code:'OK',tag:r.tag_name,prerelease:r.prerelease===true,notes:typeof r.body==='string'?r.body.slice(0,4000):'',url:r.html_url};
}
function requestReleases(){return new Promise((resolve,reject)=>{
  const req=https.get(API,{headers:{Accept:'application/vnd.github+json','User-Agent':'PersonalHomepage-update-check','X-GitHub-Api-Version':'2026-03-10'}},res=>{
    if(res.statusCode!==200){res.resume();reject(Object.assign(Error('http'),{helpCode:res.statusCode===403||res.statusCode===429?'RATE_LIMIT':res.statusCode===404?'NOT_FOUND':'HTTP_ERROR'}));return;}
    const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(Object.assign(Error('size'),{helpCode:'INVALID_RESPONSE'}));return;}chunks.push(chunk);});
    res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(Error('json'),{helpCode:'INVALID_RESPONSE'}));}});
  });
  const timer=setTimeout(()=>req.destroy(Object.assign(Error('timeout'),{helpCode:'TIMEOUT'})),10000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);
});}
function createService({current,request=requestReleases,now=Date.now}={}){
  let flight=null,last=null,lastAt=0;
  return {snapshot:()=>last?{state:last.state,code:last.code,checkedAt:last.checkedAt}:{state:'unchecked',code:'NOT_CHECKED',checkedAt:null},check(){
    if(flight)return flight;
    if(last&&now()-lastAt<(last.code==='OK'?60000:15000))return Promise.resolve({...last,cached:true});
    flight=(async()=>{let result;try{result=selectRelease(await request(),`v${current}-preview.1`);}catch(e){const code=['RATE_LIMIT','TIMEOUT','NOT_FOUND','HTTP_ERROR','INVALID_RESPONSE'].includes(e.helpCode)?e.helpCode:e.message==='invalid'?'INVALID_RESPONSE':'NETWORK_ERROR';result={state:'error',code};}
      lastAt=now();last={...result,checkedAt:new Date(lastAt).toISOString()};return {...last};
    })().finally(()=>flight=null);return flight;
  }};
}
function diagnostic({appVersion,build,platform,arch,osVersion,electron,chrome,packaged,desktop,uptime,update}={}){
  const clean=v=>typeof v==='string'&&/^[\w. -]{1,64}$/.test(v)?v:'unknown';
  const state=['unchecked','available','current','ahead','empty','error'].includes(update?.state)?update.state:'unchecked';
  const code=['NOT_CHECKED','OK','NO_RELEASE','NETWORK_ERROR','RATE_LIMIT','TIMEOUT','NOT_FOUND','HTTP_ERROR','INVALID_RESPONSE'].includes(update?.code)?update.code:'UNKNOWN';
  const time=typeof update?.checkedAt==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(update.checkedAt)?update.checkedAt:'none';
  return ['个人首页 · 诊断摘要',`版本: ${clean(appVersion)} / ${clean(build)}`,`系统: ${clean(platform)} ${clean(osVersion)} / ${clean(arch)}`,`运行环境: Electron ${clean(electron)} / Chromium ${clean(chrome)}`,`发行方式: ${packaged?'免安装版':'源码版'}`,`窗口模式: ${desktop?'桌面模式':'普通窗口'}`,`本次运行秒数: ${Number.isFinite(uptime)?Math.max(0,Math.floor(uptime)):0}`,`更新检查: ${state} / ${code}`,`检查时间 (UTC): ${time}`,'仅含运行环境与更新检查状态；不含个人路径、任务、聊天或凭据。'].join('\n');
}
module.exports={LINKS,API,version,compare,selectRelease,requestReleases,createService,diagnostic};
