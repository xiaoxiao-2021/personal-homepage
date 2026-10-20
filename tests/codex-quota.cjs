'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),fs=require('node:fs/promises'),path=require('node:path');
const quota=require('../codex-quota.cjs');
const checks=[];const check=(v,name)=>{assert(v,name);checks.push(name);};
const now=Date.UTC(2026,9,17,4),stamp=Math.floor(now/1000);
const raw={rateLimits:{primary:{usedPercent:99,windowDurationMins:10,resetsAt:stamp+60}},rateLimitsByLimitId:{codex:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:stamp+3600},secondary:{usedPercent:60,windowDurationMins:10080,resetsAt:stamp+86400}},other:{primary:{usedPercent:0,windowDurationMins:15,resetsAt:null}}},rateLimitResetCredits:{availableCount:3,credits:[{id:'never-forward-id',status:'available',expiresAt:stamp+7200},{status:'available',expiresAt:stamp-1},{status:'used',expiresAt:stamp+5000}]},accessToken:'never-forward-key',account:{email:'never-forward@example.invalid'}};
const clone=x=>structuredClone(x);
const coded=code=>Object.assign(new Error('never-forward-details'),{quotaCode:code});
function transport(mode){
  let kills=0;const methods=[],child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
  const reply=value=>queueMicrotask(()=>{if(!child.stdout.destroyed)child.stdout.write(JSON.stringify(value)+'\n');});
  child.stdin=new Writable({write(chunk,_encoding,done){const message=JSON.parse(chunk.toString());methods.push(message.method);
    if(message.method==='initialize'&&mode!=='timeout')reply(mode==='init-error'?{id:1,error:{code:-32601}}:{id:1,result:{userAgent:'synthetic'}});
    if(message.method==='account/rateLimits/read'){
      if(mode==='signed-out')reply({id:2,error:{code:401,message:'secret-not-logged-in'}});
      else if(mode==='error')reply({id:2,error:{code:500,message:'secret'}});
      else if(mode==='oversize')queueMicrotask(()=>child.stdout.write('x'.repeat(1024*1024+1)));
      else if(mode==='requests')reply({id:'approval-request',method:'item/commandExecution/requestApproval',params:{secret:'ignore'}});
      else {reply({method:'account/updated',params:{secret:'ignore'}});reply({id:2,result:raw});}
    }done();}});
  child.kill=()=>{kills++;child.exitCode=0;queueMicrotask(()=>child.emit('close',0));return true;};
  const launch=(exe,args,options)=>{check(exe==='synthetic.exe'&&args.join(' ')==='app-server','only native app-server executable launched');check(options.shell===false&&options.windowsHide===true,'no command shell or visible helper');return child;};
  return {launch,methods,kills:()=>kills};
}
(async()=>{
  const parsed=quota.normalize(raw,now);
  check(parsed.windows.length===3&&parsed.windows[0].remainingPercent===75,'prefer multi-bucket data and compute remaining, not used');
  check(parsed.windows[0].resetsAt===(stamp+3600)*1000,'Unix seconds converted exactly once');
  check(parsed.windows[2].remainingPercent===100&&parsed.windows[2].resetsAt===null,'zero usage is real full remainder, missing reset stays unknown');
  check(parsed.resetCredits.availableCount===3&&parsed.resetCredits.expirations.length===1,'authoritative reset count, only available future expiry dates');
  check(!JSON.stringify(parsed).match(/never-forward|accessToken|account|email/),'normalized DTO drops tokens, identity, opaque credit IDs and raw metadata');
  check(quota.normalize({rateLimits:{primary:{usedPercent:100}}},now).windows[0].remainingPercent===0,'legacy single window and 100% usage supported');
  for(const invalid of [null,'25',NaN,-1,101])check(quota.normalize({rateLimits:{primary:{usedPercent:invalid}}},now).windows[0].remainingPercent===null,`invalid percent remains unknown (${String(invalid)})`);
  check(quota.normalize({rateLimits:{primary:{}}},now).resetCredits.availableCount===null,'missing reset credits is unknown, not zero');
  check(quota.normalize({rateLimits:{primary:{}},rateLimitResetCredits:{availableCount:0}},now).resetCredits.availableCount===0,'actual zero reset credits preserved');
  assert.throws(()=>quota.normalize({rateLimitsByLimitId:{}}));checks.push('unusable response fails closed');
  for(const [mode,expected] of [['ok',null],['signed-out','signed_out'],['error','unavailable'],['init-error','unsupported'],['oversize','unsupported'],['timeout','timeout'],['requests','timeout']]){
    const fake=transport(mode);let error,result;
    try{result=await quota.readRateLimits({executable:'synthetic.exe',launch:fake.launch,timeoutMs:35});}catch(e){error=e;}
    check(expected?error?.quotaCode===expected:result.rateLimitResetCredits.availableCount===3,`protocol ${mode}`);
    check(fake.kills()===1,`${mode}: own helper stopped exactly once`);
    check(fake.methods.every(m=>['initialize','initialized','account/rateLimits/read'].includes(m)),`${mode}: no model, thread, login, config-write or reset method`);
  }
  const controller=new AbortController(),aborted=transport('timeout');const pendingAbort=quota.readRateLimits({executable:'synthetic.exe',launch:aborted.launch,signal:controller.signal});controller.abort();await assert.rejects(pendingAbort,e=>e.quotaCode==='closed');check(aborted.kills()===1,'abort closes only owned helper');
  let clock=now,calls=0,rejectCode=null;
  const service=quota.createService({now:()=>clock,reader:async()=>{calls++;await new Promise(r=>setTimeout(r,5));if(rejectCode)throw coded(rejectCode);return raw;}});
  const results=await Promise.all([service.read(),service.read(true),service.read(true)]);check(calls===1&&results.every(r=>r.status==='ok'),'concurrent windows/manual refresh coalesce to one query');
  await service.read(true);check(calls===1,'manual repeated refresh is throttled');clock+=61000;await service.read();check(calls===1,'fresh automatic read uses five-minute cache');
  clock+=quota.CACHE_MS;rejectCode='timeout';const cached=await service.read();check(cached.status==='timeout'&&cached.stale&&cached.windows[0].remainingPercent===75,'network failure retains explicitly stale last-success values');
  check(!JSON.stringify(cached).includes('never-forward'),'raw errors and secrets never returned');
  await service.read(true);check(calls===2,'failed query retry throttled');clock+=61000;rejectCode='signed_out';check((await service.read(true)).windows.length===0,'sign-out clears old account quota');
  service.dispose();const before=calls;await service.read(true);check(calls===before&&service.state().status==='closed','disposed service cannot launch another query');
  let expiredCalls=0;const expiredService=quota.createService({now:()=>now+7200000,reader:async()=>{expiredCalls++;return raw;}});const expiredState=await expiredService.read();
  check(expiredState.windows[0].remainingPercent===75&&expiredState.windows[0].resetsAt<now+7200000,'reached reset time never fabricates restored 100%');await expiredService.read();check(expiredCalls===1,'reached reset still respects retry cooldown');expiredService.dispose();
  const output=path.resolve(__dirname,'../test-results/codex-quota'),fixture=path.join(output,'synthetic.exe');await fs.mkdir(output,{recursive:true});await fs.writeFile(fixture,'synthetic executable lookup only, never executed');
  check(await quota.findExecutable({env:{CODEX_BIN:fixture},platform:'win32',arch:'x64'})===await fs.realpath(fixture),'explicit native executable resolved without shell');
  await assert.rejects(quota.findExecutable({env:{CODEX_BIN:path.join(output,'not-a-program.cmd')},platform:'win32',arch:'x64'}),e=>e.quotaCode==='missing');checks.push('batch wrappers are not executed');
  const linkRoot=await fs.mkdtemp(path.join(output,'safe-link-test-')),realBin=path.join(linkRoot,'real-bin'),junction=path.join(linkRoot,'junction');await fs.mkdir(realBin);await fs.writeFile(path.join(realBin,'codex.exe'),'synthetic only');await fs.symlink(realBin,junction,'junction');
  await assert.rejects(quota.findExecutable({env:{CODEX_BIN:path.join(junction,'codex.exe')},platform:'win32',arch:'x64'}),e=>e.quotaCode==='missing');checks.push('directory junction rejected before reading executable through it');
  const appLocal=await fs.mkdtemp(path.join(output,'synthetic-local-')),desktopBin=path.join(appLocal,'OpenAI','Codex','bin');
  await fs.mkdir(path.join(desktopBin,'oldversion'),{recursive:true});await fs.mkdir(path.join(desktopBin,'newversion'),{recursive:true});
  const oldDesktop=path.join(desktopBin,'oldversion','codex.exe'),newDesktop=path.join(desktopBin,'newversion','codex.exe');
  await fs.writeFile(oldDesktop,'synthetic only, never run');await fs.writeFile(newDesktop,'synthetic only, never run');
  await fs.utimes(oldDesktop,now/1000-100,now/1000-100);await fs.utimes(newDesktop,now/1000,now/1000);
  const desktop=await quota.locateExecutable({env:{LocalAppData:appLocal},platform:'win32',arch:'x64'});
  check(desktop.source==='desktop'&&desktop.executable===newDesktop,'desktop version bins discovered without npm or PATH; newest valid binary preferred');
  check(await quota.findExecutable({env:{CODEX_BIN:fixture,LOCALAPPDATA:appLocal},platform:'win32',arch:'x64'})===fixture,'explicit override remains higher priority than desktop');
  const desktopAlias=path.join(linkRoot,'desktop-alias');await fs.symlink(appLocal,desktopAlias,'junction');
  await assert.rejects(quota.findExecutable({env:{LOCALAPPDATA:desktopAlias},platform:'win32',arch:'x64'}),e=>e.quotaCode==='missing');checks.push('desktop root junction rejected before directory enumeration');
  const linkedVersion=path.join(desktopBin,'linkedversion');await fs.symlink(realBin,linkedVersion,'junction');
  check((await quota.locateExecutable({env:{LOCALAPPDATA:appLocal},platform:'win32',arch:'x64'})).executable===newDesktop,'linked desktop version skipped, safe installed candidates preserved');
  const pathBin=path.join(output,'quoted-path');await fs.mkdir(pathBin,{recursive:true});await fs.writeFile(path.join(pathBin,'codex.exe'),'synthetic only');
  check((await quota.locateExecutable({env:{Path:`"${pathBin}"`},platform:'win32',arch:'x64'})).source==='path','quoted case-insensitive Windows Path supported');
  check(JSON.stringify(Object.keys(desktop).sort())===JSON.stringify(['executable','source']),'discovery returns executable and source only');
  let discoveryClock=now,discoveries=0;
  const missingService=quota.createService({now:()=>discoveryClock,find:async()=>{discoveries++;throw coded('missing');}});
  const absent=await missingService.read();check(absent.status==='missing'&&!absent.programFound&&absent.programSource===null,'missing program state is distinct from authentication and account query');
  check(!JSON.stringify(absent).includes('executable')&&!JSON.stringify(absent).includes(output),'service DTO excludes local executable path');
  await missingService.read(true);check(discoveries===1,'rapid missing-program clicks still coalesce and throttle');
  discoveryClock+=quota.DISCOVERY_RETRY_MS;await missingService.read(true);check(discoveries===2,'manual local rediscovery need not wait full account request cooldown');missingService.dispose();
  const unknownPathService=quota.createService({find:async()=>({source:'desktop',executable:path.join(output,'absent-runtime.exe')})});
  const foundButFailed=await unknownPathService.read();check(foundButFailed.programFound&&foundButFailed.programSource==='desktop'&&foundButFailed.status==='unavailable','found program and launch failure are separately reported without raw errors');unknownPathService.dispose();
  await fs.writeFile(path.join(output,'unit-report.json'),JSON.stringify({passed:checks.length,checks,scope:'Synthetic protocol, cache, normalization and executable lookup only; no login credentials or account requests.'},null,2));
  console.log(`PASS ${checks.length} quota checks; synthetic only.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
