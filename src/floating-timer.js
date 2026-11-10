(()=>{
  const get=id=>document.getElementById(id);let state=null,busy=false;
  function render(value){
    if(!value)return;
    if(state&&Number.isSafeInteger(state.revision)&&Number.isSafeInteger(value.revision)){
      if(value.revision<state.revision)return;
      if(value.revision===state.revision){
        if(Number.isSafeInteger(value.sample)&&Number.isSafeInteger(state.sample)&&value.sample<state.sample)return;
        if(value.status==='running'&&state.status==='running'&&value.phase===state.phase&&value.remainingMs>state.remainingMs)return;
      }
    }
    state=value;document.body.dataset.status=value.status;document.body.dataset.phase=value.phase;
    get('phase').textContent=value.phase==='break'?'休息一下':value.status==='completed'?'这一段完成啦':'专注这一刻';
    get('toggle').setAttribute('aria-label',value.status==='paused'?'继续计时':'暂停计时');const seconds=Math.max(0,Math.ceil(value.remainingMs/1000));
    get('time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    get('task').textContent=value.title;get('task').title=value.title;
    const ended=value.status==='completed'&&value.phase==='focus';get('wrapup').hidden=!ended;
    get('toggle').hidden=ended;get('toggle').textContent=value.status==='paused'?'继续':'暂停';
    get('toggle').disabled=busy||!['running','paused'].includes(value.status);
    for(const id of ['complete','again','rest'])get(id).disabled=busy||(id==='complete'&&!value.hasTask);
    get('status').textContent=ended?'这一段辛苦啦 · 按自己的节奏来':value.status==='completed'?'休息结束啦 · 回首页开始下一轮':value.status==='paused'?'已暂停 · 按自己的节奏来':value.status==='idle'?'等待开始 · 返回首页选择任务':value.phase==='break'?'休息一下 · 让眼睛看看远处':'拖动上方可移动 · 收起后计时继续';
  }
  async function act(action){if(busy)return;busy=true;render(state);let message='';try{const result=await floatingTimer.action(action);if(!result?.ok)message=result?.message||'操作未成功，请重试。';}catch{message='操作未成功，请重试。';}finally{busy=false;try{render(await floatingTimer.state());}catch{}if(message)get('status').textContent=message;}}
  for(const [id,action] of [['ambient','ambient'],['toggle','toggle'],['home','home'],['close','hide'],['complete','complete'],['again','continue-focus'],['rest','take-break']])get(id).onclick=()=>act(action);
  const unsubscribe=floatingTimer.onState(render);floatingTimer.state().then(render).catch(()=>{get('status').textContent='暂时无法读取计时，请返回首页。';});
  window.addEventListener('pagehide',()=>unsubscribe?.(),{once:true});
})();
