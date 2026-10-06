const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const end = source.indexOf('function entry(id)');
if (end < 0) throw new Error('renderer state section not found');
const context = { URLSearchParams, JSON, Math, Date, Intl, Number, String, Boolean, Object, Array, Set, Map, location:{search:''} };
vm.createContext(context);
vm.runInContext(`${source.slice(0, end)}\nthis.__check = {defaults, normalizeConfigWithTools, normalizeTools, moduleDefaults};`, context);
const { defaults, normalizeConfigWithTools, normalizeTools } = context.__check;

const legacy = JSON.parse(JSON.stringify(defaults));
delete legacy.tools;
legacy.scenes['🏠 生活'].layout.modules = {
  visible: { tasks: true, apps: true, side: false, time: true, calendar: false, music: true },
  order: ['tasks', 'apps', 'time', 'calendar', 'music'],
  sizes: { time: 'large', calendar: 'compact', music: 'medium' }
};
const migrated = normalizeConfigWithTools(legacy);
if (migrated.tools.visible.time !== true || migrated.tools.visible.calendar !== false || migrated.tools.visible.music !== true) throw new Error('legacy tool visibility was not migrated');
if (migrated.tools.sizes.time !== 'large' || migrated.tools.order[0] !== 'time') throw new Error('legacy tool order/size was not migrated');
for (const scene of ['总览', '🏥 临床', '🔬 科研', '📚 学习', '🏠 生活']) {
  if (!migrated.scenes[scene].layout.modules || migrated.scenes[scene].layout.modules.visible.tasks === undefined) throw new Error(`scene modules missing: ${scene}`);
}

if (migrated.tools.version !== 2 || migrated.tools.accent !== 'theme' || migrated.tools.clockFormat !== '24') throw new Error('tool v2 defaults were not migrated');
const custom = JSON.parse(JSON.stringify(migrated));
custom.tools = normalizeTools({ version:2, visible: { time: false, calendar: true, music: false, unknown: true }, order: ['calendar', 'unknown', 'music', 'time'], musicCollapsed: true, accent:'mist', clockFormat:'12', clockSize:'large', calendarDensity:'compact' }, null);
const preserved = normalizeConfigWithTools(custom);
if (preserved.tools.visible.time !== false || preserved.tools.order[0] !== 'calendar' || preserved.tools.musicCollapsed !== true) throw new Error('existing global tool configuration was overwritten');
if ('unknown' in preserved.tools.visible || preserved.tools.order.includes('unknown')) throw new Error('unknown tool keys were not removed');
if (preserved.tools.accent !== 'mist' || preserved.tools.clockFormat !== '12' || preserved.tools.clockSize !== 'large' || preserved.tools.calendarDensity !== 'compact') throw new Error('tool personalization was not preserved');
if (preserved.scenes['🏠 生活'].layout.modules.visible.side !== false) throw new Error('life project/material visibility was lost');
console.log('shared tool checks passed: legacy migration, global visibility/order/size persistence, and scene layout preservation');
