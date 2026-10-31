'use strict';
const assert=require('node:assert/strict');const h=require('../app-help.cjs');let passed=0;
function check(v,label){assert(v,label);passed++;}
const release=(tag,other={})=>({tag_name:tag,html_url:h.LINKS.releases+'/tag/'+tag,draft:false,prerelease:tag.includes('preview'),published_at:'2026-10-31T00:00:00Z',body:'Release notes',...other});
(async()=>{
  check(h.selectRelease([release('v0.3.23-preview.1')],'v0.3.22-preview.1').state==='available','new preview detected');
  check(h.selectRelease([release('v0.3.22-preview.2')],'v0.3.22-preview.1').state==='available','new revision detected');
  check(h.selectRelease([release('v0.3.22')],'v0.3.22-preview.1').state==='available','stable after preview detected');
  check(h.selectRelease([release('v0.3.22-preview.1')],'v0.3.22-preview.1').state==='current','same preview');
  check(h.selectRelease([release('v0.3.21-preview.1')],'v0.3.22-preview.1').state==='ahead','unpublished local version');
  check(h.selectRelease([release('v0.3.9'),release('v0.3.10')],'0.3.8').tag==='v0.3.10','numeric sort');
  for(const r of [release('v99.0.0',{draft:true}),release('v99.0.0',{html_url:'https://evil.invalid/'}),release('v99.0.0',{published_at:'bad'}),release('bad')])check(h.selectRelease([r],'0.3.22').state==='empty','invalid/draft release excluded');
  assert.throws(()=>h.selectRelease({},'0.3.22'));passed++;
  check(h.selectRelease([release('v0.3.22',{body:'x'.repeat(6000)})],'0.3.21').notes.length===4000,'notes bounded');
  let calls=0,now=1_000_000,resolve;
  const svc=h.createService({current:'0.3.22',now:()=>now,request:()=>{calls++;return new Promise(r=>resolve=r);}});
  check(svc.snapshot().code==='NOT_CHECKED'&&calls===0,'no startup network');
  const first=svc.check(),second=svc.check();check(first===second&&calls===1,'concurrent requests coalesced');resolve([release('v0.3.22-preview.1')]);check((await first).state==='current','service compares actual preview channel');
  check((await svc.check()).cached&&calls===1,'success cooldown');now+=60001;const third=svc.check();resolve([]);await third;check(calls===2,'can retry after cooldown');
  for(const code of ['NETWORK_ERROR','RATE_LIMIT','TIMEOUT','NOT_FOUND','HTTP_ERROR','INVALID_RESPONSE']){const fail=h.createService({current:'0.3.22',request:async()=>{throw Object.assign(Error('sensitive detail'),{helpCode:code});}});const r=await fail.check();check(r.state==='error'&&r.code===code&&!JSON.stringify(r).includes('sensitive'),'errors sanitized '+code);}
  const bad=h.createService({current:'0.3.22',request:async()=>({})});check((await bad.check()).code==='INVALID_RESPONSE','malformed payload classified');
  const d=h.diagnostic({appVersion:'0.3.22',build:'2026.10.31.2',platform:'win32',osVersion:'10.0.26200',arch:'x64',electron:'39.8.10',chrome:'1.2',packaged:true,desktop:false,uptime:15,appPath:'C:/private/user',token:'secret',tasks:['private task'],update:{...svc.snapshot(),notes:'private note',url:'private url'}});
  check(!/private|secret|user|note/.test(d),'diagnostic allowlist excludes unrelated data');
  check(!h.diagnostic({appVersion:'C:/private/user',update:{code:'secret',state:'secret',checkedAt:'secret'}}).includes('secret'),'diagnostic rejects injected fields');
  check(d.includes('0.3.22')&&d.includes('普通窗口'),'diagnostic useful environment');
  console.log('PASS '+passed+' help service checks');
})().catch(e=>{console.error(e);process.exitCode=1;});
