const fs = require('fs');
const path = require('path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const polish = fs.readFileSync(path.join(__dirname, '..', 'src', 'visual-polish.css'), 'utf8');

if (/addEventListener\(['"](?:mousemove|pointermove|mouseover|mouseenter)['"]/.test(renderer)) {
  throw new Error('renderer attaches a global pointer/mouse hover listener');
}
if (!/\.entry:hover\s*\{[^}]*transform:\s*none;[^}]*box-shadow:\s*none;/s.test(polish)) {
  throw new Error('component hover rule does not remove transform and shadow');
}
if (!/transition:\s*background-color 90ms linear, border-color 90ms linear, color 90ms linear/.test(polish)) {
  throw new Error('hover transition is not limited to cheap local properties');
}
if (/\.entry:hover\s*\{[^}]*translateY/s.test(polish+html)) {
  throw new Error('obsolete entry hover movement remains');
}
console.log('hover performance checks passed: no global pointer listener; final CSS removes entry motion/shadow while preserving local feedback');
