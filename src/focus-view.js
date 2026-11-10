/* A temporary view over the existing task and timer, with no persisted layout. */
(()=>{
  const dialog=$('#focusViewDialog');let identity=null,origin=null,homeScroll=null;
  const currentTask=()=>identity&&(didaDashboard?.tasks||[]).find(t=>t.projectId===identity.projectId&&t.id===identity.id&&Number(t.status)!==2);
  function music(){
    const track=musicTrack(),audio=$('#musicAudio');
    $('#focusViewMusicName').textContent=track?.name||'让这一刻安静一点也很好';
    $('#focusViewMusicPlay').disabled=!track;
    $('#focusViewMusicPlay').textContent=audio.paused?'播放音乐':'暂停音乐';
  }
  function timerChanged(value){
    if(!dialog.open||!value)return;
    const seconds=Math.max(0,Math.ceil(value.remainingMs/1000));
    $('#focusViewTime').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    $('#focusViewPhase').textContent=value.phase==='focus'?'专注这一刻':'休息一下';
    $('#focusViewStatus').textContent=({idle:'准备好了，就慢慢开始',running:'一步一步来',paused:'停一停，也没关系',completed:value.phase==='focus'?'这一段辛苦啦，任务由你确认完成':'休息结束，慢慢回到眼前这件事'})[value.status];
    const matching=value.task?.id===identity?.id&&value.task?.projectId===identity?.projectId;
    $('#focusViewToggle').textContent=value.status==='running'?'暂停':value.status==='paused'?'继续':value.status==='completed'?(value.phase==='focus'?'开始休息':'开始专注'):'开始';
    $('#focusViewToggle').disabled=$('#pomoStart').disabled||(!matching&&value.status!=='idle');
    $('#focusViewWrapup').hidden=!(matching&&value.status==='completed'&&value.phase==='focus');
    $('#focusViewContinue').disabled=$('#pomoStart').disabled;$('#focusViewBreak').disabled=$('#pomoStart').disabled;
    $('#focusViewReset').disabled=$('#pomoReset').disabled;
    if(!matching&&value.task)$('#focusViewStatus').textContent='计时关联已变化，请返回首页确认当前任务。';
  }
  function refresh(){
    if(!dialog.open)return;
    const task=currentTask(),host=$('#focusViewSteps');
    const active=document.activeElement?.dataset.checkItemId,scroll=dialog.scrollTop;
    host.replaceChildren();$('#focusViewComplete').disabled=!task;
    if(!task){$('#focusViewSource').textContent='任务已完成，或暂时不在当前同步结果中。';return;}
    $('#focusViewTitle').textContent=task.title;
    $('#focusViewSource').textContent=((didaDashboard.projects||[]).find(p=>p.id===task.projectId)?.name||'任务')+' · '+taskSourceLabel(didaDashboard.source);
    $('#focusViewDates').textContent=`开始：${taskDetailDate(task,'startDate')}　到期：${taskDetailDate(task,'dueDate')}`;
    $('#focusViewContent').textContent=task.content||task.desc||task.description||'留一点空白，也很好。';
    // Reuse the same guarded completion handlers and inline errors as the list.
    const row=taskView(task),steps=[...row.children].filter(n=>n.classList.contains('subtask'));
    const progress=row.querySelector('.task-item-progress');
    if(progress)host.append(make('p','sub',`小步骤 · ${progress.textContent}`));
    for(const step of steps){step.hidden=false;host.append(step);}
    if(!steps.length)host.append(make('p','sub','这一件，就从眼前开始。'));
    $('#focusViewComplete').disabled=row.querySelector('.task-complete').disabled;
    if(active){[...host.querySelectorAll('[data-check-item-id]')].find(n=>n.dataset.checkItemId===active)?.focus({preventScroll:true});}
    window.personalWork?.renderResources(task,host,true);
    dialog.scrollTop=scroll;music();timerChanged(window.pomodoroUI?.snapshot());
  }
  function open(projectId,id){
    if(editing||layoutSaveInFlight||document.querySelector('dialog[open]'))return;
    homeScroll={window:window.scrollY,tasks:$('#tasks').scrollTop};origin=document.activeElement;identity={projectId,id};
    dialog.showModal();refresh();dialog.scrollTop=0;$('#focusViewClose').focus({preventScroll:true});window.pomodoroUI?.layoutChanged();
  }
  $('#focusViewFloat').onclick=async()=>{const result=await window.homeApi.showFloatingTimer?.();if(!result?.ok)toast('悬浮计时器暂不可用，请使用新版首页。');};
  $('#focusViewClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{const target=origin?.isConnected?origin:[...document.querySelectorAll('#tasks [data-focus-task]')].find(n=>n.dataset.focusTask===identity?.id&&n.dataset.focusProject===identity?.projectId);identity=null;target?.focus({preventScroll:true});if(homeScroll){$('#tasks').scrollTop=homeScroll.tasks;window.scrollTo({top:homeScroll.window,behavior:'instant'});}window.pomodoroUI?.layoutChanged();});
  $('#focusViewToggle').onclick=()=>{const value=window.pomodoroUI?.snapshot();if(!value?.task&&identity)void window.pomodoroUI?.focusTask(identity.projectId,identity.id);else $('#pomoStart').click();};
  $('#focusViewReset').onclick=()=>$('#pomoReset').click();
  $('#focusViewComplete').onclick=()=>{const task=currentTask();if(task)requestTaskCompletion(task,{forceConfirm:true});};
  $('#focusViewContinue').onclick=()=>window.pomodoroUI?.command('continue-focus');
  $('#focusViewBreak').onclick=()=>window.pomodoroUI?.command('take-break');
  const unsubscribeReview=window.homeApi.onPomodoroReview?.(task=>{
    if(editing||layoutSaveInFlight||[...document.querySelectorAll('dialog[open]')].some(n=>n!==dialog)||(dialog.open&&(identity?.id!==task?.id||identity?.projectId!==task?.projectId))){toast('请先完成当前操作，再从专注任务中确认完成。');return;}
    const found=(didaDashboard?.tasks||[]).find(t=>t.id===task?.id&&t.projectId===task?.projectId&&Number(t.status)!==2);
    if(!found||didaDashboard.source!=='live'){toast('请先刷新任务列表，核对这件事是否已完成。');return;}
    if(!dialog.open)open(found.projectId,found.id);else refresh();
    if(!$('#focusViewComplete').disabled)requestTaskCompletion(found,{forceConfirm:true});
  });
  window.addEventListener('pagehide',()=>unsubscribeReview?.(),{once:true});
  $('#focusViewMusicPlay').onclick=()=>$('#musicPlay').click();
  for(const name of ['play','pause','loadedmetadata','ended','error'])$('#musicAudio').addEventListener(name,music);
  window.addEventListener('homepage-tools-rendered',music);
  window.taskFocusView={open,refresh,timerChanged};
})();
