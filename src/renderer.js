const SCENES = ['总览', '🏥 临床', '🔬 科研', '📚 学习', '🏠 生活'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = () => `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const desktopMode = new URLSearchParams(location.search).get('desktop') === '1';
function moduleDefaults(preset='standard') { const life=preset==='life'; return { visible:{tasks:true,apps:true,side:!life,time:life,calendar:life,music:life}, order:['tasks','apps',...(life?['time','calendar','music']:['side'])], sizes:{tasks:'medium',apps:'medium',side:'medium',time:'medium',calendar:'medium',music:'medium'} }; }
function toolDefaults() { return { version:2, visible:{time:true,calendar:true,music:true}, order:['time','calendar','music'], sizes:{time:'medium',calendar:'medium',music:'medium'}, musicCollapsed:false, accent:'theme', clockFormat:'24', clockSize:'standard', calendarDensity:'standard' }; }
function normalizeTools(saved, fallback) {
  const base=toolDefaults();
  const source=saved&&typeof saved==='object'?saved:(fallback&&typeof fallback==='object'?fallback:{});
  const visible=Object.fromEntries(base.order.map(key=>[key,typeof source.visible?.[key]==='boolean'?source.visible[key]:base.visible[key]]));
  const order=Array.isArray(source.order)?source.order.filter((key,index,array)=>base.order.includes(key)&&array.indexOf(key)===index):base.order.slice();
  for(const key of base.order)if(!order.includes(key))order.push(key);
  const sizes=Object.fromEntries(base.order.map(key=>[key,['compact','medium','large'].includes(source.sizes?.[key])?source.sizes[key]:base.sizes[key]]));
  return {
    version:2,visible,order,sizes,musicCollapsed:Boolean(source.musicCollapsed),
    accent:['theme','green','mist','brown'].includes(source.accent)?source.accent:base.accent,
    clockFormat:['12','24'].includes(String(source.clockFormat))?String(source.clockFormat):base.clockFormat,
    clockSize:['standard','large'].includes(source.clockSize)?source.clockSize:base.clockSize,
    calendarDensity:['standard','compact'].includes(source.calendarDensity)?source.calendarDensity:base.calendarDensity
  };
}
function toolsNeedMigration(config){const source=config?.tools;return !source||Number(source.version)<2||!['theme','green','mist','brown'].includes(source.accent)||!['12','24'].includes(String(source.clockFormat))||!['standard','large'].includes(source.clockSize)||!['standard','compact'].includes(source.calendarDensity);}
function defaultLayout(focus='normal', heightMode='content', preset='standard') { return { order:['tasks','apps','side'], focus, heights:{tasks:heightMode,apps:heightMode,side:heightMode}, entrySize:'medium', spacing:'comfortable', entryStyle:'tiles', showUnsetEntries:true, modules:moduleDefaults(preset) }; }
function defaultTaskView() { return { range:'scene', dates:'all', inboxProjectId:'' }; }
function defaultTaskViews() { return Object.fromEntries(SCENES.map((scene)=>[scene,defaultTaskView()])); }
const defaults = {
  version: 1, scene: '总览', theme: 'warm', shortcut: 'Control+Alt+H', didaListIds: {}, taskView:defaultTaskView(), taskViews:defaultTaskViews(), tools:toolDefaults(), music:{tracks:[],volume:.8,lastTrackId:'',lastTime:0},
  appearance: { wallpaper: '', glass: 'frosted', dim: 8, fit: 'cover', position: 'center', renderQuality: 'smooth' },
  library: {
    zotero:{name:'Zotero',type:'软件',icon:'⌘',description:'文献管理'}, obsidian:{name:'Obsidian',type:'软件',icon:'◈',description:'知识笔记'}, prism:{name:'Prism',type:'软件',icon:'◫',description:'数据绘图'}, word:{name:'Word',type:'软件',icon:'◉',description:'文档写作'}, browser:{name:'浏览器',type:'网站',icon:'✦',description:'科研检索'}, dida:{name:'滴答清单',type:'软件',icon:'▣',description:'任务管理'}, adcy:{name:'ADCY7 项目',type:'项目',icon:'◈',description:'项目演示入口'}, literature:{name:'本周文献清单',type:'资料',icon:'◫',description:'资料演示入口'}, japanese:{name:'日语学习',type:'学习入口',icon:'✦',description:'学习演示入口'}
  },
  scenes: {
    '总览':{apps:['zotero','obsidian','prism','word','browser','dida'],side:[['研究项目','adcy'],['固定资料','literature'],['学习入口','japanese']],layout:defaultLayout()},
    '🏥 临床':{apps:['word','browser','dida'],side:[['当前项目','adcy'],['固定资料','literature'],['学习入口','japanese']],layout:defaultLayout()},
    '🔬 科研':{apps:['zotero','obsidian','prism','browser'],side:[['当前项目','adcy'],['固定资料','literature'],['学习入口','japanese']],layout:defaultLayout()},
    '📚 学习':{apps:['obsidian','browser','dida'],side:[['当前项目','adcy'],['固定资料','literature'],['学习入口','japanese']],layout:defaultLayout()},
    '🏠 生活':{apps:['dida','browser'],side:[['当前项目','adcy'],['固定资料','literature'],['学习入口','japanese']],layout:defaultLayout('normal','content','life')}
  }
};
let taskViewSaveInFlight = false;
let layoutSaveInFlight = false;
const taskData = {
  '总览':{overdue:['提交本周实验记录'],groups:[['🏥 临床',['完成规培安排确认','整理病例学习笔记']],['🔬 科研',['核对实验计划','阅读一篇相关文献']],['📚 学习',['日语 10 词','统计学习 30 分钟']],['🏠 生活',[]]]},
  '🏥 临床':{overdue:[],groups:[['🏥 临床',['完成规培安排确认','整理病例学习笔记','确认明日任务']]]},
  '🔬 科研':{overdue:['提交本周实验记录'],groups:[['🔬 科研',['核对实验计划','阅读一篇相关文献','整理数据分析思路']]]},
  '📚 学习':{overdue:[],groups:[['📚 学习',['日语 10 词','统计学习 30 分钟','复盘今日笔记']]]},
  '🏠 生活':{overdue:[],groups:[['🏠 生活',[]]]}
};
let state = clone(defaults);
let editing = false;
let draft = null;
let editTarget = { area:'apps', id:null };
let toastTimer;
let pendingTransition = null;
let transitionRunning = false;
let dida = { state:'unconnected', message:'尚未连接滴答清单。', capabilities:[] };
let didaDashboard = null;
const taskCompletionPending = new Set();
const taskCompletionErrors = new Map();
let completionConfirmTask = null;
function applyDidaDashboard(value) {
  if (value && Number(value.revision || 0) < Number(didaDashboard?.revision || 0)) return;
  didaDashboard = value;
}
function openCompletionPermission() { $('#taskPermissionDialog').showModal(); }
async function submitTaskCompletion(task) {
  const key=JSON.stringify([task.projectId,task.id]);
  if(taskCompletionPending.has(key))return;
  taskCompletionPending.add(key);taskCompletionErrors.delete(key);renderTasks({preserveScroll:true});
  try {
    const occurrence=JSON.stringify([task.id,task.projectId,task.dueDate||null,task.startDate||null,task.repeatFlag||null]);
    const result=await window.homeApi.completeDidaTask(task.projectId,task.id,occurrence);
    if(!result?.ok){taskCompletionErrors.set(key,result?.message||'未能确认完成，请刷新核对。');if(result?.code==='scope')openCompletionPermission();}
    else {applyDidaDashboard(result.dashboard);toast(result.warning||(result.alreadyCompleted?'任务已经完成，列表已更新。':'任务已同步完成。'));}
  } catch {taskCompletionErrors.set(key,'未能确认完成结果，请刷新核对后再试。');}
  finally {taskCompletionPending.delete(key);renderTasks({preserveScroll:true});renderStatus();}
}
function requestTaskCompletion(task) {
  if(editing||layoutSaveInFlight)return;
  if(!dida.canComplete){openCompletionPermission();return;}
  if(task.repeatFlag||(task.checkItems||task.subtasks||[]).some(item=>Number(item.status)!==2)){
    completionConfirmTask=task;$('#taskCompleteConfirmText').textContent=`完成“${task.title}”？${task.repeatFlag?'这是重复任务，只完成当前实例；下一次安排由滴答生成。':''} ${(task.checkItems||task.subtasks||[]).length?'这将完成整个父任务，而不是单个检查项。':''}本页不提供撤销，请确认后操作。`;
    $('#taskCompleteConfirmDialog').showModal();return;
  }
  void submitTaskCompletion(task);
}
let refreshInFlight = false;
let lastDidaAttemptAt = 0;
let didaFailureCount = 0;
const iconQueue = [];
let activeIconRequests = 0;
let didaPollTimer = null;
const uiTimings = { scene: null, search: null, edit: null };
const collapsedTaskGroups = new Set();
let appearanceDraft = null;
let settingsMappingDraft = null;
let settingsSaving = false;
const DIDA_GROUPS = [
  { key:'clinical', scene:'🏥 临床', label:'🏥 临床', hint:'临床' },
  { key:'research', scene:'🔬 科研', label:'🔬 科研', hint:'科研' },
  { key:'study', scene:'📚 学习', label:'📚 学习', hint:'学习' },
  { key:'life', scene:'🏠 生活', label:'🏠 生活', hint:'生活' }
];
function toast(text) { const node=$('#toast'); node.textContent=text; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),2400); }
function recordUiTiming(key,startedAt){uiTimings[key]=Math.round((performance.now()-startedAt)*10)/10;}
function validConfig(config) { return config && typeof config==='object' && config.version===1 && config.library && config.scenes && SCENES.every(scene=>config.scenes[scene]); }
function normalizeModules(saved, scene) { const fallback=moduleDefaults(scene==='🏠 生活'?'life':'standard'); const source=saved&&typeof saved==='object'?saved:{}; const visible={...fallback.visible,...(source.visible||{})}; const order=Array.isArray(source.order)?source.order.filter((key,index,array)=>Object.prototype.hasOwnProperty.call(fallback.visible,key)&&array.indexOf(key)===index):fallback.order.slice(); for(const key of Object.keys(fallback.visible))if(!order.includes(key))order.push(key); const sizes={...fallback.sizes,...(source.sizes||{})}; for(const key of Object.keys(sizes))if(!['compact','medium','large'].includes(sizes[key]))sizes[key]='medium'; return {visible,order,sizes}; }
function normalize(config) { if(!validConfig(config))return clone(defaults);const normalized=clone(config);normalized.theme=['warm','peach','night'].includes(normalized.theme)?normalized.theme:defaults.theme;const source=normalized.appearance&&typeof normalized.appearance==='object'?normalized.appearance:{};normalized.appearance={...clone(defaults.appearance),...source};if(!['clear','frosted','transparent'].includes(normalized.appearance.glass))normalized.appearance.glass=defaults.appearance.glass;if(!['cover','contain'].includes(normalized.appearance.fit))normalized.appearance.fit=defaults.appearance.fit;if(!['center','top','bottom'].includes(normalized.appearance.position))normalized.appearance.position=defaults.appearance.position;if(!['smooth','full'].includes(normalized.appearance.renderQuality))normalized.appearance.renderQuality='smooth';normalized.appearance.dim=Math.max(0,Math.min(35,Number(normalized.appearance.dim)||0));normalized.appearance.wallpaper=typeof normalized.appearance.wallpaper==='string'?normalized.appearance.wallpaper:'';normalized.taskView={...clone(defaults.taskView),...(normalized.taskView||{})};if(!['scene','inbox'].includes(normalized.taskView.range))normalized.taskView.range='scene';if(!['all','today'].includes(normalized.taskView.dates))normalized.taskView.dates='all';normalized.taskView.inboxProjectId=typeof normalized.taskView.inboxProjectId==='string'?normalized.taskView.inboxProjectId:'';const legacyView=clone(normalized.taskView);const savedTaskViews=normalized.taskViews&&typeof normalized.taskViews==='object'?normalized.taskViews:{};normalized.taskViews={};for(const scene of SCENES){const savedView=savedTaskViews[scene]&&typeof savedTaskViews[scene]==='object'?savedTaskViews[scene]:scene==='总览'?legacyView:{range:'scene',dates:legacyView.dates,inboxProjectId:''};const view={...clone(defaultTaskView()),...savedView};if(!['scene','inbox'].includes(view.range))view.range='scene';if(!['all','today'].includes(view.dates))view.dates='all';view.inboxProjectId=typeof view.inboxProjectId==='string'?view.inboxProjectId:'';normalized.taskViews[scene]=view;}normalized.taskView=clone(normalized.taskViews['总览']);for(const scene of SCENES){const fallback=defaultLayout(defaults.scenes[scene].layout.focus,'medium');const saved=normalized.scenes[scene].layout&&typeof normalized.scenes[scene].layout==='object'?normalized.scenes[scene].layout:{};const order=Array.isArray(saved.order)?saved.order.filter((key,index,array)=>['tasks','apps','side'].includes(key)&&array.indexOf(key)===index):fallback.order;normalized.scenes[scene].layout={...fallback,...saved,order:order.length===3?order:fallback.order.slice(),focus:['normal','tasks','apps','side'].includes(saved.focus)?saved.focus:fallback.focus,heights:{...fallback.heights,...(saved.heights||{})},entrySize:['small','medium','large'].includes(saved.entrySize)?saved.entrySize:fallback.entrySize,spacing:['tight','comfortable','spacious'].includes(saved.spacing)?saved.spacing:fallback.spacing,entryStyle:['tiles','compact'].includes(saved.entryStyle)?saved.entryStyle:fallback.entryStyle,showUnsetEntries:typeof saved.showUnsetEntries==='boolean'?saved.showUnsetEntries:fallback.showUnsetEntries};for(const card of ['tasks','apps','side'])if(!['content','compact','medium','tall'].includes(normalized.scenes[scene].layout.heights[card]))normalized.scenes[scene].layout.heights[card]='medium';}return normalized; }
function current() { return state.scenes[state.scene]; }
function normalizeWithModules(config) { const normalized=normalize(config); normalized.music={...clone(defaults.music),...(normalized.music||{})}; normalized.music.tracks=Array.isArray(normalized.music.tracks)?normalized.music.tracks.filter(track=>track&&typeof track.id==='string'&&typeof track.target==='string').map(track=>({...track,name:String(track.name||track.target.split(/[\\/]/).pop()),target:String(track.target)})):[]; normalized.music.volume=Math.max(0,Math.min(1,Number(normalized.music.volume)||0)); normalized.music.lastTrackId=typeof normalized.music.lastTrackId==='string'?normalized.music.lastTrackId:''; normalized.music.lastTime=Math.max(0,Number(normalized.music.lastTime)||0); for(const scene of SCENES){const layout=normalized.scenes[scene].layout;const hadModules=Boolean(config?.scenes?.[scene]?.layout?.modules);layout.modules=normalizeModules(layout.modules,scene);if(scene==='🏠 生活'&&!hadModules){layout.modules=normalizeModules(moduleDefaults('life'),scene);layout.modulesMigrated=true;}/* Keep the three primary columns consistent across scenes. Older builds used focus-apps/focus-side to resize the task card. */layout.focus='normal';} return normalized; }
function normalizeConfigWithTools(config) {
  const normalized=normalizeWithModules(config);
  const legacy=config?.scenes?.['🏠 生活']?.layout?.modules;
  normalized.tools=normalizeTools(config?.tools,legacy);
  return normalized;
}
function sceneTaskView(scene=state.scene) { return scene==='总览' ? (state.taskView || state.taskViews?.[scene] || defaults.taskView) : (state.taskViews?.[scene] || defaults.taskView); }
function entry(id) { return state.library[id]; }
function entryKindLabel(kind) { return ({application:'本机应用',file:'文件',folder:'文件夹',website:'网站'})[kind] || '演示入口'; }
function hasEntryTarget(item) { return ['application','file','folder','website'].includes(item?.kind) && typeof item?.target==='string' && Boolean(item.target.trim()); }
function entryDescription(item) { return hasEntryTarget(item) ? entryKindLabel(item.kind) : '未设置地址 · 演示入口'; }
function wallpaperCssPath(value){const path=String(value||'').replace(/\\/g,'/').replace(/#/g,'%23').replace(/\?/g,'%3F').replace(/"/g,'%22');return path?`url("file:///${path}")`:'none';}
let lastAppearanceKey = '';
function renderAppearance(){
  const appearance=state.appearance||defaults.appearance;
  const key=JSON.stringify([state.theme,appearance,desktopMode]);
  if(key!==lastAppearanceKey){
    lastAppearanceKey=key;
    for(const theme of ['peach','night'])document.body.classList.toggle(theme,state.theme===theme);
    for(const glass of ['clear','frosted','transparent'])document.body.classList.toggle('glass-'+glass,appearance.glass===glass);
    document.body.classList.toggle('desktop-home',desktopMode);
    document.body.classList.toggle('effects-smooth',appearance.renderQuality!=='full');
    document.body.style.setProperty('--wallpaper-image',wallpaperCssPath(appearance.wallpaper));
    document.body.style.setProperty('--wallpaper-size',appearance.fit);
    document.body.style.setProperty('--wallpaper-position',appearance.position);
    document.body.style.setProperty('--wallpaper-dim',String(appearance.dim/100));
  }
  $('#theme').value=state.theme;$('#glass').value=appearance.glass;
  $('#renderQuality').value=appearance.renderQuality==='full'?'full':'smooth';
  $('#wallpaperDim').value=String(appearance.dim);$('#wallpaperDimValue').textContent=appearance.dim+'%';
  $('#wallpaperFit').value=appearance.fit;$('#wallpaperPosition').value=appearance.position;
  $('#wallpaperName').textContent=appearance.wallpaper?appearance.wallpaper.split(/[\\/]/).pop():'使用默认渐变背景';
}
function setTargetControls() {
  const mode=$('#entryMode').value;
  const connected=mode!=='demo';
  $('#targetRow').hidden=!connected;
  $('#chooseTarget').hidden=!['application','file','folder'].includes(mode);
  $('#entryTarget').required=connected;
  $('#entryTarget').disabled=!connected;
  $('#entryTarget').placeholder=mode==='website'?'https://example.com':'选择文件，或粘贴完整路径（可带双引号）';
  $('#targetHelp').textContent=mode==='application'?'选择应用的 .exe 文件。桌面快捷方式暂不支持。':'只保存入口引用，不移动原文件。';
  $('#entryError').textContent='';
}
async function persist() {
  // Background refresh must never commit an unfinished edit/appearance preview.
  const saved=clone(editing&&draft?draft:state);
  if(appearanceDraft){saved.theme=appearanceDraft.theme;saved.appearance=clone(appearanceDraft.appearance);}
  await window.homeApi.saveConfig(saved);
}
function dateText() { const now=new Date(); $('#dateText').textContent=now.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})+' · '+now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); if(typeof renderTimeModule==='function')renderTimeModule(); }
function make(tag, classes, text) { const node=document.createElement(tag); if(classes) node.className=classes; if(text!==undefined) node.textContent=text; return node; }
function renderScenes() { const nav=$('#sceneNav'); nav.replaceChildren(); SCENES.forEach(scene=>{ const button=make('button',`scene ${state.scene===scene?'active':''}`,scene); button.dataset.scene=scene; nav.append(button); }); $('#sceneTitle').textContent=state.scene; const sideVisible=normalizeModules(current().layout.modules,state.scene).visible.side!==false; $('#sceneSub').textContent=state.scene==='总览'?'任务安排与常用入口':sideVisible?'当前场景的任务、入口与资料':'当前场景的任务与常用入口'; }
function dateKey(value, allDay) { return HomeTaskView.dateKey(value,allDay); }
function todayKey(){return dateKey(new Date().toISOString(),false);}
function groupForProject(projectId){return DIDA_GROUPS.find((group)=>state.didaListIds?.[group.key]===projectId)||null;}
function taskDate(task){return HomeTaskView.taskDate(task);}
function taskView(task,projectName=new Map()) {
  const overdue=Boolean(task.dueDate&&dateKey(task.dueDate,task.isAllDay)!=='invalid'&&dateKey(task.dueDate,task.isAllDay)<todayKey());
  const node=make('div',`task ${overdue?'task-overdue':''}`),key=JSON.stringify([task.projectId,task.id]);
  const mark=make('button','task-complete',taskCompletionPending.has(key)?'…':'');mark.type='button';mark.dataset.taskId=task.id;
  mark.setAttribute('role','checkbox');mark.setAttribute('aria-checked','false');mark.setAttribute('aria-label',`完成任务：${task.title}`);
  const live=['live','partial'].includes(didaDashboard?.source)&&!(didaDashboard?.source==='partial'&&(!Array.isArray(didaDashboard.failedProjectIds)||didaDashboard.failedProjectIds.includes(task.projectId)));
  mark.disabled=editing||layoutSaveInFlight||taskCompletionPending.has(key)||!live||['expired','authorizing'].includes(dida.state);
  mark.title=taskCompletionPending.has(key)?'正在同步完成…':!live?'请联网刷新后再完成任务':!dida.canComplete?'点击了解如何启用完成任务':'同步完成此任务';
  mark.onclick=()=>requestTaskCompletion(task);node.append(mark);
  const text=make('span','task-body');text.append(make('span','',task.title));const notes=[];if(overdue)notes.push('逾期');if(task.repeatFlag)notes.push('重复');const scheduled=taskDate(task);if(!task.isAllDay&&scheduled){const parsed=new Date(scheduled);if(!Number.isNaN(parsed.valueOf()))notes.push(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed));}if(task.startDate&&!task.dueDate)notes.push(`开始于 ${formatTaskDay(dateKey(task.startDate,task.isAllDay))}`);if(notes.length)text.append(make('small','',notes.join(' · ')));
  if(taskCompletionErrors.has(key)){const error=make('small','task-complete-error',taskCompletionErrors.get(key));error.setAttribute('role','alert');text.append(error);}
  node.append(text);const listName=task.__projectName||projectName.get(task.projectId);if(listName)node.append(make('small','task-list-name',listName));(task.checkItems||task.subtasks||[]).filter((item)=>Number(item.status)!==2).forEach((item)=>node.append(make('div','subtask',`↳ ${item.title}`)));return node;
}
function taskGroup(title,tasks,emptyLabel='今天暂无任务',emptyTone=''){
  if(!tasks.length){const row=make('div',`task-group empty-group ${emptyTone}`.trim());row.append(make('strong','',title),make('span','task-state',emptyLabel));return row;}
  const detail=make('details','task-group');detail.open=!collapsedTaskGroups.has(title);detail.dataset.groupTitle=title;const summary=make('summary');summary.append(document.createTextNode(title),make('span','count',String(tasks.length)));detail.append(summary);tasks.forEach((task)=>detail.append(taskView(task)));return detail;
}
function taskSourceLabel(source){return ({live:'已同步',partial:'部分同步',cache:'离线缓存',error:'同步失败',expired:'授权过期',none:'未连接',loading:'正在读取',authorizing:'等待授权'})[source]||'状态未知';}
function formatTaskDay(key){if(!key||key==='invalid')return '日期待确认';const[y,m,d]=key.split('-');return key.startsWith(todayKey().slice(0,4))?`${Number(m)}月${Number(d)}日`:`${y}年${Number(m)}月${Number(d)}日`;}
function taskProjectsForView(projects){
  const view=sceneTaskView();
  if(view.range==='inbox')return view.inboxProjectId?[view.inboxProjectId]:[];
  if(state.scene==='总览')return projects.map(project=>project.id);
  const group=DIDA_GROUPS.find(item=>item.scene===state.scene);const id=group&&state.didaListIds?.[group.key];return id?[id]:[];
}
function renderInboxProject(projects){
  const select=$('#inboxProject');const view=sceneTaskView();const known=projects.some(project=>project.id===view.inboxProjectId);
  select.replaceChildren();const empty=make('option','','选择指定清单');empty.value='';select.append(empty);
  projects.forEach(project=>{const option=make('option','',project.name);option.value=project.id;select.append(option);});
  if(view.inboxProjectId&&!known){const stale=make('option','','已选清单暂未读取到');stale.value=view.inboxProjectId;select.append(stale);}
  select.value=view.inboxProjectId||'';select.hidden=view.range!=='inbox';select.title='请选择要显示的指定清单；首页仅保存并使用该清单 ID。';
}
async function saveTaskView(change){
  if(editing){toast('请先保存或取消布局编辑，再切换任务视图。');return;}
  if(taskViewSaveInFlight){toast('任务视图正在保存，请稍候。');return;}
  taskViewSaveInFlight=true;$('#taskRange').disabled=true;$('#taskDates').disabled=true;$('#inboxProject').disabled=true;
  const scene=state.scene;const before=clone(sceneTaskView(scene));state.taskViews=state.taskViews||{};state.taskViews[scene]={...before,...change};if(scene==='总览')state.taskView=clone(state.taskViews[scene]);
  try{const saved=clone(state);if(await window.homeApi.saveConfig(saved)===false)throw new Error('save failed');renderTasks();toast(`${scene}任务视图已保存。`);}
  catch{state.taskViews[scene]=before;if(scene==='总览')state.taskView=clone(before);$('#taskRange').value=before.range;$('#taskDates').value=before.dates;$('#inboxProject').value=before.inboxProjectId||'';renderTasks();toast('任务视图保存失败，已恢复之前的选择。');}
  finally{taskViewSaveInFlight=false;$('#taskRange').disabled=false;$('#taskDates').disabled=false;$('#inboxProject').disabled=false;renderTasks();}
}
function renderTasks({preserveScroll=false}={}) {
  const host=$('#tasks'),previousScroll=preserveScroll?host.scrollTop:0;host.replaceChildren();
  const view=sceneTaskView(),projects=didaDashboard?.projects||[],projectName=new Map(projects.map(project=>[project.id,project.name]));
  $('#taskRange').value=view.range;$('#taskDates').value=view.dates;renderInboxProject(projects);
  const title=view.range==='inbox'?(view.dates==='today'?'指定清单 · 今天':'指定清单安排'):(state.scene==='总览'?(view.dates==='today'?'今天':'全部安排'):`${state.scene} · ${view.dates==='today'?'今天':'全部安排'}`);
  $('#taskCardTitle').textContent=title;
  const sourceKey=didaDashboard?.source||({loading:'loading',authorizing:'authorizing',expired:'expired',error:'error',unconnected:'none'}[dida.state]||'none');
  const label=taskSourceLabel(dida.state==='expired'&&sourceKey==='cache'?'expired':sourceKey),selectedInbox=projectName.get(view.inboxProjectId);const mappedGroup=DIDA_GROUPS.find((group)=>group.scene===state.scene);const mappedName=state.scene!=='总览'&&mappedGroup?projectName.get(state.didaListIds?.[mappedGroup.key]):'';const sourceText=view.range==='inbox'&&selectedInbox?`指定清单：${selectedInbox}`:state.scene==='总览'?'全部已读清单':mappedName||'未关联清单';$('#taskSource').textContent=`${sourceText} · ${refreshInFlight?`${label} · 正在刷新`:label}`;
  if(!didaDashboard){host.append(make('div','task-message',refreshInFlight?'正在读取滴答清单…':dida.message||'尚未连接滴答清单。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  if(['none','error','expired'].includes(sourceKey)){host.append(make('div',`task-message ${sourceKey==='none'?'':'task-message-warning'}`,didaDashboard.message||dida.message||'滴答清单暂不可用。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  if(dida.state==='expired'&&sourceKey==='cache')host.append(make('div','task-banner task-message-warning','授权已过期 · 当前显示的是上次成功同步的离线缓存。'));
  if(view.range==='inbox'&&!view.inboxProjectId){host.append(make('div','task-message task-message-warning','请选择要显示的指定清单。当前接入不会自动判断滴答真实收集箱；未选择前不能判断为空。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  const projectIds=taskProjectsForView(projects),knownIds=new Set(projects.map(project=>project.id));
  if(view.range==='scene'&&state.scene!=='总览'&&!projectIds.length){host.append(make('div','task-message task-state-neutral','当前场景尚未关联任务清单；请在设置中关联对应清单。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  if(view.range==='scene'&&state.scene!=='总览'&&projectIds.length&&!knownIds.has(projectIds[0])){host.append(make('div','task-message task-message-warning','已关联的清单暂未读取到；不会将其显示为无任务。请检查清单关联或同步状态。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  if(view.range==='inbox'&&!knownIds.has(view.inboxProjectId)){host.append(make('div','task-message task-message-warning','已选择的指定清单暂未读取到；不会将其显示为无任务。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  const failedIds=new Set(Array.isArray(didaDashboard.failedProjectIds)?didaDashboard.failedProjectIds:[]),unknownFailures=sourceKey==='partial'&&failedIds.size===0&&Number(didaDashboard.failedCount)>0;
  const failedSelected=sourceKey==='partial'&&(unknownFailures||projectIds.some(id=>failedIds.has(id)));
  if(sourceKey==='partial')host.append(make('div','task-banner task-message-warning',`部分同步：${Number(didaDashboard.failedCount)||0} 个清单读取失败；${failedSelected?'当前选择范围可能不完整。':'当前选择的清单已成功读取。'}`));
  let tasks=(didaDashboard.tasks||[]).filter(task=>Number(task.status)!==2&&projectIds.includes(task.projectId));
  if(view.dates==='today')tasks=tasks.filter(task=>HomeTaskView.taskDay(task)===todayKey()||(task.dueDate&&dateKey(task.dueDate,task.isAllDay)!=='invalid'&&dateKey(task.dueDate,task.isAllDay)<todayKey()));
  tasks.sort(HomeTaskView.compareTasks);
  if(view.dates==='today'){
    if(view.range==='inbox'){
      if(failedSelected){host.append(make('div','task-message task-message-warning','指定清单读取失败 · 暂不能确认任务。'));}
      else if(!tasks.length)host.append(make('div','task-message','今天暂无未完成任务。'));
      else host.append(taskGroup('今天',tasks.map(task=>({...task,__projectName:projectName.get(task.projectId)}))));
    }else{
      const groups=state.scene==='总览'?DIDA_GROUPS:DIDA_GROUPS.filter(group=>group.scene===state.scene);
      groups.forEach(group=>{const id=state.didaListIds?.[group.key];if(!id){host.append(taskGroup(group.label,[],'未关联清单','task-state-neutral'));return;}if(sourceKey==='partial'&&(failedIds.has(id)||unknownFailures)){host.append(taskGroup(group.label,[],'清单读取失败 · 暂不能确认','task-state-warning'));return;}if(!knownIds.has(id)){host.append(taskGroup(group.label,[],'关联清单不可用 · 请检查设置','task-state-warning'));return;}const groupTasks=tasks.filter(task=>task.projectId===id).map(task=>({...task,__projectName:projectName.get(task.projectId)}));host.append(taskGroup(group.label,groupTasks,sourceKey==='cache'?'缓存中无今天任务':'今天暂无任务',sourceKey==='cache'?'task-state-stale':''));});
      if(state.scene==='总览'){const other=tasks.filter(task=>!groupForProject(task.projectId));if(other.length)host.append(taskGroup('其他清单（未归类）',other.map(task=>({...task,__projectName:projectName.get(task.projectId)}))));}
    }
    if(!tasks.length&&failedSelected)host.append(make('div','task-message task-message-warning','部分清单读取失败，今天的任务可能不完整。'));
    if(preserveScroll)host.scrollTop=previousScroll;return;
  }
  if(failedSelected&&view.range==='inbox'){host.append(make('div','task-message task-message-warning','指定清单读取失败 · 任务列表不完整。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  if(!tasks.length){host.append(make('div','task-message',failedSelected?'清单读取失败 · 暂不能确认没有任务。':sourceKey==='cache'?'缓存中没有未完成任务。':'暂无未完成任务。'));if(preserveScroll)host.scrollTop=previousScroll;return;}
  const grouped=new Map();for(const task of tasks){const key=HomeTaskView.taskDay(task)??'no-date';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push({...task,__projectName:projectName.get(task.projectId)||'其他清单'});}
  const today=todayKey();
  for(const [key,items] of grouped){
    const heading=key==='invalid'?'日期待确认':key==='no-date'?'未设日期':HomeTaskView.dayLabel(key,today);
    const detail=make('details','task-group');detail.open=!collapsedTaskGroups.has(heading);detail.dataset.groupTitle=heading;const summary=make('summary');summary.append(document.createTextNode(heading),make('span','count',String(items.length)));detail.append(summary);items.forEach(task=>detail.append(taskView(task,projectName)));host.append(detail);
  }
  if(preserveScroll)host.scrollTop=previousScroll;
}
const iconCache=new Map();const iconPending=new Map();
function runIconQueue(){while(activeIconRequests<3&&iconQueue.length){const job=iconQueue.shift();activeIconRequests++;Promise.resolve().then(job).finally(()=>{activeIconRequests--;runIconQueue();});}}
function iconStamp(item){const raw=`${item.kind||'demo'}\0${item.target||''}`;let hash=2166136261;for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);}
function requestSystemIcon(id,item,host){if(editing||!hasEntryTarget(item)||item.kind==='website'||!window.homeApi?.entryIcon)return;const stamp=iconStamp(item);host.dataset.iconId=id;host.dataset.iconStamp=stamp;const cached=iconCache.get(`${id}:${stamp}`);if(cached){if(cached.kind==='system')applyIconImage(host,cached.dataUrl);return;}const cacheKey=`${id}:${stamp}`;let pending=iconPending.get(cacheKey);if(!pending){pending=new Promise((resolve)=>{iconQueue.push(()=>window.homeApi.entryIcon(id).then(resolve).catch(()=>resolve({kind:'fallback'})));runIconQueue();}).then((result)=>{if(result?.kind==='system'&&typeof result.dataUrl==='string'&&result.dataUrl.length<66000&&result.dataUrl.startsWith('data:image/png;base64,')){iconCache.set(cacheKey,result);while(iconCache.size>96)iconCache.delete(iconCache.keys().next().value);return result;}iconCache.set(cacheKey,{kind:'fallback'});while(iconCache.size>96)iconCache.delete(iconCache.keys().next().value);return {kind:'fallback'};}).catch(()=>({kind:'fallback'})).finally(()=>iconPending.delete(cacheKey));iconPending.set(cacheKey,pending);}pending.then((result)=>{if(result.kind==='system'&&host.isConnected&&host.dataset.iconId===id&&host.dataset.iconStamp===stamp)applyIconImage(host,result.dataUrl);});}
function applyIconImage(host,dataUrl){const image=document.createElement('img');image.alt='';image.draggable=false;image.src=dataUrl;host.classList.add('has-system-icon');host.replaceChildren(image);}
function entryCopy(item){const copy=make('span','entry-copy');copy.append(make('b','',item.name));if(!hasEntryTarget(item)){const status=current().layout.showUnsetEntries?'未设置':'未设置 · 日常视图中隐藏';copy.append(make('small','entry-unset',status));}return copy;}
function buttonEntry(item, sideLabel, index) {
  const node=make('div',sideLabel?'side-entry':'entry');const description=entryDescription(item);node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`${item.name}${hasEntryTarget(item)?`，${item.description||entryKindLabel(item.kind)}`:'，未设置地址'}。按 Enter 打开，按 Shift+F10 查看操作`);node.title=`${item.name}${item.description?` · ${item.description}`:hasEntryTarget(item)?` · ${entryKindLabel(item.kind)}`:' · 未设置地址'}`;node.dataset.entry=item.id;node.dataset.entryArea=sideLabel?'side':'apps';
  const icon=make('span',sideLabel?'mini':'entry-icon',item.kind==='website'?'↗':item.icon);node.draggable=editing;node.dataset.index=String(index);node.append(icon,entryCopy(item));
  const edit=make('button','edit-item','✎');edit.type='button';edit.title='编辑此入口（所有场景共享）';edit.setAttribute('aria-label',`编辑 ${item.name}`);edit.dataset.edit=sideLabel?'side':'apps';edit.dataset.entry=item.id;edit.dataset.entryArea=sideLabel?'side':'apps';
  const remove=make('button','remove','×');remove.type='button';remove.title='仅从当前场景移除此入口';remove.setAttribute('aria-label',`从当前场景移除 ${item.name}`);remove.dataset.remove=sideLabel?'side':'apps';remove.dataset.entry=item.id;remove.dataset.entryArea=sideLabel?'side':'apps';node.append(edit,remove);requestSystemIcon(item.id,item,icon);return node;
}
function entrySearchText(item,label=''){return [label,item.name,item.type,item.description,entryDescription(item)].join(' ').toLocaleLowerCase();}
function emptyEntryState(host,area,hiddenCount,query){const box=make('div','empty-entries');const message=query?'没有匹配的入口。搜索也会查找尚未设置地址的入口。':hiddenCount?'未设置入口已隐藏；可在编辑布局中查看或配置。':'这里还没有入口。';box.append(make('span','',message));if(!query){const action=make('button','btn',hiddenCount?'查看并编辑':'添加入口');action.type='button';if(hiddenCount)action.dataset.editLayout='1';else action.dataset.add=area;box.append(action);}host.append(box);}
function visibleEntryRefs(refs,query){return refs.filter(({item})=>item&&entrySearchText(item).includes(query||'')&&(query||editing||current().layout.showUnsetEntries||hasEntryTarget(item)));}
function renderApps(){
  const host=$('#appGrid');host.replaceChildren();const query=$('#search').value.trim().toLocaleLowerCase();const refs=current().apps.map((id,index)=>({id,index,item:entry(id)}));const filtered=visibleEntryRefs(refs.map(({id,index,item})=>({id,index,item,search:entrySearchText(item||{})})),query);filtered.forEach(({id,index,item})=>host.append(buttonEntry({...item,id},'',index)));if(filtered.length)return;const hiddenCount=query?0:refs.filter(({item})=>item&&!hasEntryTarget(item)).length;emptyEntryState(host,'apps',hiddenCount,query);
}
function renderSide(){
  const host=$('#sideEntries');host.replaceChildren();const query=$('#search').value.trim().toLocaleLowerCase();const refs=current().side.map(([label,id],index)=>({label,id,index,item:entry(id)}));const filtered=refs.filter(({label,item})=>item&&entrySearchText(item,label).includes(query)&&(query||editing||current().layout.showUnsetEntries||hasEntryTarget(item)));filtered.forEach(({label,id,index,item})=>host.append(make('div','label',label),buttonEntry({...item,id},label,index)));if(filtered.length)return;const hiddenCount=query?0:refs.filter(({item})=>item&&!hasEntryTarget(item)).length;emptyEntryState(host,'side',hiddenCount,query);
}
let calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);let calendarSelected=new Date();let calendarFollowToday=true;let musicIndex=-1;let musicUrlFlight=null;let musicSaveTimer=null;
function calendarNow(){return new Date();}
function localCalendarDay(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function parseCalendarDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const [year,month,day]=value.split('-').map(Number);const parsed=new Date(year,month-1,day);return localCalendarDay(parsed)===value?parsed:null;}
function reportCalendarSession(){window.homeApi.reportCalendarState?.(calendarFollowToday?{follow:true}:{follow:false,cursor:localCalendarDay(calendarCursor),selected:localCalendarDay(calendarSelected)});}
function restoreCalendarSession(value){if(!value||value.follow!==false)return;const cursor=parseCalendarDay(value.cursor),selected=parseCalendarDay(value.selected);if(!cursor||!selected)return;calendarFollowToday=false;calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);calendarSelected=selected;lastCalendarKey='';}
function followCalendarToday(){calendarFollowToday=true;renderCalendar();reportCalendarSession();}
function browseCalendarMonth(delta){calendarFollowToday=false;calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+delta,1);renderCalendar();reportCalendarSession();}
function selectCalendarDay(value,restoreFocus=false){const selected=parseCalendarDay(value);if(!selected)return;calendarFollowToday=false;calendarSelected=selected;renderCalendar();reportCalendarSession();if(restoreFocus)$('#calendarGrid').querySelector(`[data-calendar-day="${value}"]`)?.focus({preventScroll:true});}
function formatClockTime(date){const hour12=normalizeTools(state.tools).clockFormat==='12';return date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12});}
function renderTimeModule(){const now=new Date();$('#moduleTimeNow').textContent=formatClockTime(now);$('#moduleTimeDate').textContent=now.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});$('#moduleTimeDate').title='使用电脑本地时间与时区';
}
function sameLocalDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
let lastCalendarKey='';let calendarZone='';let calendarCursorAnchor=localCalendarDay(calendarCursor),calendarSelectedAnchor=localCalendarDay(calendarSelected);
function renderCalendar(){
  const now=calendarNow(),today=localCalendarDay(now);
  const zone=`${Intl.DateTimeFormat().resolvedOptions().timeZone}|${now.getTimezoneOffset()}`;
  if(calendarZone&&zone!==calendarZone&&!calendarFollowToday){
    const cursor=parseCalendarDay(calendarCursorAnchor),selected=parseCalendarDay(calendarSelectedAnchor);
    if(cursor)calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);
    if(selected)calendarSelected=selected;
  }
  calendarZone=zone;
  if(calendarFollowToday&&(!sameLocalDay(calendarSelected,now)||calendarCursor.getFullYear()!==now.getFullYear()||calendarCursor.getMonth()!==now.getMonth())){calendarSelected=new Date(now.getFullYear(),now.getMonth(),now.getDate());calendarCursor=new Date(now.getFullYear(),now.getMonth(),1);}
  calendarCursorAnchor=localCalendarDay(calendarCursor);calendarSelectedAnchor=localCalendarDay(calendarSelected);
  const key=[calendarCursorAnchor,calendarSelectedAnchor,today,zone,calendarFollowToday].join('|');
  if(key===lastCalendarKey)return;
  const label=$('#calendarLabel'),grid=$('#calendarGrid');if(!label||!grid)return;
  lastCalendarKey=key;const focusedDay=document.activeElement?.dataset?.calendarDay;
  label.textContent=calendarCursor.toLocaleDateString('zh-CN',{year:'numeric',month:'long'});grid.replaceChildren();
  const first=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);const mondayIndex=(first.getDay()+6)%7;const start=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1-mondayIndex);const daysInMonth=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,0).getDate();const cellCount=Math.ceil((mondayIndex+daysInMonth)/7)*7;
  for(let i=0;i<cellCount;i++){const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);const dayKey=localCalendarDay(day),isToday=dayKey===today,isSelected=sameLocalDay(day,calendarSelected);const button=make('button','',String(day.getDate()));button.type='button';button.dataset.calendarDay=dayKey;button.setAttribute('role','gridcell');button.setAttribute('aria-label',`${day.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}${isToday?' · 今天':''}${isSelected?' · 已选中':''}`);if(day.getMonth()!==calendarCursor.getMonth()||day.getFullYear()!==calendarCursor.getFullYear())button.classList.add('adjacent');if(isToday){button.classList.add('today');button.setAttribute('aria-current','date');}if(isSelected)button.classList.add('selected');button.setAttribute('aria-selected',String(isSelected));grid.append(button);}
  if(focusedDay)grid.querySelector(`[data-calendar-day="${focusedDay}"]`)?.focus({preventScroll:true});
  $('#calendarSelected').textContent=`${calendarFollowToday?'跟随今天':'正在浏览其他日期'} · ${calendarSelected.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}`;
  $('#calendarFollowBtn').hidden=calendarFollowToday;
}
function formatAudioTime(value){if(!Number.isFinite(value)||value<0)return '00:00';const m=Math.floor(value/60),s=Math.floor(value%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function musicTrack(){return state.music?.tracks?.[musicIndex]||null;}
async function setMusicSource(track,autoplay=false){const audio=$('#musicAudio');if(!track){audio.removeAttribute('src');audio.load();return;}const url=await window.homeApi.audioUrl(track.id);audio.src=url;audio.volume=Number(state.music.volume)||.8;audio.currentTime=track.id===state.music.lastTrackId?Number(state.music.lastTime)||0:0;musicUrlFlight=null;renderMusic();if(autoplay)audio.play().catch(()=>{$('#musicStatus').textContent='音频无法播放或格式不支持。';});}
let lastMusicReport='';
function sendMusicState(){
  const value={playing:!$('#musicAudio').paused,title:musicTrack()?.name||''};
  const key=JSON.stringify(value);if(key===lastMusicReport)return;
  lastMusicReport=key;window.homeApi.reportMusicState?.(value);
}
let lastMusicListKey='';
function updateMusicProgress(){
  if(document.hidden||$('#moduleCard').hidden||$('#moduleStack [data-module="music"]').hidden||state.tools?.musicCollapsed)return;
  const audio=$('#musicAudio'),progress=$('#musicProgress'),time=$('#musicTime');
  const percent=audio.duration?String(Math.round(audio.currentTime/audio.duration*100)):'0';
  if(progress.value!==percent)progress.value=percent;
  const text=formatAudioTime(audio.currentTime)+' / '+formatAudioTime(audio.duration);
  if(time.textContent!==text)time.textContent=text;
}
function renderMusic(){const audio=$('#musicAudio'),tracks=state.music?.tracks||[];if(musicIndex<0&&tracks.length)musicIndex=Math.max(0,tracks.findIndex(item=>item.id===state.music.lastTrackId));if(musicIndex>=tracks.length)musicIndex=tracks.length-1;const track=musicTrack();const empty=tracks.length===0;$('#moduleStack [data-module="music"]').classList.toggle('is-empty',empty);$('#musicProgress').disabled=empty;$('#musicPrev').disabled=empty;$('#musicNext').disabled=empty;$('#musicPlay').disabled=empty;$('#musicVolume').disabled=empty;const current=$('#musicCurrent');current.textContent=track?.name||'尚未添加本地音乐';current.title=track?.name||'尚未添加本地音乐';current.setAttribute('aria-label',track?`当前歌曲：${track.name}`:'尚未添加本地音乐');$('#musicAdd').textContent=empty?'添加本地音乐':'添加音频';$('#musicPlay').textContent=track&&!audio.paused?'暂停':'播放';$('#musicVolume').value=String(state.music.volume??.8);updateMusicProgress();const list=$('#musicList');const listKey=JSON.stringify([musicIndex,tracks.map(item=>[item.id,item.name])]);if(listKey!==lastMusicListKey){lastMusicListKey=listKey;const scroll=list.scrollTop;list.replaceChildren();tracks.forEach((item,index)=>{const row=make('div',`music-item ${index===musicIndex?'active':''}`);const button=make('button','',item.name);button.type='button';button.title=item.name;button.dataset.musicIndex=String(index);const remove=make('button','', '×');remove.type='button';remove.title='仅移除歌单引用';remove.setAttribute('aria-label',`从歌单移除 ${item.name}，不会删除文件`);remove.dataset.musicRemove=String(index);row.append(button,remove);list.append(row);});list.scrollTop=scroll;}sendMusicState();}
async function chooseMusic(){if(editing){toast('请先保存或取消布局，再添加音频。');return;}const result=await window.homeApi.chooseAudioFiles();if(result.error){toast(result.error);return;}if(result.canceled)return;const before=clone(state.music);for(const file of result.files||[]){if(!state.music.tracks.some(item=>item.target===file.target))state.music.tracks.push({id:uid(),name:file.name,target:file.target});}try{if(await window.homeApi.saveConfig(clone(state))===false)throw new Error();toast(`已添加 ${result.files.length} 首音频；不会自动播放。`);renderMusic();}catch{state.music=before;toast('歌单保存失败，未改变原有配置。');}}
function playMusic(){const audio=$('#musicAudio');if(!musicTrack()){toast('请先添加音频。');return;}if(!audio.src){void setMusicSource(musicTrack(),true);return;}if(audio.paused)audio.play().catch(()=>{$('#musicStatus').textContent='音频无法播放或格式不支持。';});else audio.pause();sendMusicState();renderMusic();}
function stepMusic(delta){const tracks=state.music?.tracks||[];if(!tracks.length)return;musicIndex=(musicIndex+delta+tracks.length)%tracks.length;state.music.lastTrackId=tracks[musicIndex].id;state.music.lastTime=0;void setMusicSource(tracks[musicIndex],!$('#musicAudio').paused);}
function renderModules(){
  const tools=normalizeTools(state.tools);
  state.tools=tools;
  const showModules=tools.order.some(key=>tools.visible[key]);
  const card=$('#moduleCard');
  card.hidden=!showModules;
  card.classList.toggle('tools-hidden',!showModules);
  card.dataset.toolAccent=tools.accent;
  const visibleOrder=tools.order.filter(key=>tools.visible[key]);
  const timeIndex=visibleOrder.indexOf('time');
  const combined=timeIndex>=0&&visibleOrder[timeIndex+1]==='calendar';
  const stack=$('#moduleStack');
  stack.classList.toggle('date-time-combined',combined);
  for(const panel of $$('#moduleStack .module-panel')){
    const key=panel.dataset.module;
    panel.hidden=tools.visible[key]===false;
    panel.style.order=String(tools.order.indexOf(key)<0?99:tools.order.indexOf(key));
    panel.dataset.panelSize=tools.sizes[key]||'medium';
    panel.classList.toggle('is-combined-start',combined&&key==='time');
    panel.classList.toggle('is-combined-end',combined&&key==='calendar');
    if(key==='time')panel.classList.toggle('clock-large',tools.clockSize==='large');
    if(key==='calendar')panel.classList.toggle('calendar-compact',tools.calendarDensity==='compact');
    if(key==='music')panel.classList.toggle('is-collapsed',Boolean(tools.musicCollapsed));
  }
  const collapse=$('#musicCollapse');
  if(collapse){collapse.textContent=tools.musicCollapsed?'展开':'折叠';collapse.setAttribute('aria-expanded',String(!tools.musicCollapsed));}
  renderTimeModule();renderCalendar();renderMusic();
}
function renderModuleManager(){
  const sceneModules=normalizeModules(current().layout.modules,state.scene);
  const tools=normalizeTools(state.tools);
  const sceneLabels={tasks:'任务',apps:'常用入口',side:'项目与资料'};
  const toolLabels={time:'时间',calendar:'日历',music:'本地音乐'};
  const fillChecks=(host,labels,visible,sizes,prefix)=>{
    host.replaceChildren();
    Object.keys(labels).forEach(key=>{
      const label=make('label');
      const box=document.createElement('input');box.type='checkbox';box.dataset[`${prefix}Visible`]=key;box.checked=visible[key]!==false;
      const text=make('span','module-check-name',labels[key]);
      const size=document.createElement('select');size.dataset[`${prefix}Size`]=key;
      [['compact','小'],['medium','中'],['large','大']].forEach(([value,name])=>{const option=make('option','',name);option.value=value;size.append(option);});
      size.value=sizes[key]||'medium';label.append(box,text,size);host.append(label);
    });
  };
  fillChecks($('#moduleChecks'),sceneLabels,sceneModules.visible,sceneModules.sizes,'module');
  fillChecks($('#toolChecks'),toolLabels,tools.visible,tools.sizes,'tool');
  $('#toolAccent').value=tools.accent;
  $('#toolClockFormat').value=tools.clockFormat;
  $('#toolClockSize').value=tools.clockSize;
  $('#toolCalendarDensity').value=tools.calendarDensity;
  $('#toolMusicMode').value=tools.musicCollapsed?'compact':'expanded';
  const fillOrder=(select,order,labels)=>{select.replaceChildren();order.forEach(key=>{const option=make('option','',labels[key]||key);option.value=key;select.append(option);});if(select.options[0])select.options[0].selected=true;};
  fillOrder($('#moduleOrder'),sceneModules.order.filter(key=>Object.prototype.hasOwnProperty.call(sceneLabels,key)),sceneLabels);fillOrder($('#toolOrder'),tools.order,toolLabels);
}
function openModuleManager(){if(!editing){toast('请先进入编辑布局，再管理模块。');return;}renderModuleManager();$('#moduleDialog').showModal();}
function applyModuleManager(){
  const modules=normalizeModules(current().layout.modules,state.scene);
  const tools=normalizeTools(state.tools);
  $$('[data-module-visible]').forEach(box=>modules.visible[box.dataset.moduleVisible]=box.checked);
  $$('[data-module-size]').forEach(select=>modules.sizes[select.dataset.moduleSize]=select.value);
  modules.order=[...$('#moduleOrder').options].map(option=>option.value);
  $$('[data-tool-visible]').forEach(box=>tools.visible[box.dataset.toolVisible]=box.checked);
  $$('[data-tool-size]').forEach(select=>tools.sizes[select.dataset.toolSize]=select.value);
  tools.order=[...$('#toolOrder').options].map(option=>option.value);
  tools.accent=$('#toolAccent').value;
  tools.clockFormat=$('#toolClockFormat').value;
  tools.clockSize=$('#toolClockSize').value;
  tools.calendarDensity=$('#toolCalendarDensity').value;
  tools.musicCollapsed=$('#toolMusicMode').value==='compact';
  current().layout.modules=normalizeModules(modules,state.scene);state.tools=normalizeTools(tools);
  $('#moduleDialog').close();renderLayout();renderModules();toast('当前场景与共用工具区设置已加入布局草稿；点击保存布局后生效。');
}
function moveModule(delta){const select=$('#moduleOrder'),index=select.selectedIndex;if(index<0)return;const next=index+delta;if(next<0||next>=select.options.length)return;const option=select.options[index],other=select.options[next];if(delta<0)select.insertBefore(option,other);else select.insertBefore(other,option);select.selectedIndex=next;}
function moveTool(delta){const select=$('#toolOrder'),index=select.selectedIndex;if(index<0)return;const next=index+delta;if(next<0||next>=select.options.length)return;const option=select.options[index],other=select.options[next];if(delta<0)select.insertBefore(option,other);else select.insertBefore(other,option);select.selectedIndex=next;}
function resetToolManagerDraft(){
  if(!window.confirm('恢复全部五个场景共用工具的默认显示、顺序、尺寸和外观？这只更新当前布局草稿，不会清空歌单、音量或播放状态；保存布局后才会生效。'))return;
  const tools=toolDefaults();
  $$('[data-tool-visible]').forEach(box=>box.checked=tools.visible[box.dataset.toolVisible]!==false);
  $$('[data-tool-size]').forEach(select=>select.value=tools.sizes[select.dataset.toolSize]);
  $('#toolAccent').value=tools.accent;$('#toolClockFormat').value=tools.clockFormat;$('#toolClockSize').value=tools.clockSize;$('#toolCalendarDensity').value=tools.calendarDensity;$('#toolMusicMode').value=tools.musicCollapsed?'compact':'expanded';
  const labels={time:'时间',calendar:'日历',music:'本地音乐'},order=$('#toolOrder');order.replaceChildren();tools.order.forEach(key=>{const option=make('option','',labels[key]);option.value=key;order.append(option);});if(order.options[0])order.options[0].selected=true;
  toast('共用工具默认值已放入管理面板；请先“应用到布局”，再保存布局。');
}

function renderLayout(){
  const layout=current().layout;const map={tasks:'focus-tasks',apps:'focus-apps',side:'focus-side',normal:''};const workspace=$('#workspace');workspace.className=`workspace ${map[layout.focus]||''} ${layout.entryStyle==='compact'?'compact-entries':''} ${editing?'edit':''}`;const spacing={tight:8,comfortable:14,spacious:22}[layout.spacing]||14;const entrySize={small:{height:86,icon:30},medium:{height:106,icon:36},large:{height:126,icon:44}}[layout.entrySize]||{height:106,icon:36};workspace.style.setProperty('--workspace-gap',`${spacing}px`);workspace.style.setProperty('--entry-gap',`${Math.max(7,spacing-3)}px`);workspace.style.setProperty('--entry-height',`${entrySize.height}px`);workspace.style.setProperty('--entry-icon-size',`${entrySize.icon}px`);const heights={compact:350,medium:470,tall:620};$$('.card').forEach(card=>{card.draggable=editing;card.style.order=String(layout.order.indexOf(card.dataset.card));const mode=layout.heights[card.dataset.card]||'medium';card.classList.toggle('height-content',mode==='content');if(mode==='content')card.style.removeProperty('--card-height');else card.style.setProperty('--card-height',`${heights[mode]||470}px`);});$$('[data-layout-height]').forEach(select=>{select.value=layout.heights[select.dataset.layoutHeight]||'medium';select.disabled=!editing;});$$('[data-layout-setting]').forEach(select=>{select.value=layout[select.dataset.layoutSetting]||'comfortable';select.disabled=!editing;});$$('[data-view-toggle]').forEach(select=>{select.value=String(layout[select.dataset.viewToggle]!==false);select.disabled=!editing;});$('#appsSub').textContent=editing&&!layout.showUnsetEntries?'未设置入口在日常视图中隐藏；编辑时仍会显示':'本场景入口';$('#sideSub').textContent=editing?'右键已配置资料，可加入本场景常用入口':'由你选择并维护';$('#editBtn').textContent=editing?'保存布局':'编辑布局';$('#cleanLayoutBtn').hidden=!editing;$('#cancelEditBtn').hidden=!editing;$('#editHint').textContent=editing?'正在编辑：当前场景布局与共用工具外观。':'布局已锁定';
}
function syncTime(value){if(!value)return '';const date=new Date(value);if(Number.isNaN(date.valueOf()))return '';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
function renderStatus(){const source=didaDashboard?.source;const latest=syncTime(source==='cache'?didaDashboard?.lastSuccessfulAt||didaDashboard?.fetchedAt:didaDashboard?.lastSuccessfulAt);let text='滴答状态未知';if(dida.state==='authorizing')text='等待滴答授权';else if(dida.state==='expired')text=source==='cache'?'授权已过期 · 当前使用离线缓存':'授权已过期';else if(source==='live')text=`滴答已同步 · 最近成功同步 ${latest||'时间不可用'}`;else if(source==='partial')text=`部分同步 · ${Number(didaDashboard?.failedCount)||0} 个清单失败${latest?` · 上次完整同步 ${latest}`:''}`;else if(source==='cache')text=`离线缓存 · 最近成功同步 ${latest||'时间不可用'}`;else if(source==='error')text='同步失败 · 未显示缓存';else if(source==='none'||dida.state==='unconnected')text='滴答未连接';else if(refreshInFlight)text=`正在刷新${latest?` · 最近成功同步 ${latest}`:''}`;const details=[text];if(dida.state==='connected')details.push(dida.canComplete?'首页完成任务已启用。':'当前只读；如需打勾请点击“启用首页完成任务”。');if(dida.authorizationError)details.push(dida.authorizationError);const message=didaDashboard?.message||dida.message;if(message&&message!==text)details.push(message);if(didaDashboard?.projects)details.push(`读取到 ${didaDashboard.projects.length} 个清单。`);if(source==='partial'&&didaDashboard?.failedProjectIds?.length)details.push(`读取失败的清单 ID：${didaDashboard.failedProjectIds.join('、')}`);if(latest)details.push(`最近可确认的成功同步：${latest}`);$('#didaInfo').textContent=details.join(' ');}
function renderDidaMapping(){
  const host=$('#didaMapping');host.replaceChildren();
  const projects=didaDashboard?.projects||[];
  const mapping=settingsMappingDraft||state.didaListIds||{};
  $('#didaMappingRow').hidden=false;
  DIDA_GROUPS.forEach((group)=>{
    const label=make('label');label.append(document.createTextNode(`${group.label} `));
    const select=document.createElement('select');select.dataset.didaMap=group.key;
    select.append(make('option','','未关联'));select.options[0].value='';
    projects.forEach((project)=>{const option=make('option','',project.name);option.value=project.id;select.append(option);});
    const selected=mapping[group.key]||'';
    if(selected&&!projects.some((project)=>project.id===selected)){
      const option=make('option','','已保存关联 · 清单暂未读取到');option.value=selected;select.append(option);
    }
    select.value=selected;select.disabled=settingsSaving;
    select.onchange=()=>{if(settingsMappingDraft)settingsMappingDraft[group.key]=select.value;};
    label.append(select);host.append(label);
  });
}
function render(){ cancelAnimationFrame(searchRenderFrame);searchRenderFrame=0;renderAppearance();$('#hotkey').value=state.shortcut||''; renderScenes();renderLayout();renderTasks();renderApps();renderSide();renderStatus();renderDidaMapping(); }
const renderLayoutLegacy=renderLayout;
renderLayout=function(){
  renderLayoutLegacy();
  const modules=normalizeModules(current().layout.modules,state.scene);
  const tools=normalizeTools(state.tools);
  const showModules=Object.values(tools.visible).some(Boolean);
  $('#workspace').classList.toggle('no-shared-tools',!showModules);
  for(const card of $$('#workspace > .card')){
    if(card.dataset.card==='modules'){
      card.hidden=!showModules;card.draggable=false;card.style.order='2';card.classList.add('height-content');card.style.removeProperty('--card-height');
    }else if(['tasks','apps','side'].includes(card.dataset.card)){
      card.hidden=modules.visible[card.dataset.card]===false;
    }
  }
  $('#moduleManagerBtn').hidden=!editing;
  renderModules();
};
function startEdit(){ if(editing||layoutSaveInFlight)return;const startedAt=performance.now();editing=true;draft=clone(state);render();recordUiTiming('edit',startedAt); }
function setLayoutSaveUi(saving){document.body.classList.toggle('layout-saving',saving);for(const id of ['editBtn','cancelEditBtn','cleanLayoutBtn','moduleManagerBtn','themeBtn','settingsBtn','desktopModeBtn']){const node=$('#'+id);if(node)node.disabled=saving;}if(saving)$('#editBtn').textContent='正在保存…';}
async function stopEdit(save) {
  if(layoutSaveInFlight)return false;
  if(!save){const liveMusic=state.music;state=draft;state.music=liveMusic;toast('已取消本次布局编辑；当前音乐播放状态不受影响。');editing=false;draft=null;render();return true;}
  layoutSaveInFlight=true;
  renderLayout();
  setLayoutSaveUi(true);
  try {
    if(await window.homeApi.saveConfig(clone(state))===false)throw new Error('save failed');
  } catch {
    layoutSaveInFlight=false;
    renderLayout();
    setLayoutSaveUi(false);
    toast('保存失败，修改仍在编辑区中，请重试。');
    return false;
  }
  layoutSaveInFlight=false;
  setLayoutSaveUi(false);
  editing=false;draft=null;render();
  toast('布局和入口已保存。');
  return true;
}
function adjustHeight(card,value){if(!editing)return;current().layout.heights[card]=value;renderLayout();}
function previewCleanLayout(){if(layoutSaveInFlight)return;if(!editing)startEdit();const layout=current().layout;const modules=normalizeModules(layout.modules,state.scene);modules.visible.side=false;layout.modules=modules;layout.heights={...layout.heights,apps:'content'};render();toast(`已预览“${state.scene}”清爽布局：隐藏项目资料、常用入口随内容；保存后才会生效。`);}
function buildEntryDialog(target){ if(!editing)startEdit();editTarget=target;$('#entryError').textContent=''; const editingEntry=target.id?entry(target.id):null; $('#entryTitle').textContent=editingEntry?'编辑入口':'添加入口';$('#entrySharedNote').hidden=!editingEntry; const existing=$('#existing');existing.replaceChildren(make('option','',editingEntry?'编辑当前入口':'新建入口'));existing.options[0].value=''; Object.entries(state.library).sort((a,b)=>a[1].name.localeCompare(b[1].name,'zh-CN')).forEach(([id,item])=>{if(id===target.id)return;const option=make('option','',`${item.icon} ${item.name} · ${item.type}`);option.value=id;existing.append(option);}); $('#entryName').value=editingEntry?.name||target.initialName||'';$('#entryType').value=editingEntry?.type||(target.initialKind==='folder'?'资料':'软件');$('#entryIcon').value=editingEntry?.icon||(target.initialKind==='folder'?'📁':'⌘');$('#entryMode').value=editingEntry?.kind||target.initialKind||(editingEntry?.type==='网站'?'website':target.area==='side'?'file':'application');$('#entryTarget').value=editingEntry?.target||'';setTargetControls();const checks=$('#sceneChecks');checks.replaceChildren();SCENES.filter(scene=>scene!==state.scene).forEach(scene=>{const label=make('label');const box=document.createElement('input');box.type='checkbox';box.value=scene;label.append(box,document.createTextNode(scene));checks.append(label);});$('#entryDialog').showModal(); }
function selectExisting(){const id=$('#existing').value;if(!id)return;const item=entry(id);$('#entryName').value=item.name;$('#entryType').value=item.type;$('#entryIcon').value=item.icon;$('#entryMode').value=item.kind||'demo';$('#entryTarget').value=item.target||'';setTargetControls();}
async function chooseTarget() {
  const mode=$('#entryMode').value;
  if(!['application','file','folder'].includes(mode)){setTargetControls();return;}
  const button=$('#chooseTarget');button.disabled=true;
  $('#entryError').textContent='';
  try{
    if(!window.homeApi?.chooseLocalEntry)throw new Error();
    const result=await window.homeApi.chooseLocalEntry(mode);
    if(result.error){$('#entryError').textContent=result.error;return;}
    if(result.canceled)return;
    $('#entryTarget').value=result.target;
    if(!$('#entryName').value.trim())$('#entryName').value=result.target.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
    $('#targetHelp').textContent='已选择。先保存入口，再保存布局。';
  }catch{$('#entryError').textContent='选择窗口未能打开。请从托盘退出并重新启动本地首页后重试。';}
  finally{button.disabled=false;}
}
async function saveEntry(){ const name=$('#entryName').value.trim();const kind=$('#entryMode').value;let target=$('#entryTarget').value.trim();if(!name)return;$('#entryError').textContent='';if(kind==='demo'&&target){$('#entryError').textContent='已填写地址，请把入口方式改为本机应用、文件或网站。';return;}if(kind!=='demo'){
  try {
    const checked=await window.homeApi.validateEntry({kind,target});
    if(!checked.ok){$('#entryError').textContent=checked.error;return;}
    target=checked.target;
  }catch{$('#entryError').textContent='无法验证入口，请退出并重新启动本地首页后重试。';return;}
}let id=editTarget.id||$('#existing').value;if(id&&$('#existing').value&& !editTarget.id){ } else if(!id)id=uid(); const old=entry(id)||{}; const type=$('#entryType').value; const icon=kind==='folder'?'📁':$('#entryIcon').value; state.library[id]={...old,name,type,icon,kind,target:kind==='demo'?'':target,description:kind==='demo'?(old.description||`${type}演示入口`):`已连接${entryKindLabel(kind)}`}; const area=editTarget.area;const slots=current()[area];if(area==='apps'){if(!slots.includes(id))slots.push(id);}else if(!slots.some(([,entryId])=>entryId===id))slots.push([state.library[id].type,id]);$$('#sceneChecks input:checked').forEach(box=>{const sceneSlots=state.scenes[box.value][area];if(area==='apps'){if(!sceneSlots.includes(id))sceneSlots.push(id);}else if(!sceneSlots.some(([,entryId])=>entryId===id))sceneSlots.push([state.library[id].type,id]);});$('#entryDialog').close();$('#search').value='';renderApps();renderSide();toast('入口已更新；保存布局后会写入本机配置。'); }
function removeEntry(area,id){ const scene=current(); if(area==='apps')scene.apps=scene.apps.filter(value=>value!==id);else scene.side=scene.side.filter(([,value])=>value!==id);renderApps();renderSide();toast('已从当前场景移除入口；其他场景不受影响。'); }
async function saveSettings(){
  if(settingsSaving)return;
  settingsSaving=true;$('#settingsSave').disabled=true;
  const previousShortcut=state.shortcut;const shortcut=$('#hotkey').value.trim();
  const mapping=clone(settingsMappingDraft||state.didaListIds||{});renderDidaMapping();
  try{
    const result=await window.homeApi.setHotkey(shortcut);
    if(!result.ok){$('#hotkeyHelp').textContent=result.message;return;}
    const saved=clone(state);saved.shortcut=shortcut;saved.didaListIds=mapping;
    if(await window.homeApi.saveConfig(saved)===false)throw new Error('配置未写入');
    state.shortcut=shortcut;state.didaListIds=mapping;settingsMappingDraft=null;
    $('#settingsDialog').close();render();toast('设置与清单关联已保存。');
  }catch{
    await window.homeApi.setHotkey(previousShortcut).catch(()=>{});
    $('#hotkeyHelp').textContent='设置保存失败，关联选择尚未生效；请保留此窗口并重试。';
    toast('设置未保存，请重试。');
  }finally{settingsSaving=false;$('#settingsSave').disabled=false;renderDidaMapping();}
}
function inferDidaMapping(projects){state.didaListIds=state.didaListIds||{};let changed=false;DIDA_GROUPS.forEach((group)=>{if(Object.prototype.hasOwnProperty.call(state.didaListIds,group.key))return;const match=projects.find((project)=>project.name===group.label)||projects.find((project)=>project.name.includes(group.hint));if(match){state.didaListIds[group.key]=match.id;changed=true;}});return changed;}
function nextDidaRefreshDelay(){if(dida.state==='authorizing')return 5000;if(['unconnected','expired','none'].includes(dida.state))return null;if(didaFailureCount>0)return Math.min(300000,30000*Math.pow(2,Math.min(4,didaFailureCount-1)));return 300000;}
function scheduleDidaRefresh(){clearTimeout(didaPollTimer);didaPollTimer=null;if(document.hidden||refreshInFlight)return;const delay=nextDidaRefreshDelay();if(delay===null)return;const wait=Math.max(0,delay-(Date.now()-lastDidaAttemptAt));didaPollTimer=setTimeout(()=>{void refreshDidaStatus({silent:true});},wait);}
async function refreshDidaStatus({silent=false}={}){if(refreshInFlight)return;refreshInFlight=true;lastDidaAttemptAt=Date.now();if(!didaDashboard)dida={state:'loading',message:'正在读取滴答清单…'};const button=$('#didaRefresh');button.disabled=true;button.textContent='刷新中';if(!didaDashboard)renderTasks({preserveScroll:true});renderStatus();try{dida=await window.homeApi.didaStatus();applyDidaDashboard(await window.homeApi.didaDashboard());if(didaDashboard?.projects&&!editing&&!appearanceDraft&&!$('#settingsDialog').open&&inferDidaMapping(didaDashboard.projects))await persist();if(didaDashboard?.source==='live'){didaFailureCount=0;}else if(['partial','cache','error'].includes(didaDashboard?.source))didaFailureCount=Math.min(didaFailureCount+1,5);if(!silent&&didaDashboard?.source==='live')toast('滴答清单已刷新。');if(dida.authorizationError)toast(dida.authorizationError);}catch{dida={state:'error',message:'无法读取滴答清单连接状态。'};didaFailureCount=Math.min(didaFailureCount+1,5);}finally{refreshInFlight=false;button.disabled=false;button.textContent='刷新';renderTasks({preserveScroll:true});renderStatus();if($('#settingsDialog').open)renderDidaMapping();scheduleDidaRefresh();}}
async function load(){
  const loaded=await window.homeApi.loadConfig();
  restoreCalendarSession(await window.homeApi.calendarState?.());
  const needsTools=toolsNeedMigration(loaded?.config);
  state=normalizeConfigWithTools(loaded.config);
  if(needsTools){
    try{if(await window.homeApi.saveConfig(clone(state))===false)throw new Error('save failed');}
    catch{toast('共用右侧工具区迁移未能保存；本次运行仍可使用，稍后可重试。');}
  }
  if(loaded.recovered)toast('原配置无法读取，已安全恢复默认布局。');
  render();requestAnimationFrame(()=>window.homeApi.pageReady());
  const hotkey=await window.homeApi.setHotkey(state.shortcut);if(!hotkey.ok)toast('默认唤回快捷键不可用，请在设置中重新选择。');
  void refreshDidaStatus({silent:true});
}
async function activateEntry(id){
  const item=entry(id);if(!item)return;
  if(editing){toast('正在编辑布局：点铅笔修改入口；保存或取消布局后可点击打开。');return;}
  if(!hasEntryTarget(item)){toast('此入口尚未设置地址。请点“编辑布局”→入口右上角铅笔，选择地址并保存。');return;}
  toast('正在把启动请求交给 Windows…');
  try{const result=await window.homeApi.launchEntry({kind:item.kind,target:item.target});if(!result.ok)toast(result.error||'无法打开该入口。');else toast('Windows 已接受启动请求；目标应用窗口是否出现尚未核实。');}
  catch{toast('启动请求失败，请退出并重新启动本地首页后重试。');}
}
let contextEntry=null;
function closeEntryMenu(){const menu=$('#entryContextMenu');if(menu&&!menu.hidden)menu.hidden=true;contextEntry=null;}
function openEntryMenu(id,area,x,y){const item=entry(id);if(!item)return;contextEntry={id,area};const menu=$('#entryContextMenu');const isFolder=item.kind==='folder';$('#contextOpen').textContent=isFolder?'打开文件夹':'打开入口';$('#contextOpen').disabled=editing||!hasEntryTarget(item);$('#contextCopyPath').hidden=!isFolder;$('#contextReplaceFolder').hidden=!isFolder;const addToApps=$('#contextAddToApps');addToApps.hidden=area!=='side';addToApps.disabled=area!=='side'||current().apps.includes(id)||!hasEntryTarget(item);addToApps.title=!hasEntryTarget(item)?'请先设置有效地址':current().apps.includes(id)?'已在本场景常用入口中':'保留原资料引用，同时加入常用入口';const scenes=$('#contextScenes');scenes.replaceChildren();let available=0;SCENES.filter(scene=>scene!==state.scene).forEach(scene=>{const refs=state.scenes[scene][area];const included=area==='apps'?refs.includes(id):refs.some(([,entryId])=>entryId===id);if(included)return;available++;const button=make('button','context-item',`加入 ${scene}`);button.type='button';button.role='menuitem';button.dataset.contextScene=scene;scenes.append(button);});if(!available)scenes.append(make('div','context-empty','此入口已加入其他场景'));menu.hidden=false;const left=Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8));const top=Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8));menu.style.left=`${left}px`;menu.style.top=`${top}px`;menu.querySelector('button:not(:disabled)')?.focus();}
function addEntryToScene(sceneName,id,area){const item=entry(id);if(!item)return;const refs=state.scenes[sceneName][area];if(area==='apps'){if(!refs.includes(id))refs.push(id);}else if(!refs.some(([,entryId])=>entryId===id))refs.push([item.type,id]);}
async function contextAction(action){if(!contextEntry)return;const {id,area}=contextEntry;closeEntryMenu();if(action==='open'){if(!editing)activateEntry(id);return;}if(action==='copy-path'){if(editing){toast('请先保存布局，再复制已保存的文件夹路径。');return;}try{const result=await window.homeApi.copyEntryPath(id);toast(result.ok?'文件夹路径已复制。':result.error||'无法复制文件夹路径。');}catch{toast('无法复制文件夹路径，请重试。');}return;}if(action==='edit'||action==='replace-folder'){buildEntryDialog({area,id});return;}if(action==='add-to-apps'){const item=entry(id);if(area!=='side'||!item)return;if(!hasEntryTarget(item)){toast('请先为该资料入口设置有效地址。');return;}if(!editing)startEdit();if(!current().apps.includes(id))current().apps.push(id);renderApps();renderSide();toast('已加入本场景常用入口；原项目资料引用仍保留，保存布局后生效。');return;}if(action==='remove'){if(!editing)startEdit();removeEntry(area,id);toast('已从当前场景移除引用；其他场景及实际文件不受影响。保存布局后生效。');return;}}
function keyboardLaunch(event){if(event.key==='Escape'&&!$('#entryContextMenu').hidden){closeEntryMenu();return;}const entryNode=event.target.closest?.('[data-entry]');if(entryNode&&(event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey))){event.preventDefault();const rect=entryNode.getBoundingClientRect();openEntryMenu(entryNode.dataset.entry,entryNode.dataset.entryArea||'apps',rect.left,rect.bottom);return;}if(event.target.closest?.('button'))return;if(entryNode&&(event.key==='Enter'||event.key===' ')){event.preventDefault();activateEntry(entryNode.dataset.entry);}}
$('#sceneNav').addEventListener('click',async event=>{
  const button=event.target.closest('[data-scene]');
  if(!button||button.dataset.scene===state.scene)return;
  state.scene=button.dataset.scene;
  const startedAt=performance.now();render();recordUiTiming('scene',startedAt);
  // The main process serializes immutable config snapshots. Paint the selected
  // scene immediately; disk latency must not delay interaction feedback.
  if(!editing)try{await persist();}catch{toast('场景已切换，但保存失败；重新打开时可能恢复此前场景。');}
});
let searchRenderFrame=0;
$('#search').addEventListener('input',()=>{
  cancelAnimationFrame(searchRenderFrame);
  searchRenderFrame=requestAnimationFrame(()=>{searchRenderFrame=0;const startedAt=performance.now();renderApps();renderSide();recordUiTiming('search',startedAt);});
});
$('#editBtn').addEventListener('click',()=>editing?stopEdit(true):startEdit());
$('#cancelEditBtn').addEventListener('click',()=>stopEdit(false));
function openAppearance(){appearanceDraft=clone({theme:state.theme,appearance:state.appearance});renderAppearance();$('#themeDialog').showModal();}
async function closeAppearance(save){if(!appearanceDraft){$('#themeDialog').close();return true;}if(save){const snapshot=clone(editing&&draft?draft:state);snapshot.theme=state.theme;snapshot.appearance=clone(state.appearance);try{if(await window.homeApi.saveConfig(snapshot)===false)throw new Error('save failed');}catch{toast('外观保存失败，请重试。');return false;}if(editing&&draft){draft.theme=state.theme;draft.appearance=clone(state.appearance);}toast('外观已保存。');}else{state.theme=appearanceDraft.theme;state.appearance=appearanceDraft.appearance;render();}appearanceDraft=null;$('#themeDialog').close();return true;}
function hasPendingChanges(){return editing||Boolean(appearanceDraft);}
async function completeTransition(choice){
  if(!pendingTransition||transitionRunning)return;
  if(choice==='stay'){pendingTransition=null;$('#transitionDialog').close();return;}
  if($('#entryDialog').open||$('#settingsDialog').open){toast('请先保存或关闭当前入口/设置窗口，再切换首页模式。');pendingTransition=null;$('#transitionDialog').close();return;}
  transitionRunning=true;
  const action=pendingTransition;
  try{
    if(choice==='save'){
      if(appearanceDraft&&!await closeAppearance(true))return;
      if(editing&&!await stopEdit(true))return;
    }else{
      if(appearanceDraft)await closeAppearance(false);
      if(editing)await stopEdit(false);
    }
    pendingTransition=null;
    $('#transitionDialog').close();
    const result=await window.homeApi.performTransition(action);
    if(!result?.ok)toast(result?.error||'切换未完成；普通首页仍可从托盘打开。');
  }catch{toast('切换失败；当前配置和 Windows 桌面仍保持不变。');}
  finally{transitionRunning=false;}
}
function requestPageTransition(action){
  if(taskCompletionPending.size){toast('任务正在同步完成，请等结果返回后再切换窗口或退出。');return;}
  if($('#taskPermissionDialog').open||$('#taskCompleteConfirmDialog').open){toast('请先关闭任务操作窗口。');return;}
  if($('#entryDialog').open||$('#settingsDialog').open){toast('请先保存或关闭当前入口/设置窗口，再切换首页模式。');return;}
  if(hasPendingChanges()){
    pendingTransition=action;
    if(!$('#transitionDialog').open)$('#transitionDialog').showModal();
    return;
  }
  pendingTransition=action;
  void completeTransition('save');
}
function previewAppearance(){state.theme=$('#theme').value;state.appearance={...state.appearance,glass:$('#glass').value,renderQuality:$('#renderQuality').value,dim:Number($('#wallpaperDim').value),fit:$('#wallpaperFit').value,position:$('#wallpaperPosition').value};renderAppearance();}
async function chooseWallpaper(){const result=await window.homeApi.chooseWallpaper();if(result.error){toast(result.error);return;}if(result.canceled)return;state.appearance={...state.appearance,wallpaper:result.target};renderAppearance();}
let startupSystemStatus=null;
let startupApplyInFlight=false;
function startupStatusText(status){if(!status?.supported)return '此功能仅适用于 Windows。';if(status.state==='unknown'||status.error&&status.registered===null)return `状态未知：${status.error||'无法读取 Windows 启动项。'}`;if(status.commandMismatch)return '发现同名个人首页启动项，但程序路径或参数与当前版本不一致。';if(status.disabledByWindows)return '启动项已注册，但 Windows 当前已禁用它。个人首页不会自动重新启用；如需重新开启，请关闭并应用后再明确开启。';return status.registered?'登录启动已开启。':'登录启动未开启。';}
async function loadStartupSettings(){try{const status=await window.homeApi.startupSettings();startupSystemStatus=status;const unknown=status.state==='unknown'||status.registered===null;$('#startupEnabled').checked=status.registered===true;$('#startupEnabled').indeterminate=unknown;$('#startupMode').value=status.preferences?.mode||'window';$('#startupDelay').value=String(status.preferences?.delayMs||0);$('#startupEnabled').disabled=!status.supported||unknown;$('#startupStatus').textContent=startupStatusText(status);return status;}catch{startupSystemStatus={supported:true,state:'unknown',registered:null,error:'读取 Windows 状态失败。'};$('#startupEnabled').checked=false;$('#startupEnabled').indeterminate=true;$('#startupEnabled').disabled=true;$('#startupStatus').textContent=startupStatusText(startupSystemStatus);return null;}}
function markStartupPreferencesPending(){if(startupApplyInFlight)return;$('#startupStatus').textContent=`当前系统状态：${startupStatusText(startupSystemStatus)} 本页选择尚未应用。`;}
async function refreshAbout(){try{const about=await window.homeApi.about();const memory=about.metrics.filter((item)=>Number.isFinite(item.memoryMB)).reduce((sum,item)=>sum+item.memoryMB,0);const cpu=about.metrics.filter((item)=>Number.isFinite(item.cpuPercent)).reduce((sum,item)=>sum+item.cpuPercent,0);const lines=[`版本：${about.version}`,`构建标识：${about.buildId}`,`应用目录：${about.appPath}`,`当前工作目录：${about.workingDirectory}`,`程序路径：${about.executablePath}`,`主进程启动至本地页面可操作：${about.localPageReadyMs??'—'} ms（不含滴答首次读取和桌面挂载）`,`滴答面板读取耗时：${about.firstDidaDashboardDurationMs??'—'} ms（首次）· ${about.lastDidaDashboardDurationMs??'—'} ms（最近）`,`桌面宿主连接尝试耗时：${about.desktopAttachDurationMs??'—'} ms`,`当前已运行：${about.runningForSeconds} 秒`,`桌面层连接状态：${about.desktopAttached?'已连接':'未连接或尚未完成连接'}`,`当前 Electron 进程快照：约 ${memory} MB，CPU ${cpu.toFixed(1)}%（CPU 为上次查询至本次查询的区间值，资源快照不代表稳定空闲平均）`,`页面同步处理耗时：场景 ${uiTimings.scene??'—'} ms · 搜索 ${uiTimings.search??'—'} ms · 编辑 ${uiTimings.edit??'—'} ms（不含下一帧绘制）`];$('#aboutInfo').textContent=lines.join('\n');}catch{$('#aboutInfo').textContent='暂时无法读取版本信息。';}}
const startupAccess=make('button','btn','登录启动与版本信息');startupAccess.id='startupSettingsBtn';startupAccess.type='button';startupAccess.onclick=async()=>{$('#startupDialog').showModal();await Promise.all([loadStartupSettings(),refreshAbout()]);};$('#settingsDialog .modal').insertBefore(startupAccess,$('#settingsDialog .modal-actions'));
$('#startupApply').onclick=async()=>{if(startupApplyInFlight)return;const button=$('#startupApply');startupApplyInFlight=true;button.disabled=true;$('#startupEnabled').disabled=true;$('#startupMode').disabled=true;$('#startupDelay').disabled=true;$('#startupStatus').textContent='正在向 Windows 核实并更新本软件的启动项…';try{const result=await window.homeApi.saveStartupSettings({enabled:$('#startupEnabled').checked,mode:$('#startupMode').value,delayMs:Number($('#startupDelay').value)});startupSystemStatus=result;$('#startupEnabled').checked=result.registered===true;$('#startupEnabled').indeterminate=result.state==='unknown'||result.registered===null;$('#startupMode').value=result.preferences?.mode||'window';$('#startupDelay').value=String(result.preferences?.delayMs||0);$('#startupStatus').textContent=result.error||startupStatusText(result);if(result.ok)toast(result.registered?(result.disabledByWindows?'启动项仍由 Windows 禁用。':'登录启动设置已核实保存。'):'登录启动已关闭。');}catch{await loadStartupSettings();$('#startupStatus').textContent=`本地偏好或 Windows 启动项保存失败；实际状态：${startupStatusText(startupSystemStatus)}`;}finally{startupApplyInFlight=false;button.disabled=false;$('#startupEnabled').disabled=!startupSystemStatus?.supported||startupSystemStatus?.state==='unknown'||startupSystemStatus?.registered===null;$('#startupMode').disabled=false;$('#startupDelay').disabled=false;}};$('#startupEnabled').addEventListener('change',markStartupPreferencesPending);$('#startupMode').addEventListener('change',markStartupPreferencesPending);$('#startupDelay').addEventListener('change',markStartupPreferencesPending);$('#aboutRefresh').onclick=refreshAbout;
$('#themeBtn').onclick=openAppearance;$('#settingsBtn').onclick=()=>{if(editing){toast('请先保存或取消布局编辑，再打开设置。');return;}settingsMappingDraft=clone(state.didaListIds||{});$('#hotkey').value=state.shortcut||'';renderDidaMapping();$('#settingsDialog').showModal();};$('#hideBtn').onclick=()=>{$('#modeInfoDialog').close();window.homeApi.hide();};
$('#settingsDialog').addEventListener('close',()=>{if(!$('#settingsDialog').open)settingsMappingDraft=null;});
$('#settingsDialog').addEventListener('cancel',event=>{if(settingsSaving)event.preventDefault();});
const desktopTrialButton=make('button','btn','桌面首页');desktopTrialButton.id='desktopModeBtn';desktopTrialButton.type='button';desktopTrialButton.title='将个人首页显示在 Windows 桌面层';$('.actions').insertBefore(desktopTrialButton,$('#cancelEditBtn'));
if(desktopMode){document.body.classList.add('desktop-home');document.title='个人首页 · 桌面层试验';$('#appBanner').textContent='桌面模式';desktopTrialButton.textContent='返回普通窗口';desktopTrialButton.title='恢复原窗口关系并打开普通首页';$('#hideBtn').hidden=true;}
desktopTrialButton.onclick=()=>requestPageTransition(desktopMode?'return-home':'enter-desktop');
window.homeApi.onDesktopTrialAttached((status)=>{if(status?.ok){const banner=$('#appBanner');if(banner)banner.textContent='桌面模式';}});
$('#appBanner').addEventListener('click',()=>{const heading=$('#modeInfoHeading');const text=$('#modeInfoText');heading.textContent=desktopMode?'桌面层试验':'普通本地窗口';text.textContent=desktopMode?'当前首页正作为可退出的桌面层试验窗口显示；点击“返回普通窗口”可恢复普通窗口并打开首页，点击“结束桌面试验”可恢复原桌面关系并结束试验。它没有替换 Windows 系统外壳。':'当前是普通本地应用窗口。点击顶部“桌面首页”可进入可退出的桌面层试验；登录自启动可在设置中另行选择普通窗口或桌面首页。它不是 Windows 系统外壳替换。';$('#modeReturnBtn').hidden=!desktopMode;$('#modeEndTrialBtn').hidden=!desktopMode;$('#modeInfoDialog').showModal();});
$('#modeReturnBtn').onclick=()=>{$('#modeInfoDialog').close();requestPageTransition('return-home');};$('#modeEndTrialBtn').onclick=()=>{$('#modeInfoDialog').close();requestPageTransition('end-trial');};
window.homeApi.onRequestTransition((action)=>requestPageTransition(action));
window.homeApi.onNotice((message)=>toast(message));
$('#transitionSave').onclick=()=>completeTransition('save');$('#transitionDiscard').onclick=()=>completeTransition('discard');$('#transitionStay').onclick=()=>completeTransition('stay');
$('#transitionDialog').addEventListener('cancel',event=>{event.preventDefault();completeTransition('stay');});
$$('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());['theme','glass','renderQuality','wallpaperDim','wallpaperFit','wallpaperPosition'].forEach(id=>$('#'+id).oninput=previewAppearance);$('#wallpaperChoose').onclick=chooseWallpaper;$('#wallpaperClear').onclick=()=>{state.appearance={...state.appearance,wallpaper:''};renderAppearance();};$('#appearanceCancel').onclick=()=>closeAppearance(false);$('#appearanceSave').onclick=()=>closeAppearance(true);
$('#themeDialog').addEventListener('cancel',event=>{event.preventDefault();closeAppearance(false);});
$('#entryForm').addEventListener('submit',event=>{event.preventDefault();saveEntry();});$('#existing').onchange=selectExisting;$('#entryMode').onchange=setTargetControls;$('#chooseTarget').onclick=chooseTarget;
$('#didaConnect').onclick=async()=>{const result=await window.homeApi.connectDida();if(result.started)toast('已打开浏览器，请完成授权。');else toast(result.message||'无法开始授权。');await refreshDidaStatus({silent:true});};
$('#didaDisconnect').onclick=async()=>{const result=await window.homeApi.disconnectDida();if(result?.ok===false){toast(result.message);return;}didaDashboard=null;await refreshDidaStatus({silent:true});toast('已删除本机滴答清单授权与缓存。');};$('#didaRefresh').onclick=()=>refreshDidaStatus();
$('#didaEnableCompletion').onclick=openCompletionPermission;
$('#taskPermissionCancel').onclick=()=>$('#taskPermissionDialog').close();
$('#taskPermissionApply').onclick=async()=>{const button=$('#taskPermissionApply');if(button.disabled)return;button.disabled=true;$('#taskPermissionResult').textContent='正在打开授权页面…';try{const result=await window.homeApi.connectDida(true);$('#taskPermissionResult').textContent=result.started?'已打开浏览器，请明确授予读取与写入权限。授权后回到首页点击刷新；不会自动完成任何任务。':result.message||'授权未开始。';await refreshDidaStatus({silent:true});}catch{$('#taskPermissionResult').textContent='无法开始授权，原有授权仍保留。';}finally{button.disabled=false;}};
$('#taskCompleteCancel').onclick=()=>{completionConfirmTask=null;$('#taskCompleteConfirmDialog').close();};
$('#taskCompleteApply').onclick=()=>{const task=completionConfirmTask;completionConfirmTask=null;$('#taskCompleteConfirmDialog').close();if(task)void submitTaskCompletion(task);};
$('#taskRange').onchange=()=>saveTaskView({range:$('#taskRange').value});$('#taskDates').onchange=()=>saveTaskView({dates:$('#taskDates').value});$('#inboxProject').onchange=()=>saveTaskView({inboxProjectId:$('#inboxProject').value});
document.addEventListener('click',event=>{const contextActionButton=event.target.closest('[data-context-action]');if(contextActionButton){contextAction(contextActionButton.dataset.contextAction);return;}const contextSceneButton=event.target.closest('[data-context-scene]');if(contextSceneButton&&contextEntry){const {id,area}=contextEntry;const sceneName=contextSceneButton.dataset.contextScene;closeEntryMenu();if(!editing)startEdit();addEntryToScene(sceneName,id,area);renderApps();renderSide();toast(`已加入 ${sceneName}；保存布局后生效。`);return;}const editLayout=event.target.closest('[data-edit-layout]');if(editLayout){if(!editing)startEdit();return;}const add=event.target.closest('[data-add]');if(add){buildEntryDialog({area:add.dataset.add,id:null});return;}const edit=event.target.closest('[data-edit]');if(edit){buildEntryDialog({area:edit.dataset.edit,id:edit.dataset.entry});return;}const remove=event.target.closest('[data-remove]');if(remove){if(!editing)startEdit();removeEntry(remove.dataset.remove,remove.dataset.entry);return;}const launch=event.target.closest('[data-entry]');if(launch&&!event.target.closest('.remove')&&!event.target.closest('.edit-item'))activateEntry(launch.dataset.entry);});document.addEventListener('change',event=>{const height=event.target.closest('[data-layout-height]');if(height)adjustHeight(height.dataset.layoutHeight,height.value);const setting=event.target.closest('[data-layout-setting]');if(setting&&editing){current().layout[setting.dataset.layoutSetting]=setting.value;renderLayout();}const view=event.target.closest('[data-view-toggle]');if(view&&editing){current().layout[view.dataset.viewToggle]=view.value==='true';renderLayout();renderApps();renderSide();}});document.addEventListener('pointerdown',event=>{if(!event.target.closest('#entryContextMenu'))closeEntryMenu();});document.addEventListener('keydown',keyboardLaunch);$('#workspace').addEventListener('contextmenu',event=>{const node=event.target.closest('[data-entry]');if(!node)return;event.preventDefault();openEntryMenu(node.dataset.entry,node.dataset.entryArea||'apps',event.clientX,event.clientY);});$('#tasks').addEventListener('toggle',event=>{const detail=event.target;if(detail.matches?.('details.task-group')){const title=detail.dataset.groupTitle;if(!detail.open)collapsedTaskGroups.add(title);else collapsedTaskGroups.delete(title);}},true);$('#tasks').addEventListener('change',event=>{if(event.target.dataset.task)toast('已更新示例任务状态；未同步到滴答清单。');});
let appDrag=null;$('#appGrid').addEventListener('dragstart',event=>{const node=event.target.closest('.entry');if(!editing||!node||event.target.closest('button'))return;if($('#search').value.trim()){toast('请先清空搜索，再调整入口顺序。');return;}appDrag=Number(node.dataset.index);});$('#appGrid').addEventListener('dragover',event=>{if(editing)event.preventDefault();});$('#appGrid').addEventListener('drop',event=>{event.preventDefault();const node=event.target.closest('.entry');if(!editing||appDrag===null||!node)return;const to=Number(node.dataset.index);const ids=current().apps;ids.splice(to,0,ids.splice(appDrag,1)[0]);appDrag=null;renderApps();toast('入口顺序已调整。');});
let sideDrag=null;$('#sideEntries').addEventListener('dragstart',event=>{const node=event.target.closest('.side-entry');if(!editing||!node||event.target.closest('button'))return;if($('#search').value.trim()){toast('请先清空搜索，再调整入口顺序。');return;}sideDrag=Number(node.dataset.index);});$('#sideEntries').addEventListener('dragover',event=>{if(editing)event.preventDefault();});$('#sideEntries').addEventListener('drop',event=>{event.preventDefault();const node=event.target.closest('.side-entry');if(!editing||sideDrag===null||!node)return;const to=Number(node.dataset.index);const refs=current().side;refs.splice(to,0,refs.splice(sideDrag,1)[0]);sideDrag=null;renderSide();toast('项目与资料入口顺序已调整。');});
let cardDrag=null;$('#workspace').addEventListener('dragstart',event=>{const card=event.target.closest('.card');if(!editing||!card||event.target.closest('.entry'))return;cardDrag=card.dataset.card;});$('#workspace').addEventListener('dragover',event=>{if(editing)event.preventDefault();});$('#workspace').addEventListener('drop',event=>{const card=event.target.closest('.card');if(!editing||!cardDrag||!card||cardDrag===card.dataset.card)return;const order=current().layout.order;order.splice(order.indexOf(card.dataset.card),0,order.splice(order.indexOf(cardDrag),1)[0]);cardDrag=null;renderLayout();toast('卡片位置已调整。');});
$('#backupBtn').onclick=async()=>{const result=await window.homeApi.backupConfig(state);if(result.error){toast(result.error);return;}if(!result.canceled)toast('配置备份已完成。');};$('#restoreBtn').onclick=async()=>{const result=await window.homeApi.restoreConfig();if(result.error){toast(result.error);return;}if(!result.canceled){state=normalizeConfigWithTools(result.config);await persist();$('#settingsDialog').close();render();toast('配置已恢复。');}};$('#resetBtn').onclick=async()=>{if(!window.confirm(`仅恢复“${state.scene}”场景的卡片顺序、高度、模块显隐、入口大小/样式、间距和未设置入口显示偏好？入口本身、共用右侧工具、壁纸、主题、滴答关联/授权及其他场景不会改变。`))return;current().layout=clone(defaults.scenes[state.scene].layout);await persist();$('#settingsDialog').close();render();toast('当前场景布局已恢复默认；共用工具和其他设置未改变。');};$('#settingsSave').onclick=saveSettings;
let clockTimer=null,lastTaskDayKey=todayKey();function refreshTaskDayIfNeeded(){const currentDay=todayKey();if(currentDay===lastTaskDayKey)return false;lastTaskDayKey=currentDay;renderTasks({preserveScroll:true});return true;}function scheduleClock(){clearTimeout(clockTimer);clockTimer=null;if(document.hidden)return;dateText();renderCalendar();refreshTaskDayIfNeeded();clockTimer=setTimeout(scheduleClock,60000);}document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(clockTimer);clockTimer=null;clearTimeout(didaPollTimer);didaPollTimer=null;}else{scheduleClock();updateMusicProgress();scheduleDidaRefresh();}});window.addEventListener('focus',scheduleClock);window.homeApi.onCalendarCheck?.(scheduleClock);document.addEventListener('click',event=>{const button=event.target.closest?.('[data-add-folder]');if(button){buildEntryDialog({area:button.dataset.addFolder,id:null,initialKind:'folder',initialName:'文件中转站'});}});scheduleClock();load();
$('#moduleManagerBtn').onclick=openModuleManager;$('#moduleCancel').onclick=()=>$('#moduleDialog').close();$('#moduleSave').onclick=applyModuleManager;$('#moduleUp').onclick=()=>moveModule(-1);$('#moduleDown').onclick=()=>moveModule(1);$('#toolUp').onclick=()=>moveTool(-1);$('#toolDown').onclick=()=>moveTool(1);$('#toolReset').onclick=resetToolManagerDraft;
$('#cleanLayoutBtn').onclick=previewCleanLayout;
document.addEventListener('click',event=>{const nav=event.target.closest?.('[data-calendar-nav]');if(nav){if(nav.dataset.calendarNav==='today')followCalendarToday();else browseCalendarMonth(nav.dataset.calendarNav==='next'?1:-1);return;}const day=event.target.closest?.('[data-calendar-day]');if(day){selectCalendarDay(day.dataset.calendarDay,true);return;}const trackButton=event.target.closest?.('[data-music-index]');if(trackButton){musicIndex=Number(trackButton.dataset.musicIndex);state.music.lastTrackId=musicTrack()?.id||'';void setMusicSource(musicTrack(),true);return;}const remove=event.target.closest?.('[data-music-remove]');if(remove){const index=Number(remove.dataset.musicRemove);const was=musicIndex===index;state.music.tracks.splice(index,1);if(was){$('#musicAudio').pause();musicIndex=Math.min(index,state.music.tracks.length-1);if(musicTrack())void setMusicSource(musicTrack(),false);}else if(musicIndex>index)musicIndex--;void window.homeApi.saveConfig(clone(state));renderMusic();return;}});
document.addEventListener('keydown',event=>{const day=event.target.closest?.('[data-calendar-day]');if(!day||!['Enter',' '].includes(event.key))return;event.preventDefault();selectCalendarDay(day.dataset.calendarDay,true);});
$('#musicAdd').onclick=chooseMusic;$('#musicPlay').onclick=playMusic;$('#musicPrev').onclick=()=>stepMusic(-1);$('#musicNext').onclick=()=>stepMusic(1);$('#musicProgress').oninput=event=>{const audio=$('#musicAudio');if(audio.duration)audio.currentTime=audio.duration*(Number(event.target.value)/100);};$('#musicVolume').oninput=event=>{state.music.volume=Number(event.target.value);$('#musicAudio').volume=state.music.volume;clearTimeout(musicSaveTimer);musicSaveTimer=setTimeout(()=>{if(!editing)void window.homeApi.saveConfig(clone(state));},500);};$('#musicAudio').addEventListener('timeupdate',()=>{const audio=$('#musicAudio'),track=musicTrack();if(track){state.music.lastTrackId=track.id;state.music.lastTime=audio.currentTime;}updateMusicProgress();});$('#musicAudio').addEventListener('ended',()=>{if(musicIndex<state.music.tracks.length-1)stepMusic(1);else{state.music.lastTime=0;renderMusic();}});$('#musicAudio').addEventListener('play',()=>{sendMusicState();renderMusic();});$('#musicAudio').addEventListener('pause',()=>{sendMusicState();renderMusic();});window.homeApi.onMusicCommand?.(command=>{if(command==='play')playMusic();else if(command==='pause'){$('#musicAudio').pause();sendMusicState();}});
$('#musicCollapse').onclick=()=>{if(!editing)startEdit();state.tools=normalizeTools(state.tools);state.tools.musicCollapsed=!state.tools.musicCollapsed;renderModules();toast('共用音乐折叠设置已加入布局草稿；点击保存布局后生效。');};
