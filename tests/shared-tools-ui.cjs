const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared-tools.css'), 'utf8');
for (const id of ['moduleCard','moduleStack','moduleDialog','moduleChecks','toolChecks','moduleOrder','toolOrder','toolAccent','toolClockFormat','toolClockSize','toolCalendarDensity','toolMusicMode','toolReset','musicCollapse']) {
  if (!new RegExp(`id=["']${id}["']`).test(html)) throw new Error(`missing shared tool control: ${id}`);
}
for (const token of ['toolDefaults','normalizeTools','normalizeConfigWithTools','data-tool-visible','moveTool','resetToolManagerDraft','musicCollapsed','calendarDensity','clockFormat']) {
  if (!renderer.includes(token)) throw new Error(`missing shared tool renderer hook: ${token}`);
}
for (const token of ['grid-template-columns','grid-row: 1 / span 2','max-width: 720px','is-collapsed']) {
  if (!css.includes(token)) throw new Error(`missing shared tool layout rule: ${token}`);
}
console.log('shared tool UI checks passed: shared controls, global renderer hooks, and responsive three/two/one-column rules present');
