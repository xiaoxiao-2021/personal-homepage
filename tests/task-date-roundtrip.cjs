'use strict';
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const core=require('../task-assistant.cjs'),dates=require('../src/task-view.js');
const checks=[];const check=(v,name)=>{assert(v,name);checks.push(name);};
const zone='Asia/Shanghai',projects=[{id:'synthetic',name:'合成清单'}];
const draft={title:'合成日期验证',projectId:'synthetic',content:'',date:'2026-10-09',time:'',dateKind:'due',isAllDay:true};
const credential={accessToken:'synthetic-not-real',scope:'tasks:read tasks:write'};
const dashboard={source:'live',projects,tasks:[],failedProjectIds:[]};
const normalized=t=>({...t,dueDate:t.dueDate?new Date(t.dueDate).toISOString():null,startDate:t.startDate?new Date(t.startDate).toISOString():null});
(async()=>{
  const stamp='2026-10-08T16:00:00+0000';
  check(stamp.slice(0,10)==='2026-10-08'&&dates.dateKey(stamp,true,zone)==='2026-10-09','reproduces old raw-prefix bug; corrected Shanghai all-day returns Oct 9');
  for(const value of [stamp,'2026-10-08T16:00:00Z','2026-10-08T16:00:00.000Z','2026-10-09T00:00:00+0800','2026-10-09T00:00:00+08:00','2026-10-09'])check(dates.dateKey(value,true,zone)===draft.date,`equivalent date representation ${value}`);
  for(const value of ['2026-02-30','2026-02-30T16:00:00Z','2026-10-09T00:00:00','2026-10-09T24:00:00Z','bad'])check(dates.dateKey(value,true,zone)==='invalid',`reject invalid/ambiguous date ${value}`);
  check(dates.dateKey(stamp,true,'bad-zone')==='invalid','invalid zone cannot silently change date');
  const todayTask={id:'today',isAllDay:true,timeZone:zone,dueDate:stamp};
  check(dates.taskDay(todayTask)===draft.date&&!dates.isOverdue(todayTask,draft.date),'all-day grouping and overdue use identical timezone semantics');
  check(dates.isOverdue({...todayTask,dueDate:'2026-10-07T16:00:00Z'},draft.date),'genuine yesterday task remains overdue');
  check(dates.taskDay({...todayTask,dueDate:null,startDate:stamp})===draft.date&&!dates.isOverdue({...todayTask,dueDate:null,startDate:stamp},draft.date),'start-only task groups correctly without inventing due overdue');
  check(dates.taskDay({...todayTask,timeZone:undefined})===draft.date,'legacy absent task timezone falls back to Shanghai');
  check(dates.dateKey('2026-10-09T07:00:00Z',true,'America/Los_Angeles')==='2026-10-09','all-day honors non-China task timezone');
  check(dates.dateKey('2026-10-09T02:00:00Z',false,'America/Los_Angeles')==='2026-10-09','timed task Shanghai grouping preserved');
  for(const day of ['2026-10-01','2027-01-01','2028-02-29','2028-03-01']){
    const t={...draft,date:day},payload=core.taskPayload(t,zone),stored=normalized({...payload,id:'task-1'});
    check(core.verifyTaskDate(stored,t,zone).status==='verified'&&dates.taskDay(stored)===day,`all-day payload/UTC response/group round trip ${day}`);
  }
  for(const time of ['00:01','08:00','15:00','23:59'])for(const dateKind of ['due','start']){
    const t={...draft,time,dateKind,isAllDay:false},payload=core.taskPayload(t,zone);
    check(core.verifyTaskDate(normalized(payload),t,zone).status==='verified',`timed UTC round trip ${dateKind} ${time}`);
  }
  const empty={...draft,date:''};
  check(!core.taskPayload(empty,zone).dueDate&&core.verifyTaskDate({...core.taskPayload(empty,zone),dueDate:null,startDate:null},empty,zone).status==='verified','undated task remains undated');
  check(core.verifyTaskDate({id:'x',projectId:'synthetic'},draft,zone).status==='unverified','ID alone never proves date correctness');
  check(core.verifyTaskDate({...core.taskPayload(draft,zone),dueDate:'2026-10-07T16:00:00Z'},draft,zone).status==='mismatch','actually wrong server date is detected');
  check(core.verifyTaskDate({...core.taskPayload(draft,zone),isAllDay:false},draft,zone).status==='mismatch','all-day mismatch detected');
  check(core.verifyTaskDate({...core.taskPayload(draft,zone),timeZone:'UTC'},draft,zone).status==='mismatch','changed task timezone detected');
  const run=async(mode)=>{
    let posts=0,gets=0,body;const stored=normalized({...core.taskPayload(draft,zone),id:'task-1'});
    const writer=core.createTaskWriter({getCredential:async()=>credential,getDashboard:()=>dashboard,apiUrl:'https://synthetic.invalid/open/v1',fetch:async(url,options)=>{
      if(options.method==='POST'){posts++;body=JSON.parse(options.body);return {ok:true,json:async()=>mode==='full'?stored:mode==='wrong'?{...stored,dueDate:'2026-10-07T16:00:00Z'}:{id:'task-1',projectId:'synthetic'}};}
      gets++;assert.equal(url,'https://synthetic.invalid/open/v1/project/synthetic/task/task-1');assert(!options.body);
      if(mode==='timeout')throw Error('synthetic');if(mode==='denied')return {ok:false,status:403};
      return {ok:true,json:async()=>mode==='wrong-id'?{...stored,id:'other'}:stored};
    }});
    const results=await Promise.all([writer.create('request-1',draft,projects,zone),writer.create('request-1',draft,projects,zone)]);
    await writer.create('request-1',draft,projects,zone);
    check(posts===1&&results.every(r=>r.ok),`${mode}: acknowledged creation always deduplicates, never retries POST`);
    check(body.dueDate==='2026-10-09T00:00:00+0800',`${mode}: payload is Oct 9 local midnight, no artificial day shift`);
    if(['full','read'].includes(mode))check(results[0].dateCheck.status==='verified'&&!results[0].warning,`${mode}: actual returned UTC date verified`);
    else if(mode==='wrong')check(results[0].dateCheck.status==='mismatch'&&results[0].warning.includes('实际')&&gets===0,'mismatch keeps created ID and explains expected/actual without new write');
    else check(results[0].dateCheck.status==='unverified'&&results[0].warning.includes('不要重复')&&gets===1,`${mode}: at most one read-back, failure warns without retry creation`);
    check(gets===(['full','wrong'].includes(mode)?0:1),`${mode}: bounded optional read-back count`);
  };
  for(const mode of ['full','read','wrong','timeout','denied','wrong-id'])await run(mode);
  for(const tz of ['UTC','Asia/Shanghai','America/Los_Angeles']){
    const script=`const c=require('./task-assistant.cjs'),d=require('./src/task-view.js');for(const date of ['2026-01-01','2026-07-01']){const t=${JSON.stringify(draft)};t.date=date;const p=c.taskPayload(t,process.env.TZ);if(d.dateKey(p.dueDate,true,process.env.TZ)!==date||c.verifyTaskDate({...p,dueDate:new Date(p.dueDate).toISOString()},t,process.env.TZ).status!=='verified')throw Error('roundtrip');}if(process.env.TZ==='America/Los_Angeles'){let rejected=false;try{c.taskPayload({...${JSON.stringify(draft)},date:'2026-03-08',time:'02:30',isAllDay:false},process.env.TZ);}catch{rejected=true;}if(!rejected)throw Error('DST gap');}`;
    const result=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ:tz},encoding:'utf8'});
    check(result.status===0,`isolated timezone ${tz}: winter/summer offsets and DST gap (no system time changes)`);
  }
  const report={passed:checks.length,checks,scope:'Pure date + actual writer with synthetic transports; no network, credentials or real tasks.'};
  const fs=require('node:fs/promises'),path=require('node:path'),output=path.resolve(__dirname,'../test-results/task-date-roundtrip');
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'logic-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
