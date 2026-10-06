'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const source=fs.readFileSync(path.resolve(__dirname,'../main.cjs'),'utf8');
const launchSource=source.match(/async function launchEntry\(entry\) \{[\s\S]*?\n\}/)?.[0];
assert(launchSource,'production launchEntry function is present');

const calls={hide:0,minimize:0,destroy:0,skipTaskbar:0};
const fakeWindow={hide(){calls.hide++;},minimize(){calls.minimize++;},destroy(){calls.destroy++;},setSkipTaskbar(){calls.skipTaskbar++;},isDestroyed(){return false;}};
let mode='success';
const context={
  shell:{},mainWindow:fakeWindow,trialWindow:fakeWindow,
  launchValidatedEntry:async()=>mode==='failure'?{ok:false,error:'synthetic failure'}:{ok:true}
};
vm.createContext(context);vm.runInContext(launchSource,context);

(async()=>{
  const success=await vm.runInContext(`launchEntry({kind:'website',target:'https://example.invalid/'})`,context);
  assert.equal(success.ok,true);assert.equal(success.homepageDisposition,'unchanged');
  assert.deepEqual(calls,{hide:0,minimize:0,destroy:0,skipTaskbar:0});
  mode='failure';
  const failure=await vm.runInContext(`launchEntry({kind:'website',target:'https://example.invalid/'})`,context);
  assert.equal(failure.ok,false);assert.deepEqual(calls,{hide:0,minimize:0,destroy:0,skipTaskbar:0});
  mode='success';
  await Promise.all([0,1,2].map(()=>vm.runInContext(`launchEntry({kind:'website',target:'https://example.invalid/'})`,context)));
  assert.deepEqual(calls,{hide:0,minimize:0,destroy:0,skipTaskbar:0});
  assert(/ipcMain\.handle\('app:hide',[\s\S]*?mainWindow\?\.hide\(\)/.test(source),'explicit tray hide remains available');
  console.log('entry launch policy checks passed: success, failure and concurrent requests leave ordinary/desktop windows untouched; explicit hide remains separate');
})().catch(error=>{console.error(error);process.exitCode=1;});
