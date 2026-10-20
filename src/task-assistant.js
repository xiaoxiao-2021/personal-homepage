/* No keys, arbitrary URLs or model-controlled write tools are kept in this page. */
(() => {
  const api=window.homeApi;
  $('#aiPreviewTitle').textContent='帮你记下来啦';$('#aiCreate').textContent='添加到滴答';$('#aiPreviewClose').textContent='先收好';
  $('#taskPermissionTitle').textContent='启用首页任务写入';
  $('#taskPermissionDialog .modal p').textContent='当前授权可以继续只读使用。仅在你点击授权按钮并在滴答官方页面同意后申请 tasks:read 与 tasks:write；首页支持手动完成任务及检查小项、预览确认后创建单个普通任务，不提供任意编辑或删除任务。小项勾选不提交父任务完成请求。授权失败保留原授权，不自动提交草稿。';
  $('#settingsDialog .settings-details p').textContent='默认仅申请 tasks:read；明确启用写入时才申请 tasks:write。令牌与 DeepSeek 密钥各自使用 Windows 加密保存，不写入页面状态、布局配置、备份或日志。任务助手只生成草稿；用户确认后创建单个任务。离线不写入、不排队。重复和子任务创建本轮不支持。';
  let generating=false,creating=false,requestEpoch=0,preview=null,completed=null,uncertain=false,privacyAccepted=false,settingsBusy=false,retryInput='';
  const input=$('#aiInput'),messages=$('#aiMessages'),status=$('#aiStatus');
  const setStatus=text=>{status.textContent=text;};
  const noteDialog=$('#aiPreviewDialog'),noteForm=$('#aiPreviewForm');
  const note=make('section','ai-note');note.id='aiDraftNote';note.setAttribute('aria-label','任务便签内容');
  const editor=make('div','ai-note-editor');editor.id='aiNoteEditor';editor.hidden=true;
  // Keep the original validated form and IDs; the paper preview and editor share one modal.
  [...noteForm.children].filter(node=>node.id!=='aiPreviewTitle'&&node.id!=='aiCreateStatus'&&!node.classList.contains('modal-actions')).forEach(node=>editor.append(node));
  $('#aiPreviewTitle').after(note,editor);
  const eyebrow=make('div','ai-note-eyebrow','一件小事，慢慢完成');noteForm.prepend(eyebrow);
  const doodle=make('span','ai-note-doodle');doodle.setAttribute('aria-hidden','true');doodle.innerHTML='<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="m24 5 6 12 13 2-9 10 2 14-12-7-12 7 2-14-9-10 13-2Z"/><circle cx="19" cy="24" r="1" fill="currentColor"/><circle cx="29" cy="24" r="1" fill="currentColor"/><path d="M20 29q4 4 8 0"/></svg>';$('#aiPreviewTitle').append(doodle);
  const closeNote=make('button','ai-note-hide','×');closeNote.id='aiNoteClose';closeNote.type='button';closeNote.setAttribute('aria-label','关闭便签并保留草稿');closeNote.onclick=()=>{if(!creating&&!generating){updatePreview();noteDialog.close();}};noteForm.prepend(closeNote);
  const editNote=make('button','btn','再改改');editNote.id='aiNoteEdit';editNote.type='button';editNote.setAttribute('aria-expanded','false');editNote.setAttribute('aria-controls','aiNoteEditor');editNote.onclick=()=>{if(!preview||creating||generating)return;updatePreview();const expanded=editor.hidden;editor.hidden=!expanded;note.hidden=expanded;editNote.textContent=expanded?'看看便签':'再改改';editNote.setAttribute('aria-expanded',String(expanded));if(expanded)$('#aiTitle').focus();};$('#aiCreate').before(editNote);
  const continueChat=make('button','ai-note-chat','想再聊聊？');continueChat.type='button';continueChat.onclick=()=>{if(creating||generating)return;updatePreview();noteDialog.close();setStatus('告诉我哪里要改，便签会重新浮现；还没有创建任务。');};$('#aiCreateStatus').after(continueChat);
  const message=(role,text)=>{const follow=messages.scrollHeight-messages.scrollTop-messages.clientHeight<32;const node=make('div',`ai-message ${role}`,text);messages.append(node);const history=messages.querySelectorAll('.ai-message');for(let i=0;i<history.length-24;i++)history[i].remove();if(follow)messages.scrollTop=messages.scrollHeight;};
  const reportInput=()=>{api.assistantInput?.(input.value);$('#aiSend').disabled=generating||creating||editing||layoutSaveInFlight||!input.value.trim();};
  const column=$('#taskColumn'),taskCard=column.querySelector('.task-card'),assistantCard=$('#assistantCard');
  let fitFrame=0;
  function updateFit(){
    fitFrame=0;
    const available=Math.floor(innerHeight-column.getBoundingClientRect().top-window.scrollY-16);
    const gap=parseFloat(getComputedStyle(column).gap)||14;
    const height=node=>node.getBoundingClientRect().height;
    const taskMin=Math.max(280,height(taskCard.querySelector('.head'))+height($('.task-view-controls'))+100);
    const assistantMin=Math.max(230,height(assistantCard.querySelector('.head'))+height($('.ai-composer'))+height(status)+64);
    const active=state.assistantLayout?.fitWindow!==false&&!editing&&innerWidth>1100&&!column.hidden&&available>=taskMin+assistantMin+gap;
    column.classList.toggle('fit-window',active);
    const rail=$('#moduleCard');
    const railAvailable=Math.floor(innerHeight-rail.getBoundingClientRect().top-window.scrollY-16);
    const fitRail=!editing&&innerWidth>1100&&!rail.hidden&&railAvailable>=320;
    rail.classList.toggle('fit-viewport',fitRail);
    if(fitRail)rail.style.setProperty('--tool-rail-height',`${railAvailable}px`);
    else rail.style.removeProperty('--tool-rail-height');
    if(active){
      column.style.setProperty('--left-height',`${available}px`);
      const both=!taskCard.hidden&&!assistantCard.hidden;
      const total=available-(both?gap:0);
      const weight=({compact:330,medium:390,tall:490})[state.assistantLayout?.height]||390;
      const taskWeight=({compact:350,medium:470,tall:620})[current().layout.heights.tasks]||470;
      const taskHeight=both?Math.max(taskMin,Math.min(total-assistantMin,Math.round(total*taskWeight/(taskWeight+weight)))):total;
      column.style.setProperty('--fit-task-height',`${taskHeight}px`);
      column.style.setProperty('--fit-assistant-height',`${both?total-taskHeight:total}px`);
    }
  }
  function scheduleFit(){if(!fitFrame)fitFrame=requestAnimationFrame(updateFit);}
  window.addEventListener('resize',scheduleFit);
  const fitObserver=new ResizeObserver(scheduleFit);
  ['.top','#sceneNav','.summary','.task-view-controls','#taskColumn .task-card .head','#assistantCard .head','.ai-composer','#aiStatus','#moduleStack [data-module="time"]','#moduleStack [data-module="music"]','#moduleStack [data-module="pomodoro"]'].forEach(selector=>{const node=$(selector);if(node)fitObserver.observe(node);});
  [...$('#moduleStack [data-module="calendar"]').children].forEach(node=>fitObserver.observe(node));
  window.addEventListener('pagehide',()=>{fitObserver.disconnect();window.removeEventListener('resize',scheduleFit);cancelAnimationFrame(fitFrame);},{once:true});
  function renderLayout(){
    const setting=state.assistantLayout||{visible:true,height:'medium'};
    $('#assistantCard').hidden=setting.visible===false;
    $('#assistantCard').style.setProperty('--assistant-height',`${({compact:330,medium:390,tall:490})[setting.height]||390}px`);
    const task=$('#taskColumn > .task-card');
    $('#taskColumn').hidden=task.hidden&&setting.visible===false;
    $('#aiLayoutVisible').checked=setting.visible!==false;
    $('#aiLayoutHeight').value=setting.height||'medium';
    $('#aiLayoutVisible').disabled=!editing||layoutSaveInFlight;
    $('#aiLayoutHeight').disabled=!editing||layoutSaveInFlight;
    $('#aiLayoutFit').checked=setting.fitWindow!==false;
    $('#aiLayoutFit').disabled=!editing||layoutSaveInFlight;
    $('#assistantCard').draggable=false;
    $('#aiSend').disabled=generating||creating||editing||layoutSaveInFlight||!input.value.trim();
    $('#aiSend').hidden=generating;
    $('#aiClear').disabled=generating||creating;
    $('#aiCancel').hidden=!generating;
    editNote.disabled=generating||creating||editing||layoutSaveInFlight||uncertain;
    closeNote.disabled=generating||creating;continueChat.disabled=generating||creating;
    $('#aiShowDraft').disabled=creating;
    $('#aiRetry').disabled=generating||creating||editing||layoutSaveInFlight;
    scheduleFit();
  }
  const controls=make('div','ai-layout-controls');
  const label=make('label');const visible=document.createElement('input');visible.type='checkbox';visible.id='aiLayoutVisible';label.append(visible,document.createTextNode(' 显示任务助手（全部场景）'));
  const height=document.createElement('select');height.id='aiLayoutHeight';height.setAttribute('aria-label','共用任务助手高度');
  [['compact','矮'],['medium','中'],['tall','高']].forEach(([value,text])=>{const option=make('option','',text);option.value=value;height.append(option);});
  const fitLabel=make('label');const fit=document.createElement('input');fit.type='checkbox';fit.id='aiLayoutFit';fitLabel.append(fit,document.createTextNode(' 左侧适应窗口（全部场景）'));
  controls.append(label,height,fitLabel,make('small','','宽窗口让左侧任务与助手适应窗口；入口和日历按内容排列，不强制等高。右侧工具优先留在当前窗口，内容较多可内部滚动；窄窗口或编辑时自然排布。'));$('#moduleDialog .modal').insertBefore(controls,$('#moduleDialog .modal-actions'));
  let managerBaseline=null;
  $('#moduleManagerBtn').addEventListener('click',()=>{managerBaseline=clone(state.assistantLayout||{version:1,visible:true,height:'medium'});renderLayout();});
  const cancelManager=()=>{if(managerBaseline){state.assistantLayout=managerBaseline;managerBaseline=null;renderLayout();}};
  $('#moduleCancel').addEventListener('click',cancelManager);
  $('#moduleDialog').addEventListener('cancel',cancelManager);
  $('#moduleSave').addEventListener('click',()=>{managerBaseline=null;});
  const changeLayout=()=>{if(!editing||layoutSaveInFlight)return;state.assistantLayout={...state.assistantLayout,visible:visible.checked,height:height.value,fitWindow:fit.checked};renderLayout();toast('左侧适配与任务助手设置影响全部场景；保存布局后生效。');};
  visible.onchange=changeLayout;height.onchange=changeLayout;fit.onchange=changeLayout;
  function readTask(){return {title:$('#aiTitle').value,projectId:$('#aiProject').value,content:$('#aiContent').value,date:$('#aiDate').value,time:$('#aiAllDay').checked?'':$('#aiTime').value,dateKind:$('#aiDateKind').value,isAllDay:$('#aiAllDay').checked};}
  function updatePreview(){if(preview){const task=readTask();if(JSON.stringify(task)!==JSON.stringify(preview.task)){preview.task=task;preview.revision=(preview.revision||1)+1;api.assistantPreview?.({id:preview.id,revision:preview.revision,task});renderNote();}}}
  function fillForm(){
    if(!preview)return;
    const task=preview.task;
    $('#aiPreviewContext').textContent=`来源场景：${preview.scene} · 发送时区：${preview.timeZone}${preview.sentAt?` · ${preview.sentAt}`:''}。切换场景不会改变目标；日期以此处的明确年月日为准。`;
    const project=$('#aiProject');project.replaceChildren();
    preview.projects.forEach(item=>{const option=make('option','',item.name);option.value=item.id;project.append(option);});project.value=task.projectId;
    $('#aiTitle').value=task.title;$('#aiDate').value=task.date;$('#aiTime').value=task.time;$('#aiDateKind').value=task.dateKind;$('#aiAllDay').checked=task.isAllDay;$('#aiTime').disabled=task.isAllDay;$('#aiContent').value=task.content;
    $('#aiCreateStatus').textContent=uncertain?'上次创建结果不确定，请先在滴答客户端核对。':'先看看，合适了再添加～';
    $('#aiCreate').disabled=uncertain;
  }
  function openPreview(){
    if((!preview&&!completed)||generating||creating)return;
    if(preview)fillForm();renderNote();
    editor.hidden=true;note.hidden=false;editNote.textContent='再改改';editNote.setAttribute('aria-expanded','false');
    if(!noteDialog.open)noteDialog.showModal();
    noteDialog.scrollTop=0;
    closeNote.focus({preventScroll:true});
  }
  function revealNote(){openPreview();}
  function renderNote(){
    const value=preview||completed;
    if(!value){note.hidden=true;note.replaceChildren();return;}
    note.classList.toggle('completed',!preview);note.replaceChildren();
    $('#aiCreate').hidden=!preview;editNote.hidden=!preview;continueChat.hidden=!preview;
    const head=make('div','ai-note-head',preview?'待你确认':'✓ 已添加到滴答');note.append(head);
    const title=make('h4','ai-note-title',value.task.title);note.append(title);
    const t=value.task;
    if(t.content)note.append(make('p','ai-note-content',t.content));
    else note.append(make('p','ai-note-content ai-note-empty','一点点完成，也很棒。'));
    const icons={calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m4 0h1m-6 3h1m4 0h1"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'};
    const row=(icon,text,style)=>{const line=make('div',`ai-note-line ${style}`);const mark=make('span','ai-note-icon');mark.setAttribute('aria-hidden','true');mark.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[icon]+'</svg>';line.append(mark,make('span','',text));return line;};
    const explicitDate=t.date?t.date.replace(/^(\d+)-(\d+)-(\d+)$/,'$1年$2月$3日'):'未设日期';
    note.append(row('calendar',(!preview&&value.dateCheck?.status!=='verified'&&value.warning?'便签日期：':'')+explicitDate+(t.date?(t.dateKind==='start'?' · 开始日期':' · 到期日期'):''),'ai-note-date'));
    note.append(row('clock',t.date?(t.isAllDay?'全天':t.time||'未设时间'):'未设时间','ai-note-time'));
    note.append(row('folder','放进「'+(value.projects?.find(p=>p.id===t.projectId)?.name||'请核对目标清单')+'」','ai-note-project'));
    if(preview?.previousCreated)note.append(make('p','ai-note-warning','上一项已添加，这张是新的便签；请确认不是重复任务。'));
    if(!preview){
      if(value.warning)note.append(make('p','ai-note-warning',value.warning));
      $('#aiCreateStatus').textContent=value.warning?'任务已经创建，请核对上方提示；不要重复添加。':value.dateCheck?.status==='verified'?'这件小事已记好，日期也核对好了。':'这件小事已记好，慢慢完成就好。';
    }
  }
  const draftButton=make('button','btn','查看便签');draftButton.id='aiShowDraft';draftButton.setAttribute('aria-label','查看任务便签');draftButton.type='button';draftButton.hidden=true;draftButton.onclick=()=>{$('#aiMenu').open=false;revealNote();};$('#aiMenu').append(draftButton);
  const retryButton=make('button','btn','重新生成便签');retryButton.id='aiRetry';retryButton.type='button';retryButton.hidden=true;retryButton.onclick=()=>{input.value=retryInput;reportInput();void send();};$('#assistantCard .ai-actions').prepend(retryButton);
  const resolveButton=make('button','btn','核对不确定结果');resolveButton.id='aiResolve';resolveButton.hidden=true;
  resolveButton.onclick=async()=>{
    if(!window.confirm('请先在滴答客户端检查任务是否已创建。已创建的任务不要再次提交。本操作只解除首页的防重复提示，不撤销、不重新发送任何任务。确认已经核对？'))return;
    const result=await api.assistantResolve();
    if(result.ok){uncertain=false;preview=null;renderNote();draftButton.hidden=!completed;resolveButton.hidden=true;setStatus('已解除提示；不会重发旧草稿。需要时请重新描述。');}else setStatus(result.message);
  };$('#assistantCard .ai-actions').prepend(resolveButton);
  async function send(){
    if(generating||creating||editing||layoutSaveInFlight)return;
    if(uncertain){setStatus('请先核对上次创建结果。');return;}
    if(!api.assistantGenerate){setStatus('当前运行入口不支持任务助手，请启动新版。');return;}
    if(!input.value.trim())return;
    if(!privacyAccepted){
      if(!window.confirm('发送到 DeepSeek 的内容包括：你的输入、最近少量聊天、当前便签（含手动修改）、本次已创建便签及当前时间/时区和清单名称/ID。不自动上传滴答已有任务、入口路径或文件。API 可能收费。避免输入患者等敏感信息。是否发送？'))return;
      privacyAccepted=true;
    }
    updatePreview();
    const text=input.value,scene=state.scene,epoch=++requestEpoch;generating=true;retryButton.hidden=true;renderLayout();setStatus('正在准备便签… 可取消；此时不会写入滴答。');
    try {
      const result=await api.assistantGenerate({input:text,scene});
      if(epoch!==requestEpoch)return;
      if(!result?.ok){setStatus(result?.message||'生成失败，原便签保留，未创建任务。');retryInput=text;retryButton.hidden=!result?.retryable;return;}
      message('user',text);message('assistant',result.message);input.value='';reportInput();
      if(result.preview){preview=result.preview;completed=null;fillForm();generating=false;revealNote();setStatus('便签待确认 · 尚未创建任务。');}
      else setStatus(preview?'可以继续说明；原便签仍在，尚未提交。':'可以补充说明继续对话。');
      draftButton.hidden=!preview&&!completed;
    } catch {if(epoch===requestEpoch)setStatus('连接失败，未创建任务。');}
    finally {if(epoch===requestEpoch){generating=false;renderLayout();}}
  }
  async function cancel(){requestEpoch++;generating=false;await api.assistantCancel?.();setStatus('已取消生成；没有创建任务。');renderLayout();}
  input.addEventListener('input',reportInput);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void send();}});
  $('#aiSend').onclick=send;$('#aiCancel').onclick=cancel;
  $('#aiClear').onclick=async()=>{$('#aiMenu').open=false;const result=await api.assistantClear?.();if(result?.ok){messages.replaceChildren();input.value='';reportInput();preview=null;completed=null;renderNote();draftButton.hidden=true;retryButton.hidden=true;setStatus('本次聊天已清空；没有删除任何任务。');}else setStatus(result?.message||'请等待请求结束。');};
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#aiMenu'))$('#aiMenu').open=false;});
  $('#aiMenu').addEventListener('keydown',event=>{if(event.key==='Escape'){$('#aiMenu').open=false;$('#aiMenu summary').focus();event.preventDefault();}});
  $('#aiPreviewForm').addEventListener('input',()=>{$('#aiTime').disabled=$('#aiAllDay').checked;updatePreview();});
  $('#aiPreviewForm').addEventListener('change',updatePreview);
  $('#aiPreviewClose').onclick=()=>{if(!creating){updatePreview();$('#aiPreviewDialog').close();}};
  $('#aiPreviewDialog').addEventListener('cancel',event=>{if(creating||generating)event.preventDefault();else updatePreview();});
  $('#aiPreviewDialog').addEventListener('close',()=>{if(!creating)input.focus();});
  $('#aiPreviewForm').addEventListener('invalid',()=>{editor.hidden=false;note.hidden=true;editNote.textContent='看看便签';editNote.setAttribute('aria-expanded','true');},true);
  // Enter inside an editor must not implicitly submit a task.
  $('#aiPreviewForm').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName!=='BUTTON'&&event.target.tagName!=='TEXTAREA')event.preventDefault();});
  $('#aiPreviewForm').onsubmit=async event=>{
    event.preventDefault();if(creating||generating||!preview||uncertain||layoutSaveInFlight)return;
    if(editing){$('#aiCreateStatus').textContent='请先保存或取消布局，再创建任务。';return;}
    creating=true;updatePreview();renderLayout();
    const fields=[...$('#aiPreviewForm').querySelectorAll('input,select,textarea,button')];fields.forEach(node=>node.disabled=true);$('#aiCreateStatus').textContent='正在提交到滴答，请勿关闭或重复点击…';
    try {
      const submitted=structuredClone(preview);
      const result=await api.assistantCreate({id:submitted.id,revision:submitted.revision||1,task:submitted.task});
      if(result.ok){
        if(result.dashboard){applyDidaDashboard(result.dashboard);renderTasks({preserveScroll:true});renderStatus();}
        completed={...submitted,dateCheck:result.dateCheck,warning:result.warning};preview=null;renderNote();draftButton.hidden=false;$('#aiPreviewDialog').close();message('assistant','已添加到滴答，不会重复创建。');setStatus(result.warning||(result.dateCheck?.status==='verified'?'已添加，日期已核对，并刷新任务区域。':'已添加并刷新任务区域。'));
      }else {
        $('#aiCreateStatus').textContent=result.message||'创建未成功。';
        setStatus(result.message||'没有创建成功，便签保留，可编辑后重试。');
        if(result.code==='uncertain'){uncertain=true;resolveButton.hidden=false;setStatus(result.message);}
        if(result.code==='scope')$('#aiCreateStatus').textContent+=' 关闭草稿后，在“设置 → 启用首页完成任务”查看并明确授权写入；不会自动重新授权。';
      }
    }catch {uncertain=true;resolveButton.hidden=false;$('#aiCreateStatus').textContent='没有收到确定结果，请在滴答客户端核对，勿重复提交。';setStatus($('#aiCreateStatus').textContent);}
    finally {creating=false;fields.forEach(node=>node.disabled=false);$('#aiTime').disabled=$('#aiAllDay').checked;$('#aiCreate').disabled=uncertain;renderLayout();}
  };
  async function openSettings(){
    $('#aiKey').value='';$('#aiSettingsDialog').showModal();
    try {const value=await api.assistantStatus();$('#aiModel').value=value.model;$('#aiSettingsStatus').textContent=value.configured?'已保存密钥（不返回明文）。替换可输入新密钥。':'尚未配置，请输入自己的 API Key。';}catch{$('#aiSettingsStatus').textContent='当前入口无法读取 AI 设置。';}
  }
  $('#aiSettings').onclick=openSettings;
  const settingsButton=make('button','btn','配置 DeepSeek 任务助手');settingsButton.type='button';settingsButton.onclick=openSettings;$('#settingsDialog .modal').insertBefore(settingsButton,$('#settingsDialog .modal-actions'));
  async function settingsAction(work){if(settingsBusy)return;settingsBusy=true;const buttons=[...$('#aiSettingsForm').querySelectorAll('button,input,select')];buttons.forEach(node=>node.disabled=true);try{await work();}catch{$('#aiSettingsStatus').textContent='操作失败，未确认保存。';}finally{settingsBusy=false;buttons.forEach(node=>node.disabled=false);$('#aiKey').value='';}}
  $('#aiSettingsForm').onsubmit=event=>{event.preventDefault();void settingsAction(async()=>{const result=await api.assistantSettings({key:$('#aiKey').value,model:$('#aiModel').value});$('#aiSettingsStatus').textContent=result.ok?'AI 设置已单独保存；没有发送聊天请求。':result.message;});};
  $('#aiRemoveKey').onclick=()=>{if(window.confirm('只删除本机 AI 密钥；滴答授权、布局和歌单不受影响。'))void settingsAction(async()=>{const result=await api.assistantSettings({remove:true});$('#aiSettingsStatus').textContent=result.ok?'AI 密钥已移除。':result.message;});};
  $('#aiTest').onclick=()=>{if(window.confirm('测试已保存的密钥和模型，会向 DeepSeek 发送一条合成测试消息，可能收费；不会写入滴答。'))void settingsAction(async()=>{const result=await api.assistantTest();$('#aiSettingsStatus').textContent=result.ok?'DeepSeek 返回有效响应，连接测试通过；未创建任务。':result.message;});};
  $('#aiSettingsDialog').addEventListener('cancel',event=>{if(settingsBusy)event.preventDefault();});$('#aiSettingsDialog').addEventListener('close',()=>{$('#aiKey').value='';});
  window.taskAssistant={renderLayout,busyCreating:()=>creating,prepareTransition:()=>{updatePreview();reportInput();if(generating)void cancel();}};
  async function restore(){
    try {const session=await api.assistantSession?.();if(session){input.value=session.input||'';session.messages?.forEach(item=>message(item.role,item.role==='assistant'&&item.content.startsWith('{')?'任务便签已生成。':item.content));preview=session.preview;completed=session.lastCreated;uncertain=session.uncertain;if(preview)fillForm();renderNote();draftButton.hidden=!preview&&!completed;resolveButton.hidden=!uncertain;if(uncertain)setStatus('上次创建结果不确定，请先核对滴答客户端。');}}
    catch {setStatus('无法恢复本次聊天状态。');}renderLayout();
  }
  void restore();
})();
