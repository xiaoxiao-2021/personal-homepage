'use strict';
(function(root){
  function validCalendarDay(raw){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;
    const [y,m,d]=raw.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
  }
  function zonedDateTime(value,timeZone='Asia/Shanghai'){
    const raw=String(value||'');
    // API timestamps are instants with an explicit offset, not date-only values.
    if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(raw)||!validCalendarDay(raw.slice(0,10)))return null;
    const date=new Date(raw);if(Number.isNaN(date.valueOf()))return null;
    try{
      const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
      const v=n=>p.find(x=>x.type===n)?.value;
      return {date:`${v('year')}-${v('month')}-${v('day')}`,time:`${v('hour')}:${v('minute')}`};
    }catch{return null;}
  }
  function dateKey(value,allDay=false,timeZone='Asia/Shanghai'){
    if(!value)return null;const raw=String(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return validCalendarDay(raw)?raw:'invalid';
    // Preserve established Shanghai grouping for timed tasks; all-day tasks use their own zone.
    return zonedDateTime(raw,allDay?(timeZone||'Asia/Shanghai'):'Asia/Shanghai')?.date||'invalid';
  }
  function taskDate(task){return task?.dueDate||task?.startDate||null;}
  function taskFieldDay(task,field){return dateKey(task?.[field],task?.isAllDay,task?.timeZone||'Asia/Shanghai');}
  function taskDay(task){return taskFieldDay(task,task?.dueDate?'dueDate':'startDate');}
  function isOverdue(task,today){const day=taskFieldDay(task,'dueDate');return Boolean(day&&day!=='invalid'&&day<today);}
  function compareTasks(a,b){
    const da=taskDay(a),db=taskDay(b),ka=da==='invalid'?'9999-99-98':da||'9999-99-99',kb=db==='invalid'?'9999-99-98':db||'9999-99-99';
    if(ka!==kb)return ka.localeCompare(kb);if(da==='invalid'||!da)return String(a.id||'').localeCompare(String(b.id||''));
    if(Boolean(a.isAllDay)!==Boolean(b.isAllDay))return a.isAllDay?-1:1;
    if(!a.isAllDay){const ta=Date.parse(taskDate(a))||0,tb=Date.parse(taskDate(b))||0;if(ta!==tb)return ta-tb;}
    return String(a.id||'').localeCompare(String(b.id||''));
  }
  function dayLabel(key,today){
    const date=new Date(`${key}T12:00:00+08:00`);if(Number.isNaN(date.valueOf()))return key;
    const tomorrow=new Date(`${today}T12:00:00+08:00`);tomorrow.setDate(tomorrow.getDate()+1);const tomorrowKey=dateKey(tomorrow.toISOString());
    const [y,m,d]=key.split('-'),md=`${Number(m)}月${Number(d)}日`,relative=key===today?'今天':key===tomorrowKey?'明天':'';
    return `${relative}${relative?' · ':''}${Number(y)!==Number(today.slice(0,4))?`${y}年`:''}${md}`;
  }
  root.HomeTaskView={dateKey,zonedDateTime,taskDate,taskFieldDay,taskDay,isOverdue,compareTasks,dayLabel};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HomeTaskView;
})(globalThis);
