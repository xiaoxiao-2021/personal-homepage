'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Node {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this.open = false; this.value = ''; this._text = ''; }
  append(...items) { this.children.push(...items); }
  setAttribute(name,value) { this[name]=value; }
  replaceChildren(...items) { this.children = [...items]; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent ?? String(child)).join(''); }
}

const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer.js'), 'utf8');
const setup = source.slice(0, source.indexOf('const taskData ='));
const groups = source.match(/const DIDA_GROUPS = \[[\s\S]*?\n\];/)?.[0];
const configFns = source.match(/function validConfig\(config\)[\s\S]*?(?=function current\()/)?.[0];
const sceneFns = source.match(/function current\(\)[\s\S]*?(?=function entryKindLabel\()/)?.[0];
const taskFns = source.match(/function dateKey\(value, allDay\)[\s\S]*?(?=const iconCache=)/)?.[0];
const statusFns = source.match(/function syncTime\(value\)[\s\S]*?(?=function renderDidaMapping\()/)?.[0];
const entryFns = source.match(/function entry\(id\)[\s\S]*?(?=function renderLayout\()/)?.[0];
assert.ok(groups && configFns && sceneFns && taskFns && statusFns && entryFns, 'renderer config, task, scene and entry helpers are present');

const nodes = { '#tasks': new Node(), '#taskSource': new Node(), '#taskCardTitle': new Node(), '#taskRange': new Node('select'), '#taskDates': new Node('select'), '#inboxProject': new Node('select'), '#status': new Node(), '#statusText': new Node(), '#didaInfo': new Node() };
const document = {
  querySelector: (selector) => nodes[selector],
  createElement: (tag) => new Node(tag),
  createTextNode: (text) => ({ textContent: String(text) })
};
const testHomeApi = { failSave:false, saved:null, async saveConfig(config) { if(this.failSave)throw new Error('synthetic config save failure');this.saved=JSON.parse(JSON.stringify(config));return true; } };
const context = { URLSearchParams, location: { search: '' }, Math, JSON, Date, Intl, Number, Set, Map, document, $: (selector) => nodes[selector], HomeTaskView: require('../src/task-view.js'), window:{homeApi:testHomeApi} };
vm.createContext(context);
vm.runInContext(`${setup}\nlet state=clone(defaults);state.taskView.dates='today';let editing=false;let didaDashboard=null;let dida={state:'unconnected'};let refreshInFlight=false;const taskCompletionPending=new Set();const taskCompletionErrors=new Map();const collapsedTaskGroups=new Set();function toast(message){globalThis.lastToast=message;}\n${configFns}\n${groups}\n${sceneFns}\n${taskFns}\n${statusFns}\n${entryFns}`, context);

const today = vm.runInContext('todayKey()', context);
const migrated = vm.runInContext(`(()=>{const old=clone(defaults);delete old.taskView;old.didaListIds={clinical:'preserved-list-id'};old.scenes['总览'].layout.heights.tasks='tall';return normalize(old)})()`, context);
assert.equal(migrated.taskView.dates,'all','legacy config defaults to all dates');
assert.equal(migrated.didaListIds.clinical,'preserved-list-id','legacy list association survives task view migration');
assert.equal(migrated.scenes['总览'].layout.heights.tasks,'tall','legacy layout setting survives task view migration');
vm.runInContext(`
  state.didaListIds={clinical:'c',research:'r',study:'s',life:'l'};
  dida={state:'connected'};
  didaDashboard={source:'live',projects:[{id:'c',name:'临床'},{id:'r',name:'科研'},{id:'s',name:'学习'},{id:'l',name:'生活'}],tasks:[]};
  state.scene='总览';renderTasks();
`, context);
assert.equal(nodes['#tasks'].children.filter((node) => node.className.includes('empty-group')).length, 4);
assert.equal(nodes['#tasks'].textContent.match(/今天暂无任务/g)?.length, 4);
assert.equal(nodes['#taskSource'].textContent, '全部已读清单 · 已同步');
vm.runInContext(`state.scene='🏠 生活';state.taskViews['🏠 生活']={range:'scene',dates:'all',inboxProjectId:''};state.didaListIds.life='l';`, context);
assert.deepEqual(JSON.parse(vm.runInContext(`JSON.stringify(taskProjectsForView([{id:'c',name:'临床清单'},{id:'l',name:'生活清单'}]))`, context)), ['l'], 'scene task scope uses the current scene list');
vm.runInContext(`state.scene='总览';state.taskView={range:'scene',dates:'all',inboxProjectId:''};`, context);
vm.runInContext(`
  const yesterday=new Date('${today}T12:00:00+08:00');yesterday.setDate(yesterday.getDate()-1);
  didaDashboard.tasks=[{id:'overdue',title:'逾期样例',projectId:'c',dueDate:yesterday.toISOString().slice(0,10),isAllDay:true,status:0}];renderTasks();
`, context);
assert.match(nodes['#tasks'].textContent, /逾期/);
assert.match(nodes['#tasks'].textContent, /临床/);
vm.runInContext(`didaDashboard.tasks=[];renderTasks()`, context);

vm.runInContext(`
  const shift=(offset)=>{const date=new Date('${today}T12:00:00+08:00');date.setDate(date.getDate()+offset);return date.toISOString().slice(0,10)};
  state.scene='总览';state.taskView={range:'scene',dates:'all',inboxProjectId:''};state.didaListIds={clinical:'c',research:'r',study:'s',life:'l'};
  didaDashboard={source:'live',projects:[{id:'c',name:'临床清单'},{id:'r',name:'科研清单'},{id:'i',name:'任意名称'}],tasks:[
    {id:'late',title:'昨天逾期',projectId:'c',dueDate:shift(-1),isAllDay:true,status:0},
    {id:'today-all',title:'今天全天',projectId:'r',dueDate:shift(0),isAllDay:true,status:0},
    {id:'today-time',title:'今天定时',projectId:'c',dueDate:'${today}T09:00:00+08:00',isAllDay:false,status:0},
    {id:'tomorrow',title:'明天报到',projectId:'i',dueDate:shift(1),isAllDay:true,status:0},
    {id:'start-only',title:'过去开始任务',projectId:'c',startDate:shift(-2),isAllDay:true,status:0},
    {id:'bad',title:'坏日期',projectId:'r',dueDate:'bad-date',status:0},
    {id:'undated',title:'未设日期任务',projectId:'r',status:0},
    {id:'done',title:'已完成任务',projectId:'c',dueDate:shift(1),status:2}
  ]};renderTasks();
  globalThis.startOnlyRow=taskView({id:'start-only',title:'过去开始任务',projectId:'c',startDate:shift(-2),isAllDay:true,status:0},new Map([['c','临床清单']]));
`, context);
const allDateText = nodes['#tasks'].textContent;
assert.ok(allDateText.indexOf('昨天逾期') < allDateText.indexOf('今天全天') && allDateText.indexOf('今天全天') < allDateText.indexOf('今天定时') && allDateText.indexOf('今天定时') < allDateText.indexOf('明天报到'));
assert.ok(allDateText.indexOf('日期待确认') < allDateText.indexOf('未设日期'));
assert.match(allDateText, /逾期/);
assert.match(allDateText, /临床清单/);
assert.match(allDateText, /科研清单/);
assert.doesNotMatch(allDateText, /已完成任务/);
assert.match(context.startOnlyRow.textContent, /开始于/);
assert.doesNotMatch(context.startOnlyRow.textContent, /逾期/);
vm.runInContext(`state.scene='🏥 临床';state.taskViews['🏥 临床']={range:'scene',dates:'all',inboxProjectId:''};renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /今天定时/);
assert.doesNotMatch(nodes['#tasks'].textContent, /今天全天|明天报到/);
vm.runInContext(`state.taskViews['🏥 临床']={range:'inbox',dates:'all',inboxProjectId:''};renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /指定清单/);
vm.runInContext(`state.taskViews['🏥 临床'].inboxProjectId='i';renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /明天报到/);
assert.doesNotMatch(nodes['#tasks'].textContent, /昨天逾期|今天定时/);
vm.runInContext(`state.scene='🏥 临床';state.taskViews['🏥 临床']={range:'scene',dates:'all',inboxProjectId:''};state.didaListIds.clinical='missing-id';renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /清单暂未读取到/);

vm.runInContext(`state.scene='总览';state.taskView={range:'scene',dates:'today',inboxProjectId:''};state.didaListIds.clinical='';renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /未关联清单/);

vm.runInContext(`
  state.didaListIds.clinical='c';
  didaDashboard={source:'partial',failedCount:1,failedProjectIds:['c'],projects:[{id:'c',name:'临床'},{id:'r',name:'科研'},{id:'s',name:'学习'},{id:'l',name:'生活'}],tasks:[]};
  renderTasks();
`, context);
assert.match(nodes['#tasks'].textContent, /部分同步：1 个清单读取失败/);
assert.match(nodes['#tasks'].textContent, /清单读取失败 · 暂不能确认/);
assert.equal((nodes['#tasks'].textContent.match(/今天暂无任务/g) || []).length, 3);

vm.runInContext(`dida={state:'expired'};didaDashboard={source:'cache',fetchedAt:'2026-09-13T08:48:00Z',projects:[{id:'c',name:'临床'},{id:'r',name:'科研'},{id:'s',name:'学习'},{id:'l',name:'生活'}],tasks:[]};renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /授权已过期 · 当前显示的是上次成功同步的离线缓存/);
assert.match(nodes['#tasks'].textContent, /缓存中无今天任务/);
assert.doesNotMatch(nodes['#tasks'].textContent, /今天暂无任务/);
vm.runInContext(`dida={state:'connected'};didaDashboard={source:'live',lastSuccessfulAt:'2026-09-13T08:48:00.000Z',projects:[{id:'c',name:'临床'}],tasks:[]};renderStatus()`, context);
assert.match(nodes['#didaInfo'].textContent, /滴答已同步 · 最近成功同步 16:48/);
vm.runInContext(`dida={state:'expired'};didaDashboard={source:'cache',fetchedAt:'2026-09-13T08:48:00.000Z',projects:[],tasks:[]};renderStatus()`, context);
assert.match(nodes['#didaInfo'].textContent, /授权已过期 · 当前使用离线缓存/);
assert.match(nodes['#didaInfo'].textContent, /读取到 0 个清单/);

vm.runInContext(`didaDashboard=null;dida={state:'loading',message:'正在读取滴答清单…'};refreshInFlight=true;renderTasks()`, context);
assert.match(nodes['#tasks'].textContent, /正在读取滴答清单/);

vm.runInContext(`
  const many=Array.from({length:120},(_,i)=>({id:String(i),title:'合成任务 '+i,projectId:'c',status:0,dueDate:'${today}',isAllDay:true}));
  dida={state:'connected'};didaDashboard={source:'live',projects:[{id:'c',name:'临床'},{id:'r',name:'科研'},{id:'s',name:'学习'},{id:'l',name:'生活'}],tasks:many};
  collapsedTaskGroups.add('🏥 临床');renderTasks();
`, context);
const clinicalGroup = nodes['#tasks'].children.find((node) => node.tagName === 'DETAILS' && node.dataset.groupTitle === '🏥 临床');
assert.ok(clinicalGroup && !clinicalGroup.open, 'refresh preserves the user-collapsed state');
assert.equal(clinicalGroup.children.length, 121, 'large task group renders all 120 tasks without dropping entries');

vm.runInContext(`
  state.library.configured={id:'configured',name:'Real app',kind:'application',target:'C:\\\\synthetic\\\\app.exe',type:'软件'};
  state.library.unset={id:'unset',name:'Demo item',kind:'demo',target:'',type:'软件'};
  state.scenes['总览'].apps=['configured','unset'];state.scenes['总览'].layout.showUnsetEntries=false;editing=false;
  const refs=current().apps.map((id,index)=>({id,index,item:entry(id)}));
  globalThis.normalRefs=visibleEntryRefs(refs,'').map(({id,index})=>({id,index}));
  globalThis.searchRefs=visibleEntryRefs(refs,'demo').map(({id,index})=>({id,index}));
  editing=true;globalThis.editRefs=visibleEntryRefs(refs,'').map(({id,index})=>({id,index}));
`, context);
assert.deepEqual(JSON.parse(JSON.stringify(context.normalRefs)), [{ id: 'configured', index: 0 }]);
assert.deepEqual(JSON.parse(JSON.stringify(context.searchRefs)), [{ id: 'unset', index: 1 }]);
assert.deepEqual(JSON.parse(JSON.stringify(context.editRefs)), [{ id: 'configured', index: 0 }, { id: 'unset', index: 1 }]);

(async()=>{
  vm.runInContext(`editing=false;state.taskView={range:'scene',dates:'today',inboxProjectId:''}`,context);
  await vm.runInContext(`saveTaskView({range:'scene',dates:'all'})`,context);
  assert.equal(testHomeApi.saved.taskView.dates,'all','task-view preference persists through local config');
  testHomeApi.failSave=true;
  await vm.runInContext(`saveTaskView({dates:'today'})`,context);
  assert.equal(JSON.parse(vm.runInContext('JSON.stringify(state.taskView)',context)).dates,'all','failed preference write restores prior selection');
  assert.match(context.lastToast,/保存失败/);
  console.log('renderer state checks passed: chronological all-dates and explicit inbox scope, due-date overdue, legacy today empty/unlinked/loading/partial/cache states, config save/rollback, and preserved entry identity');
})().catch((error)=>{console.error(error);process.exitCode=1;});
