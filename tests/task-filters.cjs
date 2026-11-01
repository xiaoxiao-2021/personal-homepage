const assert=require('node:assert/strict'),v=require('../src/task-view.js');
let count=0;function check(value,label){assert(value,label);count++;}
for(const [today,end] of [['2026-10-29','2026-11-04'],['2026-12-29','2027-01-04'],['2028-02-26','2028-03-03']]){
 check(v.shiftDay(today,6)===end,'seven calendar days across month/year/leap boundaries');
 for(const offset of [-1,0,6,7])check(v.matchesFilter({dueDate:v.shiftDay(today,offset),isAllDay:true},'week',today)===(offset>=0&&offset<=6),'inclusive seven day boundary');
}
check(v.matchesFilter({dueDate:'2026-10-30',isAllDay:true},'today','2026-10-31'),'today includes overdue');
check(!v.matchesFilter({startDate:'2026-10-30',isAllDay:true},'today','2026-10-31'),'past start date alone is not overdue');
for(const task of [{startDate:'bad'}, {dueDate:'bad'}, {startDate:'2026-11-01'}])check(!v.matchesFilter(task,'undated','2026-10-31'),'invalid or scheduled dates not treated as undated');
check(v.matchesFilter({},'undated','2026-10-31'),'empty schedule is undated');
check(!v.matchesFilter({dueDate:'bad'},'week','2026-10-31'),'invalid excluded from week');
check(v.matchesFilter({dueDate:'2026-10-30T16:30:00Z',timeZone:'Asia/Shanghai',isAllDay:true},'today','2026-10-31'),'all-day Shanghai date preserves UTC boundary');
check(v.matchesFilter({dueDate:'2026-10-30T16:30:00Z',isAllDay:false},'today','2026-10-31'),'timed Shanghai grouping unchanged');
console.log('PASS '+count+' date filter logic checks');
