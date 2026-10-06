'use strict';

const MAX_CACHE_ENTRIES = 96;
const MAX_ICON_BYTES = 48 * 1024;

function createEntryIconResolver({ app, getEntryById, validateEntry }) {
  const cache = new Map();
  const remember = (key, value) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return value;
  };
  const fallback = (key = 'fallback') => remember(key, { ok: true, kind: 'fallback' });

  return async function entryIcon(entryId) {
    if (typeof entryId !== 'string' || !entryId || entryId.length > 160) return fallback();
    let item;
    try { item = await getEntryById(entryId); } catch { return fallback(); }
    if (!item || typeof item !== 'object') return fallback();
    if (item.kind === 'website') return { ok: true, kind: 'website' };
    if (!['application', 'file', 'folder'].includes(item.kind) || typeof item.target !== 'string' || !item.target.trim()) {
      return { ok: true, kind: 'placeholder' };
    }

    const identity = `${entryId}\0${item.kind}\0${item.target}`;
    if (cache.has(identity)) return cache.get(identity);
    try {
      // validateEntry rejects the protected path before it performs any filesystem access.
      const checked = await validateEntry({ kind: item.kind, target: item.target });
      if (!checked?.ok) return fallback(identity);
      const nativeIcon = await app.getFileIcon(checked.target, { size: 'large' });
      if (!nativeIcon || nativeIcon.isEmpty?.()) return fallback(identity);
      const png = nativeIcon.resize({ width: 40, height: 40, quality: 'best' }).toPNG();
      if (!Buffer.isBuffer(png) || png.length === 0 || png.length > MAX_ICON_BYTES) return fallback(identity);
      return remember(identity, { ok: true, kind: 'system', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    } catch {
      return fallback(identity);
    }
  };
}

module.exports = { createEntryIconResolver, MAX_CACHE_ENTRIES, MAX_ICON_BYTES };
