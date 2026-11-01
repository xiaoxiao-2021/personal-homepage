'use strict';
(()=>{
  const get=id=>document.getElementById(id);let busy=false,state=null;
  function render(value){if(!value)return;state=value;const seconds=Math.max(0,Math.ceil(value.remainingMs/1000));get('time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;get('task').textContent=value.title;get('task').title=value.title;get('toggle').textContent=value.status==='paused'?'继续':'暂停';get('toggle').disabled=busy||!['running','paused'].includes(value.status);get('status').textContent=value.status==='completed'?'这一轮结束啦 · 回首页确认任务':value.status==='paused'?'已暂停 · 按自己的节奏来':value.status==='idle'?'等待开始 · 返回首页选择任务':'拖动上方可移动 · 收起后计时继续';}
  get('toggle').onclick=async()=>{if(busy)return;busy=true;render(state);try{const result=await floatingTimer.action('toggle');if(!result?.ok)get('status').textContent=result?.message||'操作未成功，请重试。';}finally{busy=false;render(await floatingTimer.state());}};
  get('home').onclick=()=>floatingTimer.action('home');get('close').onclick=()=>floatingTimer.action('hide');
  const unsubscribe=floatingTimer.onState(render);floatingTimer.state().then(render);
  window.addEventListener('pagehide',unsubscribe,{once:true});
})();
