'use strict';
// Read-only App Server client. Never reads auth.json, sessions, or browser cookies.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {validateEntry}=require('./local-entry.cjs');
const CACHE_MS=5*60*1000,RETRY_MS=60*1000,DISCOVERY_RETRY_MS=2000;
const messages={ok:'额度已更新（官方查询）。',idle:'连接本机 Codex，查看额度与自然刷新时间。',missing:'未找到可用于查询的 Codex 程序；已检查桌面版与命令行版的已知位置。这不代表账号未登录，无需先重装或重新授权。',timeout:'额度查询超时，请稍后刷新。',signed_out:'Codex 尚未登录或登录已过期，请在官方客户端处理。',unsupported:'当前 Codex 未提供可用额度数据，请检查官方客户端。',unavailable:'暂时无法读取额度，请稍后刷新。',closed:'额度查询已停止。'};
function failure(code){return Object.assign(new Error(code),{quotaCode:code});}
function safePath(value){
  if(typeof value!=='string')return false;
  const normalized=path.win32.normalize(value).split(/[\\/]/).map(segment=>segment.replace(/[. ]+$/,'')).join('\\').toLowerCase();
  return !/^d:\\k science\\r 软件资料(?:\\|$)/.test(normalized);
}
function envValue(env,name){const key=Object.keys(env).find(key=>key.toUpperCase()===name);return key?env[key]:undefined;}
async function locateExecutable({env=process.env,platform=process.platform,arch=process.arch,appData=envValue(env,'APPDATA'),localAppData=envValue(env,'LOCALAPPDATA')}={}){
  const windows=platform==='win32',target=windows?`${arch==='arm64'?'aarch64':'x86_64'}-pc-windows-msvc`:platform==='darwin'?`${arch==='arm64'?'aarch64':'x86_64'}-apple-darwin`:`${arch==='arm64'?'aarch64':'x86_64'}-unknown-linux-musl`;
  const name=windows?'codex.exe':'codex',override=envValue(env,'CODEX_BIN');
  async function checked(candidate,source){
    if(!safePath(candidate)||windows&&path.extname(candidate).toLowerCase()!=='.exe')return null;
    if(windows){const result=await validateEntry({kind:'application',target:candidate});return result.ok?{executable:result.target,source}:null;}
    try{const resolved=await fs.realpath(candidate);if(safePath(resolved)&&(await fs.stat(resolved)).isFile())return {executable:resolved,source};}catch{/* Known candidate only. */}
    return null;
  }
  if(override&&path.isAbsolute(override)){const result=await checked(override,'override');if(result)return result;}
  // Official Windows desktop installation. Enumerate only this validated bin
  // directory's immediate version folders, never application data or disk trees.
  if(windows&&localAppData&&safePath(localAppData)){
    const root=path.join(localAppData,'OpenAI','Codex','bin');
    if(safePath(root)&&(await validateEntry({kind:'folder',target:root})).ok){
      const direct=await checked(path.join(root,name),'desktop');if(direct)return direct;
      try{
        const versions=(await fs.readdir(root,{withFileTypes:true})).filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&/^[a-zA-Z0-9_-]{1,80}$/.test(item.name)).slice(0,32);
        const found=[];
        for(const version of versions){
          const result=await checked(path.join(root,version.name,name),'desktop');
          if(result)found.push({...result,mtime:(await fs.stat(result.executable)).mtimeMs});
        }
        found.sort((a,b)=>b.mtime-a.mtime);if(found.length)return {executable:found[0].executable,source:'desktop'};
      }catch{/* Fall back to the CLI without logging installation paths. */}
    }
  }
  const dirs=(envValue(env,'PATH')||'').split(windows?';':path.delimiter).map(dir=>dir.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean).filter(safePath);
  const npmDir=windows&&appData&&safePath(appData)?path.join(appData,'npm'):null;
  if(npmDir)dirs.unshift(npmDir);
  const candidates=[];
  for(const dir of dirs){
    candidates.push(path.join(dir,name));
    const root=path.join(dir,'node_modules','@openai','codex'),pkg=`codex-${platform}-${arch}`;
    for(const folder of ['bin','codex'])candidates.push(path.join(root,'node_modules','@openai',pkg,'vendor',target,folder,name),path.join(dir,'node_modules','@openai',pkg,'vendor',target,folder,name),path.join(root,'vendor',target,folder,name));
  }
  for(const candidate of [...new Set(candidates)]){const result=await checked(candidate,npmDir&&candidate.startsWith(npmDir+path.sep)?'npm':'path');if(result)return result;}
  throw failure('missing');
}
async function findExecutable(options){return (await locateExecutable(options)).executable;}
function seconds(value){return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<253402300800?value*1000:null;}
function normalize(result,now=Date.now()){
  if(!result||typeof result!=='object')throw failure('unsupported');
  const buckets=result.rateLimitsByLimitId&&typeof result.rateLimitsByLimitId==='object'?Object.entries(result.rateLimitsByLimitId):[];
  if(!buckets.length&&result.rateLimits)buckets.push([result.rateLimits.limitId||'codex',result.rateLimits]);
  const windows=[];
  for(const [rawId,bucket] of buckets.sort(([a],[b])=>a==='codex'?-1:b==='codex'?1:a.localeCompare(b)).slice(0,12)){
    if(!bucket||typeof bucket!=='object')continue;
    const bucketId=String(rawId).replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,60)||'codex';
    for(const key of ['primary','secondary']){
      const w=bucket[key];if(!w||typeof w!=='object')continue;
      const used=typeof w.usedPercent==='number'&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100?w.usedPercent:null;
      const duration=typeof w.windowDurationMins==='number'&&Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0?w.windowDurationMins:null;
      windows.push({id:`${bucketId}:${key}`,bucket:bucketId,remainingPercent:used===null?null:Math.round((100-used)*10)/10,windowDurationMins:duration,resetsAt:seconds(w.resetsAt)});
    }
  }
  if(!windows.length)throw failure('unsupported');
  const credits=result.rateLimitResetCredits;
  const availableCount=Number.isSafeInteger(credits?.availableCount)&&credits.availableCount>=0?credits.availableCount:null;
  const expirations=Array.isArray(credits?.credits)?credits.credits.filter(c=>c?.status==='available').map(c=>seconds(c.expiresAt)).filter(t=>t!==null&&t>now).sort((a,b)=>a-b).slice(0,30):[];
  return {windows,resetCredits:{availableCount,expirations},fetchedAt:now};
}
function readRateLimits({executable,launch=spawn,timeoutMs=15000,cwd=__dirname,signal}={}){
  return new Promise((resolve,reject)=>{
    let child,done=false,buffer='',bytes=0,initialized=false;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(child){child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy();if(child.exitCode===null)child.kill();}
      error?reject(error):resolve(result);
    };
    const timer=setTimeout(()=>finish(failure('timeout')),timeoutMs);
    const abort=()=>finish(failure('closed'));if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    const send=value=>{try{child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)finish(failure('unavailable'));});}catch{finish(failure('unavailable'));}};
    try{child=launch(executable,['app-server'],{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{return finish(failure('unavailable'));}
    child.on('error',()=>finish(failure('unavailable')));
    child.stdin.on('error',()=>finish(failure('unavailable')));
    child.stderr.on('data',()=>{}); // Never forward raw logs, identities or tokens.
    child.on('close',()=>finish(failure('unavailable')));
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      if(done)return;bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024)return finish(failure('unsupported'));
      buffer+=chunk.toString('utf8');let index;
      while(!done&&(index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;
        try{message=JSON.parse(line);}catch{continue;}
        // No approval, login, thread, tool or model requests are ever answered.
        if(message.id===1&&!initialized){
          if(message.error)return finish(failure('unsupported'));
          if(!message.result)return finish(failure('unsupported'));
          initialized=true;send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read',params:null});
        }else if(message.id===2&&initialized){
          if(message.error){const code=message.error.code,text=String(message.error.message||'');return finish(failure(code===401||code===403||/not logged|not authenticated|sign in|unauthorized|authentication required/i.test(text)?'signed_out':'unavailable'));}
          finish(null,message.result);
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'personal_homepage_quota',title:'Personal Homepage Quota',version:'0.3.9'}}});
  });
}
function createService({reader,find=locateExecutable,now=Date.now}={}){
  let snapshot=null,lastAttempt=null,lastStatus='idle',pending=null,disposed=false,controller=null,programSource=null,programFound=false;
  const state=()=>({status:lastStatus,message:messages[lastStatus]||messages.unavailable,stale:lastStatus!=='ok',checkedAt:lastAttempt,programFound,programSource,...(snapshot||{windows:[],resetCredits:{availableCount:null,expirations:[]},fetchedAt:null})});
  async function query(){
    lastAttempt=now();
    controller=new AbortController();
    try{
      let result;
      if(reader)result=await reader({signal:controller.signal});
      else{
        programFound=false;programSource=null;
        const located=await find();if(disposed)return state();
        const executable=typeof located==='string'?located:located.executable;
        programFound=true;programSource=['desktop','npm','path','override'].includes(located.source)?located.source:null;
        result=await readRateLimits({executable,signal:controller.signal});
      }
      if(disposed)return state();snapshot=normalize(result,now());lastStatus='ok';
    }catch(error){if(disposed)return state();lastStatus=messages[error?.quotaCode]?error.quotaCode:'unavailable';if(['signed_out','missing'].includes(lastStatus))snapshot=null;}
    return state();
  }
  function read(force=false){
    if(disposed)return Promise.resolve(state());if(pending)return pending;
    const age=lastAttempt===null?Infinity:now()-lastAttempt;
    const reached=snapshot?.windows.some(w=>w.resetsAt!==null&&w.resetsAt<=now());
    const waitMs=lastStatus==='missing'&&force?DISCOVERY_RETRY_MS:lastStatus==='ok'&&!force&&!reached?CACHE_MS:RETRY_MS;
    if(age>=0&&age<waitMs)return Promise.resolve(state());
    pending=query().finally(()=>pending=null);return pending;
  }
  return {read,state,dispose(){disposed=true;lastStatus='closed';controller?.abort();}};
}
module.exports={CACHE_MS,RETRY_MS,DISCOVERY_RETRY_MS,locateExecutable,findExecutable,normalize,readRateLimits,createService};
