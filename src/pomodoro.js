(() => {
  const api=window.homeApi,panel=$('#moduleStack [data-module="pomodoro"]');
  let value={phase:'focus',status:'idle',remainingMs:25*60000,settings:{focus:25,break:5},revision:-1},timer=null,flight=false,busy=false,settingsBusy=false,lastMarker='';
  const text=(id,content)=>{const node=$(id);if(node.textContent!==content)node.textContent=content;};
  function displayed(){return !document.hidden&&!$('#moduleCard').hidden&&!panel.hidden;}
  function schedule(){clearTimeout(timer);timer=null;if(displayed()&&value.status==='running'&&!busy)timer=setTimeout(refresh,1000);}
  function apply(next){
    if(!next||!['idle','running','paused','completed'].includes(next.status)||next.revision<value.revision)return;
    value=next;const seconds=Math.max(0,Math.ceil(value.remainingMs/1000));
    text('#pomoTime',`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`);
    text('#pomoPhase',value.phase==='focus'?'专注':'休息');
    const taskLine=$('#pomoTask');taskLine.hidden=!value.task;text('#pomoTask',value.task?`${value.phase==='focus'?'专注任务':'刚才的任务'}：${value.task.title}`:'');taskLine.title=value.task?.title||'';
    const marker=JSON.stringify([value.task?.projectId,value.task?.id,value.phase,value.status]);
    if(marker!==lastMarker){lastMarker=marker;document.querySelectorAll('[data-focus-task]').forEach(button=>button.setAttribute('aria-pressed',String(value.task?.id===button.dataset.focusTask&&value.task?.projectId===button.dataset.focusProject)));}
    text('#pomoStart',value.status==='running'?'暂停':value.status==='paused'?'继续':value.status==='completed'?(value.phase==='focus'?'开始休息':'开始专注'):'开始');
    text('#pomoStatus',({idle:'准备开始',running:'计时中',paused:'已暂停',completed:value.phase==='focus'?'本轮专注已完成':'休息结束'})[value.status]);
    $('#pomoStart').disabled=busy||settingsBusy;$('#pomoReset').disabled=busy||settingsBusy;
    schedule();
  }
  async function refresh(){if(flight||!api.pomodoroState)return;flight=true;try{apply(await api.pomodoroState());}catch{text('#pomoStatus','无法读取计时状态，请重试。');schedule();}finally{flight=false;}}
  async function command(action){if(busy||settingsBusy)return;const origin=document.activeElement;busy=true;clearTimeout(timer);$('#pomoStart').disabled=$('#pomoReset').disabled=true;try{const result=await api.pomodoroCommand(action);if(result.ok)apply(result.state);else text('#pomoStatus',result.message||'操作未成功。');}catch{text('#pomoStatus','计时操作失败，请重试。');}finally{busy=false;$('#pomoStart').disabled=$('#pomoReset').disabled=false;if(['pomoStart','pomoReset'].includes(origin?.id)&&document.activeElement===document.body)origin.focus({preventScroll:true});schedule();}}
  $('#pomoStart').onclick=()=>command(value.status==='running'?'pause':'start');
  async function focusTask(projectId,taskId){
    if(busy||settingsBusy||editing||layoutSaveInFlight)return;
    if(!api.pomodoroFocusTask){toast('请使用支持任务专注的新版首页。');return;}
    busy=true;$('#pomoStart').disabled=$('#pomoReset').disabled=true;
    try{
      let result=await api.pomodoroFocusTask({projectId,taskId});
      if(result?.needsConfirm){
        if(!window.confirm('当前已有一轮计时。切换到这件事会重新开始专注，继续吗？'))return;
        result=await api.pomodoroFocusTask({projectId,taskId,replace:true,expectedRevision:result.state.revision});
      }
      if(!result?.ok){toast(result?.needsConfirm?'计时状态已变化，请重新选择任务。':result?.message||'未能开始专注，请重试。');return;}
      apply(result.state);toast(panel.hidden||$('#moduleCard').hidden?'专注已在后台开始；可在共用工具中显示番茄钟。':'已开始专注；计时结束后由你手动勾选任务。');
    }catch{toast('未确认专注是否开始，请查看番茄钟后重试。');}
    finally{busy=false;$('#pomoStart').disabled=$('#pomoReset').disabled=false;schedule();}
  }
  $('#pomoReset').onclick=()=>{if(['running','paused'].includes(value.status)&&!window.confirm('重置当前番茄钟？本轮计时进度会清除。'))return;void command('reset');};
  $('#pomoSettings').onclick=async()=>{await refresh();$('#pomoFocus').value=value.settings.focus;$('#pomoBreak').value=value.settings.break;text('#pomoSaveStatus','');$('#pomoDialog').showModal();};
  $('#pomoClose').onclick=()=>{if(!settingsBusy)$('#pomoDialog').close();};
  $('#pomoDialog').addEventListener('cancel',event=>{if(settingsBusy)event.preventDefault();});
  $('#pomoForm').onsubmit=async event=>{
    event.preventDefault();if(settingsBusy||busy||!api.pomodoroSettings)return;
    const settings={focus:Number($('#pomoFocus').value),break:Number($('#pomoBreak').value)};
    if(!Number.isInteger(settings.focus)||settings.focus<1||settings.focus>120||!Number.isInteger(settings.break)||settings.break<1||settings.break>30){text('#pomoSaveStatus','请输入范围内的整数分钟。');return;}
    settingsBusy=true;const origin=document.activeElement,controls=[...$('#pomoForm').querySelectorAll('input,button')];controls.forEach(node=>node.disabled=true);
    try{const result=await api.pomodoroSettings(settings);if(result.ok){apply(result.state);state.pomodoroSettings={...result.state.settings};if(editing&&draft)draft.pomodoroSettings={...result.state.settings};text('#pomoSaveStatus','时长已单独保存（不提交布局草稿）。');}else text('#pomoSaveStatus',result.message||'保存失败，原时长已保留。');}
    catch{text('#pomoSaveStatus','保存失败，原时长已保留。');}
    finally{settingsBusy=false;controls.forEach(node=>node.disabled=false);$('#pomoStart').disabled=$('#pomoReset').disabled=false;if(controls.includes(origin)&&document.activeElement===document.body)origin.focus({preventScroll:true});schedule();}
  };
  const unsubscribe=api.onPomodoroState?.(apply);
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)void refresh();});
  window.addEventListener('focus',refresh);
  window.addEventListener('pagehide',()=>{clearTimeout(timer);unsubscribe?.();window.removeEventListener('focus',refresh);},{once:true});
  window.pomodoroUI={busySaving:()=>settingsBusy,focusTask,isTaskSelected:task=>value.task?.id===task.id&&value.task?.projectId===task.projectId,layoutChanged:()=>{if(displayed())void refresh();else schedule();}};
  apply(value);void refresh();
})();
