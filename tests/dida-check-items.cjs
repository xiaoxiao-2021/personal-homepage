'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createCheckItemCompletion,itemKey}=require('../dida-check-items.cjs'),{occurrenceKey}=require('../dida-completion.cjs');
const checks=[],check=(value,label)=>{assert(value,label);checks.push(label);},clone=value=>structuredClone(value);
const task={id:'t1',projectId:'p1',status:0,title:'合成父任务',content:'保留正文',desc:'检查清单',startDate:'2026-10-20T00:00:00+0800',dueDate:'2026-10-21T00:00:00+0800',timeZone:'Asia/Shanghai',isAllDay:true,repeatFlag:'RRULE:FREQ=DAILY',repeatFrom:'0',tags:['合成'],reminders:['TRIGGER:PT0S'],priority:3,sortOrder:23,kind:'CHECKLIST',parentId:'other-parent',items:[{id:'i1',title:'合成第一项',status:0,sortOrder:7,startDate:'2026-10-20T15:00:00+0800',timeZone:'Asia/Shanghai',isAllDay:false},{id:'i2',title:'合成第二项',status:0,sortOrder:9},{id:'i3',title:'原已完成',status:1,completedTime:'2026-10-19T08:00:00+0800'}]};
function setup(options={}){
  const known={...clone(task),checkItems:clone(task.items)},dashboard=options.dashboard||{source:'live',tasks:[known]},calls=[];
  let fresh=clone(options.fresh||task),readCount=0;
  const service=createCheckItemCompletion({now:()=>Date.UTC(2026,9,20,6),getCredential:async()=>options.credential||{scope:'tasks:read tasks:write',accessToken:'synthetic-secret'},getDashboard:()=>dashboard,apiUrl:'https://synthetic.invalid/open/v1',fetch:async(url,init)=>{
    const call={url,method:init.method||'GET',body:init.body?JSON.parse(init.body):null};calls.push(call);await new Promise(r=>setTimeout(r,3));
    if(options.throwAt===calls.length)throw Error('synthetic');
    if(call.method==='POST'){if(!options.ignoreUpdate)fresh={...fresh,items:call.body.items};return {ok:(options.postStatus||201)<400,status:options.postStatus||201};}
    readCount++;const status=options.getStatus||200;return {ok:status<400,status,json:async()=>clone(readCount>1&&options.readback?options.readback:fresh)};
  }});
  return {service,calls,known,run:(id='i1')=>service.complete('p1','t1',id,occurrenceKey(known),itemKey(known.checkItems.find(item=>item.id===id)))};
}
(async()=>{
  let s=setup();const result=await s.run();check(result.ok&&result.task.status===0,'single item completion leaves parent active');
  check(s.calls.length===3&&s.calls[1].url==='https://synthetic.invalid/open/v1/task/t1','GET latest, narrow task update, GET verify; never parent complete');
  const body=s.calls[1].body;check(body.items[0].status===1&&body.items[0].completedTime==='2026-10-20T06:00:00+0000','item uses status 1 and explicit completion instant');
  for(const key of ['title','content','desc','startDate','dueDate','timeZone','repeatFlag','repeatFrom','tags','reminders','priority','kind','sortOrder','parentId'])check(JSON.stringify(body[key])===JSON.stringify(task[key]),`${key} retained unchanged from latest task`);
  check(!Object.hasOwn(body,'status')&&!Object.hasOwn(body,'completedTime')&&!JSON.stringify(body).includes('synthetic-secret'),'no parent completion fields or credentials in update body');
  check(JSON.stringify(body.items.slice(1))===JSON.stringify(task.items.slice(1)),'siblings and original completion times retained exactly');
  check(body.items[0].sortOrder===7&&body.items[0].startDate===task.items[0].startDate,'target metadata preserved');
  const fresh=clone(task);fresh.items[1].status=1;fresh.items[1].title='其他客户端改过的小项';fresh.content='最新正文';s=setup({fresh});await s.run();check(s.calls[1].body.content==='最新正文'&&s.calls[1].body.items[1].status===1&&s.calls[1].body.items[1].title===fresh.items[1].title,'fresh sibling edits and parent text are merged, not overwritten by renderer snapshot');
  const completed=clone(task);completed.items[0].status=1;s=setup({fresh:completed});check((await s.run()).alreadyCompleted&&s.calls.length===1,'already completed remotely is read-only success, no duplicate update');
  const allButLast=clone(task);allButLast.items[1].status=1;s=setup({fresh:allButLast});check((await s.run()).task.items.every(item=>item.status===1),'last check item can be checked without sending parent-complete');
  for(const [status,code] of [[401,'expired'],[403,'permission'],[404,'missing'],[500,'uncertain']]){s=setup({postStatus:status});check((await s.run()).code===code,`POST ${status} remains a failure with explanation`);}
  for(const point of [1,2,3]){s=setup({throwAt:point});check((await s.run()).code===(point===1?'network':'uncertain'),`network exception at step ${point} never auto-retries`);check(s.calls.length===point,'no retry request');}
  s=setup({ignoreUpdate:true});check((await s.run()).code==='uncertain','HTTP success without actual persisted check does not show success');
  s=setup({readback:{...completed,status:2}});check((await s.run()).code==='uncertain','unexpected completed parent is reported, never silently marked successful or auto-undone');
  s=setup({readback:{...completed,id:'other'}});check((await s.run()).code==='uncertain','readback identity mismatch not accepted');
  s=setup({fresh:{...task,id:'other'}});check((await s.run()).code==='mismatch'&&s.calls.length===1,'preflight identity mismatch stops before any write');
  s=setup({readback:{...completed,items:[completed.items[0]]}});check((await s.run()).code==='uncertain','unexpected sibling loss in readback is not reported as successful');
  const renamed=clone(task);renamed.items[0].title='已被改名';s=setup({fresh:renamed});check((await s.run()).code==='changed'&&s.calls.length===1,'target rename requires refreshed user intent');
  s=setup({fresh:{...task,dueDate:'2026-10-25T00:00:00+0800'}});check((await s.run()).code==='changed'&&s.calls.length===1,'changed occurrence never updates the next recurring task');
  const removed=clone(task);removed.items.shift();s=setup({fresh:removed});check((await s.run()).code==='missing'&&s.calls.length===1,'removed item does not mutate siblings');
  const duplicate=clone(task);duplicate.items[1].id='i1';s=setup({fresh:duplicate});check((await s.run()).code==='unsupported'&&s.calls.length===1,'ambiguous duplicate item IDs rejected');
  for(const source of ['cache','none','error']){s=setup({dashboard:{source,tasks:[]}});check((await s.run()).code==='offline'&&s.calls.length===0,`${source} cannot write`);}
  s=setup({dashboard:{source:'partial',failedProjectIds:['p1'],tasks:[]}});check((await s.run()).code==='unavailable'&&s.calls.length===0,'failed partial project cannot write');
  s=setup({credential:{scope:'tasks:read'}});check((await s.run()).code==='scope'&&s.calls.length===0,'read-only credential never used to update');
  s=setup({credential:{scope:'tasks:write',expiresAt:1}});check((await s.run()).code==='expired','expired credential rejected');
  s=setup();check((await s.service.complete('p1','t1','../bad','','')).code==='invalid'&&s.calls.length===0,'renderer cannot supply an arbitrary target');
  check((await s.service.complete('p1','t1','i1','old',itemKey(s.known.checkItems[0]))).code==='changed'&&s.calls.length===0,'stale renderer occurrence rejected before network');
  s=setup();const running=s.run(),other=s.run('i2');check((await other).code==='busy'&&(await running).ok&&s.calls.length===3,'same parent cannot have overlapping child writes');
  const output=path.resolve(__dirname,'../test-results/dida-check-items');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'unit-report.json'),JSON.stringify({passed:checks.length,checks,scope:'Synthetic official REST contract and safety only, no real tasks or credentials.'},null,2));console.log(`PASS ${checks.length} check-item tests (synthetic only).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
