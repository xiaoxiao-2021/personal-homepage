/* A small local layer over existing tasks, entries and the shared timer. */
(()=>{
  const api=window.homeApi;if(!api?.personalWorkRead)return;
  let value=null,busy=false,todayOnly=false,flight=null,resourceTask=null,lastRead=0,disposed=false;
  const key=t=>JSON.stringify([t.projectId,t.id]);
  const day=(at=Date.now())=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const currentPlan=()=>value?.plans?.find(p=>p.day===day());
  const pinned=t=>currentPlan()?.tasks.some(x=>key(x)===key(t));
  const button=(label,action,classes='btn subtle')=>{const n=make('button',classes,label);n.type='button';n.onclick=action;return n;};
  const duration=ms=>ms<60000?(ms>0?'不足1分钟':'0分钟'):`${Math.floor(ms/60000)}分钟`;
  const host=make('div','personal-plan-controls');host.id='personalPlanControls';
  const filter=button('今日重点 0/3',()=>{todayOnly=!todayOnly;renderTasks({preserveScroll:false});},'personal-plan-filter');filter.id='personalPlanFilter';filter.setAttribute('aria-pressed','false');
  const carry=make('div','personal-carry');carry.id='personalCarry';carry.hidden=true;
  const status=make('small','personal-work-status');status.id='personalWorkStatus';status.setAttribute('role','status');host.append(filter,status,carry);$('#taskFilterSummary').after(host);
  const summary=button('今日专注 · 正在读取',()=>openJournal(),'personal-focus-summary');summary.id='personalFocusSummary';$('#pomoStatus').after(summary);
  const dialogs=document.createElement('div');dialogs.innerHTML=`
  <dialog id="taskResourceDialog" aria-labelledby="taskResourceHeading"><form class="modal" id="taskResourceForm"><h3 id="taskResourceHeading">给这件事带上资料</h3><p>关联已有入口，或主动选择文件、文件夹与网页。资料只保存在本机，不改动滴答任务。</p><div class="row"><label for="resourceMode">关联方式</label><select id="resourceMode"><option value="entry">已有入口</option><option value="website">网页链接</option><option value="file">本地文件</option><option value="folder">本地文件夹</option></select></div><div class="row" id="resourceEntryRow"><label for="resourceEntry">选择入口</label><select id="resourceEntry"></select></div><div class="row" id="resourceNameRow" hidden><label for="resourceName">显示名称</label><input id="resourceName" maxlength="100" placeholder="例如：文献资料"></div><div class="row" id="resourceTargetRow" hidden><label for="resourceTarget">地址</label><input id="resourceTarget" maxlength="4096" placeholder="https://"><button id="resourceChoose" class="btn" type="button">选择</button></div><p id="resourceError" role="status"></p><div class="modal-actions"><button id="resourceCancel" class="btn" type="button">取消</button><button id="resourceSave" class="btn primary" type="submit">关联资料</button></div></form></dialog>
  <dialog id="focusJournalDialog" aria-labelledby="focusJournalHeading"><div class="modal"><div class="personal-journal-heading"><div><h3 id="focusJournalHeading">一点一点，都是积累</h3><p>最近七天的实际专注 · 仅保存在本机</p></div><button id="focusJournalClose" class="btn subtle" type="button" aria-label="关闭专注记录">×</button></div><div id="focusJournalDays"></div><div class="personal-journal-legend">完整段：实际专注达到本轮时长。中断段保留已投入时间；暂停与系统睡眠不计入。记录最多保留90天。</div><div id="focusJournalSessions"></div><p id="focusJournalStatus" role="status"></p><div class="modal-actions"><button id="focusJournalClear" class="btn subtle" type="button">清空已结束记录</button></div></div></dialog>`;
  document.body.append(...dialogs.children);
  function controls(){
    const plan=currentPlan();filter.textContent=`今日重点 ${plan?.tasks.length||0}/3`;filter.setAttribute('aria-pressed',String(todayOnly&&!searchTaskLocation));filter.disabled=!value||value.readOnly||busy||editing||layoutSaveInFlight;
    status.textContent=value?.message||'';
    const previous=(value?.plans||[]).filter(p=>p.day<day()).at(-1),remaining=previous?.tasks.filter(t=>!t.completedAt)||[];
    const show=remaining.length&&!plan?.dismissedCarry&&!(plan?.tasks.length);
    carry.hidden=!show;carry.replaceChildren();
    if(show){carry.append(make('span','',`上次还有 ${remaining.length} 件重点，今天继续吗？`),button('继续今天',()=>change({action:'carry'})),button('暂不',()=>change({action:'dismiss-carry'})));}
    if(todayOnly&&!searchTaskLocation){$('#taskCardTitle').textContent=state.scene==='总览'?'今日重点':`${state.scene} · 今日重点`;$('#taskFilterSummary').textContent='自己选的三件事 · 不修改滴答日期与优先级';for(const b of $('#taskDateFilters').children)b.setAttribute('aria-pressed','false');}
  }
  function planRows(options={}){
    const node=$('#tasks'),scroll=node.scrollTop,ids=taskProjectsForView(didaDashboard?.projects||[]),pins=currentPlan()?.tasks||[];node.replaceChildren();
    if(!pins.length){node.append(make('div','task-message','从任务旁的小星星，选出今天最想推进的三件事。'));return;}
    const selected=state.scene==='总览'&&sceneTaskView().range==='scene'?pins:pins.filter(t=>ids.includes(t.projectId));
    if(!selected.length)node.append(make('div','task-message','这个范围还没有今日重点，可以从全部任务里选择。'));
    for(const pin of selected){const task=(didaDashboard?.tasks||[]).find(t=>key(t)===key(pin)&&Number(t.status)!==2);
      const stamp=task&&JSON.stringify([task.id,task.projectId,task.dueDate||null,task.startDate||null,task.repeatFlag||null]);
      if(!pin.completedAt&&task&&stamp===pin.occurrence)node.append(taskView(task,new Map((didaDashboard.projects||[]).map(p=>[p.id,p.name]))));
      else{const row=make('div','personal-plan-receipt');row.append(make('span','personal-plan-done',pin.completedAt?'✓':'○'),make('div','',pin.title));row.children[1].append(make('small','',pin.completedAt?'已确认完成，今天辛苦啦':task?'任务安排已变化，请重新选择这次任务':'暂未读取到这项任务，请刷新核对'));const remove=button('移出',()=>change({action:'unpin',...pin}));remove.disabled=busy||editing;row.append(remove);node.append(row);}
    }
    if(options.preserveScroll)node.scrollTop=scroll;
  }
  async function refresh(){
    if(disposed)return;if(flight)return flight;
    flight=(async()=>{try{const next=await api.personalWorkRead();if(next?.loaded&&(!value||Number(next.revision)>=Number(value.revision))){value=next;lastRead=Date.now();renderTasks({preserveScroll:true});renderJournal();}}catch{status.textContent='本地记录暂不可用，请稍后重试。';}finally{flight=null;}})();return flight;
  }
  async function change(input){
    if(busy||editing||layoutSaveInFlight)return false;busy=true;controls();
    try{const r=await api.personalWorkChange(input);if(!r?.ok){toast(r?.message||'尚未保存，请重试。');await refresh();return false;}if(r.state&&(!value||Number(r.state.revision)>=Number(value.revision)))value=r.state;return true;}
    catch{toast('本地保存未确认，请重试。');return false;}
    finally{busy=false;renderTasks({preserveScroll:true});renderJournal();}
  }
  function decorateTask(row,task){
    const star=button(pinned(task)?'★':'☆',()=>change({action:pinned(task)?'unpin':'pin',id:task.id,projectId:task.projectId}),'task-pin');star.dataset.pinTask=task.id;star.setAttribute('aria-pressed',String(Boolean(pinned(task))));star.setAttribute('aria-label',`${pinned(task)?'移出':'加入'}今日重点：${task.title}`);star.title=pinned(task)?'移出今日重点':'加入今日重点（最多三件）';star.disabled=!value||value.readOnly||busy||editing||layoutSaveInFlight;row.insertBefore(star,row.querySelector('.task-focus'));
  }
  function renderResources(task,parent,compact=false){
    const wrapper=make('section','personal-resources'),heading=make('div','personal-resources-heading');wrapper.dataset.resourcesFor=key(task);
    heading.append(make('strong','',compact?'随手打开资料':'这件事的资料'),button('＋ 关联',()=>openResourceEditor(task)));heading.lastChild.disabled=editing||busy||!value||value.readOnly;wrapper.append(heading);
    const group=value?.resources?.find(r=>key(r)===key(task));
    for(const item of group?.items||[]){const linked=item.entryId&&state.library[item.entryId],missing=item.entryId&&!linked;const row=make('div','personal-resource');const open=button((linked?.name||item.name)+(missing?' · 入口已移除':''),async()=>{try{const r=await api.personalWorkOpen({id:task.id,projectId:task.projectId,resourceId:item.id});if(!r?.ok)toast(r?.message||'资料无法打开，请重新关联。');}catch{toast('资料打开失败，请重新关联。');}},'personal-resource-open');open.title='打开关联资料';const remove=button('×',()=>change({action:'remove-resource',id:task.id,projectId:task.projectId,resourceId:item.id}));remove.setAttribute('aria-label','移除关联：'+(linked?.name||item.name));remove.disabled=busy||editing;row.append(open,remove);wrapper.append(row);}
    if(!group?.items.length)wrapper.append(make('p','sub','把文献、笔记或文件夹放在这件事旁边。'));parent.append(wrapper);
  }
  function resourceMode(){const mode=$('#resourceMode').value;$('#resourceEntryRow').hidden=mode!=='entry';$('#resourceNameRow').hidden=mode==='entry';$('#resourceTargetRow').hidden=mode==='entry';$('#resourceChoose').hidden=!['file','folder'].includes(mode);$('#resourceTarget').readOnly=['file','folder'].includes(mode);$('#resourceTarget').placeholder=mode==='website'?'https://':'点击选择，由你指定资料';$('#resourceError').textContent='';}
  function openResourceEditor(task){
    if(editing||busy)return;resourceTask={id:task.id,projectId:task.projectId};$('#taskResourceForm').reset();const select=$('#resourceEntry');select.replaceChildren();
    for(const [id,item] of Object.entries(state.library))if(hasEntryTarget(item)){const o=make('option','',item.name);o.value=id;select.append(o);}
    if(!select.children.length){const o=make('option','','还没有配置入口，可改选网页或本地资料');o.value='';select.append(o);}resourceMode();$('#taskResourceDialog').showModal();
  }
  $('#resourceMode').onchange=resourceMode;$('#resourceCancel').onclick=()=>$('#taskResourceDialog').close();
  $('#resourceChoose').onclick=async()=>{try{const r=await api.chooseLocalEntry($('#resourceMode').value);if(r.error){$('#resourceError').textContent=r.error;return;}if(!r.canceled){$('#resourceTarget').value=r.target;if(!$('#resourceName').value)$('#resourceName').value=r.target.split(/[\\/]/).pop().slice(0,100);}}catch{$('#resourceError').textContent='未能选择资料，请重试。';}};
  $('#taskResourceForm').onsubmit=async e=>{e.preventDefault();if(!resourceTask||busy)return;const mode=$('#resourceMode').value,resource=mode==='entry'?{entryId:$('#resourceEntry').value}:{kind:mode,target:$('#resourceTarget').value,name:$('#resourceName').value};if(mode==='entry'&&!resource.entryId||mode!=='entry'&&(!resource.target||!resource.name.trim())){$('#resourceError').textContent='请先选好资料，并填一个名称。';return;}$('#resourceSave').disabled=true;const ok=await change({action:'add-resource',...resourceTask,resource});$('#resourceSave').disabled=false;if(ok)$('#taskResourceDialog').close();else $('#resourceError').textContent='尚未关联，请检查内容后重试。';};
  function renderJournal(){
    const sessions=value?.sessions||[],today=day(),total=sessions.reduce((sum,s)=>sum+s.days.filter(d=>d.day===today).reduce((a,d)=>a+d.ms,0),0),completed=sessions.filter(s=>s.status==='completed'&&day(s.endedAt)===today).length;
    summary.textContent=`今天已专注 ${duration(total)} · 完成 ${completed} 段`;summary.title=value?.message||'查看近七天的实际专注记录';
    if(!$('#focusJournalDialog').open)return;
    const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=day(d.valueOf());const ms=sessions.reduce((sum,s)=>sum+s.days.filter(b=>b.day===k).reduce((a,b)=>a+b.ms,0),0);days.push({day:k,ms,completed:sessions.filter(s=>s.status==='completed'&&day(s.endedAt)===k).length});}
    const max=Math.max(60000,...days.map(d=>d.ms)),chart=$('#focusJournalDays');chart.replaceChildren();
    for(const d of days){const row=make('div','personal-day');row.append(make('span','',d.day===today?'今天':d.day.slice(5).replace('-','/')));const track=make('div','personal-day-track'),fill=make('span');fill.style.width=(d.ms/max*100)+'%';track.append(fill);row.append(track,make('span','',duration(d.ms)),make('small','',`${d.completed} 段`));chart.append(row);}
    const list=$('#focusJournalSessions');list.replaceChildren();const recent=sessions.filter(s=>s.startedAt>=Date.now()-7*86400000).slice(-20).reverse();
    for(const s of recent){const row=make('div','personal-session');row.append(make('strong','',s.task?.title||'自由专注'),make('small','',`${new Date(s.startedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${duration(s.activeMs)} · ${({running:'进行中',paused:'已暂停',completed:'完整结束',interrupted:'中断，时间已保留'})[s.status]}`));list.append(row);}
    if(!recent.length)list.append(make('p','sub','开始一小段专注，慢慢积累就好。'));$('#focusJournalStatus').textContent=value?.message||'';$('#focusJournalClear').disabled=busy||!sessions.some(s=>['completed','interrupted'].includes(s.status));
  }
  function openJournal(){$('#focusJournalDialog').showModal();renderJournal();void refresh();}
  $('#focusJournalClose').onclick=()=>$('#focusJournalDialog').close();$('#focusJournalClear').onclick=()=>{if(window.confirm('清空已结束的本机专注记录？今日重点、关联资料和滴答任务不受影响。'))void change({action:'clear-history',confirm:true});};
  const original=renderTasks;renderTasks=function(options={}){original(options);controls();if(todayOnly&&!searchTaskLocation)planRows(options);};
  for(const n of [$('#taskDateFilters'),$('#taskRange'),$('#taskDates'),$('#inboxProject')])n.addEventListener(n.id==='taskDateFilters'?'click':'change',()=>{todayOnly=false;},{capture:true});
  window.personalWork={decorateTask,renderResources,refresh,timerChanged(){if(!document.hidden&&Date.now()-lastRead>=30000)void refresh();}};
  const visible=()=>{if(!document.hidden)void refresh();};window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);window.addEventListener('homepage-ready',visible);
  const unsubscribe=api.onPersonalWorkChanged?.(()=>void refresh());window.addEventListener('pagehide',()=>{disposed=true;unsubscribe?.();window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);window.removeEventListener('homepage-ready',visible);},{once:true});
  if(window.homepageReady)void refresh();
})();
