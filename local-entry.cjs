const fs = require('node:fs/promises');
const path = require('node:path');

function cleanTarget(value) {
  const text = String(value || '').trim();
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).trim() : text;
}

// Reject forbidden and ambiguous paths before any filesystem access.
async function validateEntry(entry) {
  const kind = entry?.kind;
  const target = cleanTarget(entry?.target);
  if (kind === 'demo') return { ok: true, kind, target: '' };
  if (kind === 'website') {
    try {
      const url = new URL(target);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
      return { ok: true, kind, target: url.href };
    } catch { return { ok: false, error: '网站地址需要以 https:// 或 http:// 开头。' }; }
  }
  if (!['application', 'file', 'folder'].includes(kind)) return { ok: false, error: '请选择入口方式。' };
  if (!/^[a-z]:[\\/]/i.test(target) || /[\x00-\x1f~]/.test(target)) {
    return { ok: false, error: '请使用完整的本地路径；不支持网络路径、短路径或附带启动参数。' };
  }
  const normalized = path.win32.normalize(target);
  const forbidden = 'd:\\k science\\r 软件资料';
  const lower = normalized.toLowerCase().replace(/\\+$/, '');
  if (lower === forbidden || lower.startsWith(forbidden + '\\')) return { ok: false, error: '此路径位于受保护数据区域，不能使用。' };
  if (normalized.slice(2).includes(':') || /\.(lnk|url)$/i.test(normalized)) return { ok: false, error: '当前版本请直接选择应用的 .exe 文件；暂不支持快捷方式或链接文件。' };
  try {
    const root = path.win32.parse(normalized).root;
    let current = root;
    let stat;
    for (const segment of normalized.slice(root.length).split('\\').filter(Boolean)) {
      current = path.win32.join(current, segment);
      stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return { ok: false, error: '此路径包含链接或目录联接，不能使用。' };
    }
    stat ||= await fs.lstat(root);
    if (kind === 'folder' ? !stat.isDirectory() : !stat.isFile()) return { ok: false, error: '路径类型不匹配，请检查“入口方式”。' };
    if (kind === 'application' && path.win32.extname(normalized).toLowerCase() !== '.exe') return { ok: false, error: '请选择应用的 .exe 文件。文件或文件夹请使用对应的入口方式。' };
    return { ok: true, kind, target: normalized };
  } catch { return { ok: false, error: '找不到此路径或没有访问权限，请重新选择。' }; }
}

async function launchValidatedEntry(entry, shell) {
  const result = await validateEntry(entry);
  if (!result.ok) return result;
  if (result.kind === 'demo') return { ok: false, error: '这是演示入口，请先编辑并连接本机应用。' };
  try {
    if (result.kind === 'website') await shell.openExternal(result.target);
    else {
      const error = await shell.openPath(result.target);
      if (error) return { ok: false, error: 'Windows 未能打开该入口，请检查文件关联或重新选择应用。' };
    }
    return { ok: true };
  } catch { return { ok: false, error: 'Windows 未能打开该入口，请重新选择。' }; }
}
module.exports = { validateEntry, launchValidatedEntry };
