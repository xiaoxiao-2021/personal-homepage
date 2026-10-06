'use strict';

// Only completes a task from a successful, known dashboard snapshot. No generic
// URL, task-update or filesystem capability is exposed to the renderer.
function hasWriteScope(credential) {
  return String(credential?.scope || '').split(/\s+/).includes('tasks:write');
}
function occurrenceKey(task) {
  return JSON.stringify([task.id, task.projectId, task.dueDate || null, task.startDate || null, task.repeatFlag || null]);
}
function createDidaCompletion({ getCredential, getDashboard, fetch: request, apiUrl, now = Date.now }) {
  const flights = new Map();
  const acknowledged = new Map();
  const failure = (code, message) => ({ ok: false, code, message });
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  function reconcile(dashboard) {
    if (!dashboard?.tasks) return dashboard;
    return { ...dashboard, tasks: dashboard.tasks.filter(task => acknowledged.get(`${task.projectId}:${task.id}`) !== occurrenceKey(task)) };
  }
  async function perform(projectId, taskId, expectedOccurrence) {
    const credential = await getCredential();
    if (!credential || (credential.expiresAt && now() >= credential.expiresAt)) return failure('expired', '授权不可用或已过期，请在设置中连接滴答清单。');
    if (!hasWriteScope(credential)) return failure('scope', '当前为只读授权，请先启用首页完成任务。');
    const dashboard = getDashboard();
    if (!dashboard || !['live', 'partial'].includes(dashboard.source)) return failure('offline', '当前不是实时任务数据，请联网刷新后再完成任务。');
    if (dashboard.source === 'partial' && (!Array.isArray(dashboard.failedProjectIds) || dashboard.failedProjectIds.includes(projectId))) return failure('unavailable', '此清单尚未成功读取，请刷新后重试。');
    const task = dashboard.tasks?.find(item => item.id === taskId && item.projectId === projectId && Number(item.status) !== 2);
    if (!task) return failure('unknown', '任务已变化或未成功读取，请刷新后重试。');
    const key = `${projectId}:${taskId}`, occurrence = occurrenceKey(task);
    if (expectedOccurrence !== occurrence) return failure('changed', '任务已刷新变化，请根据最新列表重新操作。');
    if (acknowledged.get(key) === occurrence) return failure('submitted', '这次任务已完成，请刷新查看最新安排。');
    const headers = { Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json' };
    const url = `${apiUrl}/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`;
    let submitting = false;
    try {
      const fresh = await request(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (fresh.status === 401) return failure('expired', '授权已过期，请重新连接滴答清单。');
      if (fresh.status === 403) return failure('permission', '此任务无法访问，请检查清单权限或重新授权。');
      if (fresh.status === 404) return failure('missing', '任务已被移动或不再存在，请刷新列表。');
      if (!fresh.ok) return failure('read', '无法核对任务的最新状态，请稍后刷新。');
      const current = await fresh.json();
      if (String(current.id || '') !== taskId || String(current.projectId || projectId) !== projectId) return failure('mismatch', '服务返回的任务身份不一致，已停止操作。');
      if (Number(current.status) === 2) {
        acknowledged.set(key, occurrence);
        return { ok: true, alreadyCompleted: true };
      }
      if (occurrenceKey({ ...current, projectId }) !== occurrence) return failure('changed', '任务日期或重复安排已变化，请刷新后再操作。');
      submitting = true;
      const response = await request(`${url}/complete`, { method: 'POST', headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (response.status === 401) return failure('expired', '授权已过期，完成未成功，请重新连接。');
      if (response.status === 403) return failure('permission', '完成被拒绝，请检查 tasks:write 授权和清单写入权限。');
      if (response.status === 404) return failure('missing', '任务已被移动或不再存在，请刷新列表。');
      if (!response.ok) return failure('server', '滴答未确认完成，请刷新核对结果后再重试。');
      // Empty 200/201/204 is a valid acknowledgement; do not parse as JSON.
      acknowledged.set(key, occurrence);
      if (acknowledged.size > 1000) acknowledged.delete(acknowledged.keys().next().value);
      return { ok: true };
    } catch {
      return failure(submitting ? 'uncertain' : 'network', submitting ? '网络中断，完成结果尚未确认。请先刷新核对，避免重复提交。' : '无法连接滴答核对任务，请联网后重试。');
    }
  }
  function complete(projectId, taskId, expectedOccurrence) {
    if (!validId(projectId) || !validId(taskId)) return Promise.resolve(failure('invalid', '任务标识无效，已停止操作。'));
    const key = `${projectId}:${taskId}`;
    if (!flights.has(key)) flights.set(key, perform(projectId, taskId, expectedOccurrence).finally(() => flights.delete(key)));
    return flights.get(key);
  }
  return { complete, reconcile, clear: () => acknowledged.clear() };
}
module.exports = { hasWriteScope, occurrenceKey, createDidaCompletion };
