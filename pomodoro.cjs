'use strict';
const DEFAULTS=Object.freeze({focus:25,break:5});
function normalizeSettings(value){return {focus:Number.isInteger(value?.focus)&&value.focus>=1&&value.focus<=120?value.focus:25,break:Number.isInteger(value?.break)&&value.break>=1&&value.break<=30?value.break:5};}
function validateSettings(value){if(!value||!Number.isInteger(value.focus)||value.focus<1||value.focus>120||!Number.isInteger(value.break)||value.break<1||value.break>30)throw new Error('专注需为1～120分钟，休息需为1～30分钟的整数。');return {focus:value.focus,break:value.break};}
function createTimer({settings=DEFAULTS,now=Date.now,monotonic=()=>performance.now(),onComplete=()=>{},onRecord=()=>{}}={}){
  let preferences=normalizeSettings(settings),phase='focus',status='idle',remaining=preferences.focus*60000,wallDeadline=0,monoDeadline=0,revision=0,sample=0,task=null;
  let round=0,recording=null,lastMono=monotonic(),suspended=false;
  function emitRecord(nextStatus,reason='',at=now()){
    if(!recording)return;
    onRecord({...recording,task:recording.task?{...recording.task}:null,at,status:nextStatus,reason});
    if(['completed','interrupted'].includes(nextStatus))recording=null;
  }
  function account(resume=false,currentMono=monotonic()){
    if(recording&&status==='running'&&!suspended&&!resume){const elapsed=Math.max(0,currentMono-lastMono),active=Math.min(elapsed,remaining,recording.plannedMs-recording.activeMs);recording.activeMs+=active;recording.lastAt=now()-Math.max(0,elapsed-active);emitRecord('running','',recording.lastAt);}
    lastMono=currentMono;if(resume)suspended=false;
  }
  function update(resume=false){
    const currentMono=monotonic();account(resume,currentMono);
    if(status==='running'){
      const monoLeft=monoDeadline-currentMono;
      // Monotonic deadline ignores ordinary clock edits. On resume count sleep
      // even on Windows clocks that did not advance while suspended.
      remaining=Math.max(0,Math.min(remaining,resume?Math.min(monoLeft,wallDeadline-now()):monoLeft));
      // Rebase after a partial sleep; otherwise the frozen monotonic deadline
      // would hold the new smaller remainder constant until it caught up.
      if(resume&&remaining>0){monoDeadline=currentMono+remaining;wallDeadline=now()+remaining;}
      if(remaining===0){status='completed';wallDeadline=monoDeadline=0;revision++;const full=recording?.activeMs>=recording?.plannedMs-1;emitRecord(full?'completed':'interrupted','timer-ended',full?recording.lastAt:now());onComplete(phase);}
    }
    return {phase,status,remainingMs:remaining,settings:{...preferences},revision,sample:++sample,task:task?{...task}:null};
  }
  function start(){if(phase==='focus'&&!recording)recording={round:++round,startedAt:now(),plannedMs:remaining,activeMs:0,task:task?{...task}:null};lastMono=monotonic();wallDeadline=now()+remaining;monoDeadline=lastMono+remaining;status='running';emitRecord('running');}
  function command(action){update();switch(action){
    case 'start':if(status==='idle'||status==='paused')start();else if(status==='completed'){phase=phase==='focus'?'break':'focus';remaining=preferences[phase]*60000;start();}break;
    case 'continue-focus':
    case 'take-break':if(status==='completed'&&phase==='focus'){phase=action==='continue-focus'?'focus':'break';remaining=preferences[phase]*60000;start();}break;
    case 'pause':if(status==='running'){status='paused';emitRecord('paused');}break;
    case 'reset':emitRecord('interrupted','reset');phase='focus';status='idle';remaining=preferences.focus*60000;wallDeadline=monoDeadline=0;task=null;break;
    default:throw new Error('无效计时操作。');
  }revision++;return update();}
  function configure(value){if(['running','paused'].includes(status))throw new Error('请先重置当前计时，再修改时长。');preferences=validateSettings(value);return command('reset');}
  function focusTask(next,{replace=false,expectedRevision}={}){
    if(!next||!['id','projectId'].every(key=>typeof next[key]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(next[key]))||typeof next.title!=='string'||!next.title.trim()||next.title.length>1000)throw new Error('任务信息无效，请刷新后重试。');
    const current=update(),same=task?.id===next.id&&task?.projectId===next.projectId;
    if(same&&phase==='focus'&&['running','paused'].includes(status))return {ok:true,state:status==='paused'?command('start'):current};
    if(['running','paused'].includes(status)&&(!replace||expectedRevision!==revision))return {ok:false,needsConfirm:true,state:current,message:'已有一轮计时，切换任务会重新开始本轮专注。'};
    emitRecord('interrupted','task-changed');task={id:next.id,projectId:next.projectId,title:next.title.trim()};phase='focus';status='idle';remaining=preferences.focus*60000;wallDeadline=monoDeadline=0;
    return {ok:true,state:command('start')};
  }
  return {snapshot:update,command,configure,focusTask,suspend(){update();suspended=true;},finishRecording(){update();const previous=recording;emitRecord('interrupted','exit');return ()=>{if(previous&&!recording&&round===previous.round&&phase==='focus'&&['running','paused'].includes(status)){recording=previous;lastMono=monotonic();emitRecord(status);}};}};
}
module.exports={DEFAULTS,normalizeSettings,validateSettings,createTimer};
