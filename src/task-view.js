'use strict';
(function(root){
  function dateKey(value,allDay=false){
    if(!value)return null;const raw=String(value);let date;
    const datePart=/^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw)?.[1];
    if(allDay&&datePart){
      const [y,m,d]=datePart.split('-').map(Number);date=new Date(Date.UTC(y,m-1,d));
      if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return 'invalid';return datePart;
    }
    date=new Date(raw);if(Number.isNaN(date.valueOf()))return 'invalid';
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const v=n=>p.find(x=>x.type===n)?.value;return `${v('year')}-${v('month')}-${v('day')}`;
  }
  function taskDate(task){return task?.dueDate||task?.startDate||null;}
  function taskDay(task){const value=taskDate(task);return value?dateKey(value,task.isAllDay):null;}
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
  root.HomeTaskView={dateKey,taskDate,taskDay,compareTasks,dayLabel};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HomeTaskView;
})(globalThis);
