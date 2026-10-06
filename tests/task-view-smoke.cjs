'use strict';
const assert=require('node:assert/strict');
const {dateKey,taskDate,taskDay,compareTasks,dayLabel}=require('../src/task-view.js');
const today='2026-09-13';
assert.equal(dateKey('2026-09-14',true),'2026-09-14');
assert.equal(dateKey('2026-09-14T00:00:00Z',true),'2026-09-14','all-day timestamps keep their source calendar date');
assert.equal(dateKey('2026-02-30',true),'invalid');
assert.equal(dateKey('2026-09-13bad',true),'invalid');
assert.equal(dateKey('invalid',false),'invalid');
assert.equal(dateKey('2026-09-14T17:00:00Z',false),'2026-09-15','timed date uses Shanghai local calendar day');
assert.equal(taskDate({dueDate:'due',startDate:'start'}),'due','due date takes precedence over start date');
assert.equal(taskDay({startDate:'2026-09-12',isAllDay:true}),'2026-09-12');
assert.equal(taskDay({} ),null);
const items=[
 {id:'untimed',dueDate:'2026-09-13T15:00:00+08:00',isAllDay:false},
 {id:'tomorrow',dueDate:'2026-09-14',isAllDay:true},
 {id:'today-all',dueDate:'2026-09-13',isAllDay:true},
 {id:'today-early',dueDate:'2026-09-13T08:00:00+08:00',isAllDay:false},
 {id:'today-late-b',dueDate:'2026-09-13T09:00:00+08:00',isAllDay:false},
 {id:'today-late-a',dueDate:'2026-09-13T09:00:00+08:00',isAllDay:false},
 {id:'undated'},
 {id:'invalid',dueDate:'not-a-date'}
].sort(compareTasks);
assert.deepEqual(items.map(x=>x.id),['today-all','today-early','today-late-a','today-late-b','untimed','tomorrow','invalid','undated']);
assert.equal(dayLabel(today,today),'今天 · 9月13日');
assert.equal(dayLabel('2026-09-14',today),'明天 · 9月14日');
assert.equal(dayLabel('2027-01-02',today),'2027年1月2日');
const yearBoundary=[
 {id:'jan',dueDate:'2027-01-01',isAllDay:true},
 {id:'dec',dueDate:'2026-12-31',isAllDay:true},
 {id:'oct',dueDate:'2026-10-01',isAllDay:true},
 {id:'sep',dueDate:'2026-09-30',isAllDay:true}
].sort(compareTasks);
assert.deepEqual(yearBoundary.map(x=>x.id),['sep','oct','dec','jan'],'calendar order remains chronological across months and years');
console.log('task view checks passed: date bounds, Asia/Shanghai day, due-date precedence, all-day/time/ID stable sorting, invalid and undated order, today/tomorrow/year labels');
