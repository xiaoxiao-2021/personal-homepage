'use strict';
const assert=require('node:assert/strict');
const {createDidaCompletion,occurrenceKey}=require('../dida-completion.cjs');
const task={id:'t1',projectId:'p1',status:0,dueDate:'2026-10-06T00:00:00+08:00',repeatFlag:'RRULE:FREQ=DAILY'};
function setup(options={}){
  const calls=[];
  const credential=options.credential||{accessToken:'synthetic',scope:'tasks:read tasks:write'};
  const dashboard=options.dashboard||{source:'live',tasks:[task],projects:[{id:'p1'}]};
  const service=createDidaCompletion({getCredential:async()=>credential,getDashboard:()=>dashboard,apiUrl:'https://synthetic.invalid/open/v1',fetch:async(url,init)=>{
    calls.push({url,method:init.method||'GET'});
    await new Promise(r=>setTimeout(r,5));
    if(options.throwAt===calls.length)throw Error('synthetic network failure');
    const status=init.method==='POST'?(options.postStatus||200):(options.getStatus||200);
    return {ok:status>=200&&status<300,status,json:async()=>options.fresh||task};
  }});
  return {service,calls,dashboard,run:()=>service.complete('p1','t1',occurrenceKey(task))};
}
(async()=>{
  let s=setup({credential:{scope:'tasks:read'}});assert.equal((await s.run()).code,'scope');assert.equal(s.calls.length,0);
  s=setup({credential:{scope:'tasks:write',expiresAt:1}});assert.equal((await s.run()).code,'expired');
  for(const source of ['cache','none','error']){s=setup({dashboard:{source,tasks:[task]}});assert.equal((await s.run()).code,'offline');assert.equal(s.calls.length,0);}
  s=setup({dashboard:{source:'partial',tasks:[task],failedProjectIds:['p1']}});assert.equal((await s.run()).code,'unavailable');
  s=setup({dashboard:{source:'partial',tasks:[task],failedProjectIds:['p2']}});assert.equal((await s.run()).ok,true);
  s=setup();assert.equal((await s.service.complete('../p1','t1','')).code,'invalid');assert.equal(s.calls.length,0);
  assert.equal((await s.service.complete('p1','t1','stale')).code,'changed');assert.equal(s.calls.length,0);
  s=setup({fresh:{...task,dueDate:'2026-10-07T00:00:00+08:00'}});assert.equal((await s.run()).code,'changed');assert.equal(s.calls.length,1);
  s=setup({fresh:{...task,status:2}});assert.equal((await s.run()).alreadyCompleted,true);assert.equal(s.calls.length,1);
  s=setup();const [a,b]=await Promise.all([s.run(),s.run()]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(s.calls.length,2,'duplicate click uses one GET and one POST');
  assert.equal(s.calls[1].url,'https://synthetic.invalid/open/v1/project/p1/task/t1/complete');
  assert.equal((await s.run()).code,'submitted');assert.equal(s.service.reconcile(s.dashboard).tasks.length,0);
  assert.equal(s.service.reconcile({tasks:[{...task,dueDate:'2026-10-07T00:00:00+08:00'}]}).tasks.length,1,'next recurring occurrence is retained');
  for(const [status,code] of [[401,'expired'],[403,'permission'],[404,'missing'],[500,'server']]){s=setup({postStatus:status});assert.equal((await s.run()).code,code);assert.equal(s.service.reconcile(s.dashboard).tasks.length,1);}
  s=setup({throwAt:2});assert.equal((await s.run()).code,'uncertain');assert.equal(s.calls.length,2,'no automatic retry after uncertain write');
  s=setup({throwAt:1});assert.equal((await s.run()).code,'network');
  console.log('PASS: completion permission, identity, offline/partial, recurrence, duplicate, empty acknowledgement and failure tests (synthetic only).');
})().catch(error=>{console.error(error);process.exitCode=1;});
