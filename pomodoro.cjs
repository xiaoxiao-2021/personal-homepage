'use strict';
const DEFAULTS=Object.freeze({focus:25,break:5});
function normalizeSettings(value){return {focus:Number.isInteger(value?.focus)&&value.focus>=1&&value.focus<=120?value.focus:25,break:Number.isInteger(value?.break)&&value.break>=1&&value.break<=30?value.break:5};}
function validateSettings(value){if(!value||!Number.isInteger(value.focus)||value.focus<1||value.focus>120||!Number.isInteger(value.break)||value.break<1||value.break>30)throw new Error('专注需为1～120分钟，休息需为1～30分钟的整数。');return {focus:value.focus,break:value.break};}
function createTimer({settings=DEFAULTS,now=Date.now,monotonic=()=>performance.now(),onComplete=()=>{}}={}){
  let preferences=normalizeSettings(settings),phase='focus',status='idle',remaining=preferences.focus*60000,wallDeadline=0,monoDeadline=0,revision=0;
  function update(resume=false){
    if(status==='running'){
      const monoLeft=monoDeadline-monotonic();
      // Monotonic deadline ignores ordinary clock edits. On resume count sleep
      // even on Windows clocks that did not advance while suspended.
      remaining=Math.max(0,Math.min(remaining,resume?Math.min(monoLeft,wallDeadline-now()):monoLeft));
      // Rebase after a partial sleep; otherwise the frozen monotonic deadline
      // would hold the new smaller remainder constant until it caught up.
      if(resume&&remaining>0){monoDeadline=monotonic()+remaining;wallDeadline=now()+remaining;}
      if(remaining===0){status='completed';wallDeadline=monoDeadline=0;revision++;onComplete(phase);}
    }
    return {phase,status,remainingMs:remaining,settings:{...preferences},revision};
  }
  function start(){wallDeadline=now()+remaining;monoDeadline=monotonic()+remaining;status='running';}
  function command(action){update();switch(action){
    case 'start':if(status==='idle'||status==='paused')start();else if(status==='completed'){phase=phase==='focus'?'break':'focus';remaining=preferences[phase]*60000;start();}break;
    case 'pause':if(status==='running')status='paused';break;
    case 'reset':phase='focus';status='idle';remaining=preferences.focus*60000;wallDeadline=monoDeadline=0;break;
    default:throw new Error('无效计时操作。');
  }revision++;return update();}
  function configure(value){if(['running','paused'].includes(status))throw new Error('请先重置当前计时，再修改时长。');preferences=validateSettings(value);return command('reset');}
  return {snapshot:update,command,configure};
}
module.exports={DEFAULTS,normalizeSettings,validateSettings,createTimer};
