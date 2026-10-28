const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, dialog, nativeImage, shell, clipboard, safeStorage, screen, powerMonitor, protocol, net, Notification } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const http = require('node:http');
const {configureRuntime}=require('./portable-runtime.cjs');
const runtime=configureRuntime(app,require('./package.json'));
// Only the explicit packaged diagnostic mode blocks services; normal app behaviour is unchanged.
if(runtime.isolatedTest)globalThis.fetch=async()=>{throw new Error('隔离打包测试禁止外部服务请求。');};
const { validateEntry, launchValidatedEntry } = require('./local-entry.cjs');
const { createEntryIconResolver } = require('./entry-icon.cjs');
const { hasWriteScope, createDidaCompletion } = require('./dida-completion.cjs');
const {createCheckItemCompletion}=require('./dida-check-items.cjs');
const assistant = require('./task-assistant.cjs');
const pomodoro=require('./pomodoro.cjs');
const codexQuota=require('./codex-quota.cjs');
const quotaService=codexQuota.createService({...(runtime.isolatedTest?{reader:async()=>{throw Object.assign(new Error('isolated'),{quotaCode:'missing'});}}:{}),find:()=>codexQuota.locateExecutable({
  appData:app.getPath('appData'),
  localAppData:process.env.LOCALAPPDATA||path.join(path.dirname(app.getPath('appData')),'Local')
})});
let pomodoroSettings=pomodoro.normalizeSettings(null),pomodoroSettingsBusy=false,pomodoroInterval=null;
function publishPomodoro(){const value=pomodoroTimer.snapshot();for(const win of [mainWindow,trialWindow]){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('pomodoro:state',value);}return value;}
const pomodoroTimer=pomodoro.createTimer({onComplete:phase=>{
  const visible=[mainWindow,trialWindow].some(win=>win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized());
  if(!visible&&Notification.isSupported())try{const notice=new Notification({title:'个人首页 · 番茄钟',body:phase==='focus'?'本轮专注已完成，回来开始休息吧。':'休息结束，可以开始下一轮专注。',silent:true});notice.on('click',showHomepage);notice.show();}catch{/* Completion remains in timer state if Windows notifications are unavailable. */}
  publishPomodoro();
}});
const { STARTUP_ARGUMENT, STARTUP_NAME, normalizeStartupPreferences, decideLoginItemChange, createLoginItemAdapter } = require('./startup-settings.cjs');
const BUILD_ID = '2026.10.28.1';
const processStartedAt = process.hrtime.bigint();
const loginStartupLaunch = !runtime.preview&&process.argv.includes(STARTUP_ARGUMENT);
const startupAdapter = createLoginItemAdapter({
  app,
  executablePath: process.execPath,
  appPath: app.getAppPath(),
  packaged: app.isPackaged,
  name: STARTUP_NAME
});

let mainWindow;
let tray;
let musicState = { playing: false, title: '' };
let calendarSession = null;
let isQuitting = false;
let registeredHotkey = '';
let didaAuthorization = null;
let didaCapabilities = null;
let didaProjects = null;
let didaStatusFlight = null;
let didaDashboardFlight = null;
let latestDidaDashboard = null;
let didaRevision = 0;
let didaOperationTail = Promise.resolve();
let didaAuthorizationError = '';
const taskCompletionFlights = new Map();
let trialWindow = null;
let trialAttachment = null;
let trialEntering = false;
let trialExiting = false;
let quitAfterTrialRestore = false;
let destroyingTrial = false;
let desktopProbeTimer = null;
let desktopProbeInFlight = false;
let desktopProbeCallback = null;
let desktopRecovering = false;
let startupQuitCleanupInFlight = false;
let startupQuitCleanupDone = false;
let loginStartupInProgress = loginStartupLaunch;
let manualWakeDuringLoginStartup = false;
let firstLocalReadyAt = null;
let firstDidaDashboardDurationMs = null;
let lastDidaDashboardDurationMs = null;
let desktopAttachDurationMs = null;
const localPageReady = new Set();
const pageReadyWaiters = new Map();
const pendingWindowReveals = new Map();

const configPath = () => path.join(app.getPath('userData'), 'homepage-config.json');
const didaCredentialPath = () => path.join(app.getPath('userData'), 'dida-credential.bin');
const didaCachePath = () => path.join(app.getPath('userData'), 'dida-dashboard-cache.bin');
const startupPreferencesPath = () => path.join(app.getPath('userData'), 'homepage-startup.json');
const startupRecoveryPath = () => path.join(app.getPath('userData'), 'homepage-startup-recovery.json');
const DIDA_MCP_URL = 'https://mcp.dida365.com/';
const DIDA_REGISTER_URL = 'https://api.dida365.com/oauth/register';
const DIDA_AUTHORIZE_URL = 'https://dida365.com/oauth/authorize';
const DIDA_TOKEN_URL = 'https://api.dida365.com/oauth/token';
const DIDA_API_URL = 'https://api.dida365.com/open/v1';
const aiCredentialPath = () => path.join(app.getPath('userData'), 'deepseek-credential.bin');
const aiSubmissionPath = () => path.join(app.getPath('userData'), 'assistant-submission.bin');
let aiController = null, aiCreating = false, aiSettingsTail = Promise.resolve();
let aiSession = { messages: [], input: '', preview: null, lastCreated: null };
let aiDraft = null;
const taskWriter = assistant.createTaskWriter({getCredential:readDidaCredential,getDashboard:()=>latestDidaDashboard,apiUrl:DIDA_API_URL});
async function aiSubmissionState() {
  try {
    const bytes=await fs.readFile(aiSubmissionPath());
    if(!safeStorage.isEncryptionAvailable())return {uncertain:true};
    const value=JSON.parse(safeStorage.decryptString(bytes));
    return typeof value?.uncertain==='boolean'?value:{uncertain:true};
  } catch(error){return error.code==='ENOENT'?{uncertain:false}:{uncertain:true};}
}
async function aiStatus() {
  const saved=await readProtectedJson(aiCredentialPath());
  return {configured:Boolean(saved?.key),model:assistant.MODELS.includes(saved?.model)?saved.model:assistant.MODELS[0],models:assistant.MODELS};
}
function aiSaveSettings(value) {
  const pending=aiSettingsTail.then(async()=>{
    if(aiController||aiCreating)return {ok:false,message:'请求进行中，请等结果返回后再修改密钥。'};
    try {
      if(value?.remove===true){await fs.rm(aiCredentialPath(),{force:true});return {ok:true,...await aiStatus()};}
      if(!assistant.MODELS.includes(value?.model))return {ok:false,message:'请选择有效模型。'};
      const previous=await readProtectedJson(aiCredentialPath());
      const key=typeof value.key==='string'?value.key.trim():'';
      if(key&&(!/^[\x21-\x7e]{10,256}$/.test(key)))return {ok:false,message:'密钥格式不正确；原密钥保持不变。'};
      if(!key&&!previous?.key)return {ok:false,message:'请输入自己的 DeepSeek API Key。'};
      await writeProtectedJson(aiCredentialPath(),{key:key||previous.key,model:value.model});
      return {ok:true,...await aiStatus()};
    } catch {return {ok:false,message:'密钥保存失败或系统加密不可用；原设置保持不变。'};}
  });aiSettingsTail=pending.catch(()=>{});return pending;
}
async function aiGenerate(value) {
  if(aiController||aiCreating)return {ok:false,message:'已有请求正在进行。'};
  const controller=new AbortController();aiController=controller;
  try {
    if((await aiSubmissionState()).uncertain)return {ok:false,message:'上次创建结果不确定。请先核对滴答客户端并解除提示。'};
    const config=(await readConfig()).config;
    if(!config?.scenes?.[value?.scene])return {ok:false,message:'场景尚未保存，请先保存布局。'};
    const dashboard=latestDidaDashboard;
    const projects=(dashboard?.projects||[]).filter(p=>!dashboard.failedProjectIds?.includes(p.id));
    const mapping={'🏥 临床':'clinical','🔬 科研':'research','📚 学习':'study','🏠 生活':'life'};
    const defaultProjectId=config.didaListIds?.[mapping[value.scene]]||'';
    const saved=await readProtectedJson(aiCredentialPath());
    if(controller.signal.aborted)return {ok:false,message:'已取消生成；没有创建任务。'};
    const sentAt=new Date(),clock=assistant.localContext(sentAt);
    const baseline=aiDraft?`${aiDraft.id}:${aiDraft.revision}`:'';
    let activeDraft=null;
    if(aiSession.preview){
      try{activeDraft=assistant.validateDraft(aiSession.preview.task,projects);}
      catch{return {ok:false,message:'当前便签有未填完或失效的字段，请先编辑并核对；原便签保留。'};}
    }
    const result=await assistant.generate({key:saved?.key,model:saved?.model||assistant.MODELS[0],input:value.input,scene:value.scene,projects,defaultProjectId,history:aiSession.messages,activeDraft,lastCreated:aiSession.lastCreated?.task,signal:controller.signal,now:sentAt});
    if(controller.signal.aborted)return {ok:false,message:'已取消生成；没有创建任务。'};
    if(baseline!==(aiDraft?`${aiDraft.id}:${aiDraft.revision}`:''))return {ok:false,message:'便签已经手动修改，已忽略旧回复；当前便签保留。'};
    if(result.ok){
      aiSession.messages.push({role:'user',content:value.input},{role:'assistant',content:result.kind==='draft'?JSON.stringify(result.task):result.message});
      aiSession.messages=aiSession.messages.slice(-12);
      if(result.kind==='draft'){
        aiDraft={id:assistant.newId(),revision:1,scene:value.scene,projects:projects.map(p=>({id:p.id,name:p.name})),timeZone:clock.timeZone,sentAt:`${clock.date} ${clock.time}`,previousCreated:Boolean(aiSession.lastCreated)};
        result.preview={...aiDraft,task:result.task};aiSession.preview=result.preview;
      }
    }
    return result;
  } finally {if(aiController===controller)aiController=null;}
}
async function aiCreate(value) {
  if(aiCreating)return {ok:false,message:'创建正在提交，请等待结果；不会重复发送。'};
  if(aiController)return {ok:false,message:'请先等待生成结束或取消生成，再确认草稿。'};
  if(didaAuthorization)return {ok:false,message:'滴答授权正在进行，请完成授权并刷新后再创建。'};
  if(!aiDraft||value?.id!==aiDraft.id||value?.revision!==aiDraft.revision)return {ok:false,message:'便签已变化，请查看最新便签再确认。'};
  try{if(JSON.stringify(assistant.validateDraft(value.task,aiDraft.projects))!==JSON.stringify(assistant.validateDraft(aiSession.preview?.task,aiDraft.projects)))return {ok:false,message:'便签内容尚未同步，请核对最新便签再确认。'};}
  catch(error){return {ok:false,message:error.message+' 原便签保留。'};}
  if(aiDraft.timeZone!==assistant.localContext().timeZone)return {ok:false,message:'电脑时区已改变，请重新生成并核对日期。'};
  aiCreating=true;
  try {
    const prior=await aiSubmissionState();
    if(prior?.uncertain)return {ok:false,code:'uncertain',message:'上次结果尚未核对，已阻止重复提交。'};
    // Persist a crash/timeout latch BEFORE any write request. No task body or key here.
    try {await writeProtectedJson(aiSubmissionPath(),{uncertain:true,requestId:aiDraft.id});}
    catch {return {ok:false,message:'无法保存防重复提交记录，未发送创建请求。'};}
    const result=await queueDidaOperation(()=>taskWriter.create(aiDraft.id,value.task,aiDraft.projects,aiDraft.timeZone));
    if(result.code!=='uncertain'){
      try {await writeProtectedJson(aiSubmissionPath(),{uncertain:false});}
      catch {result.warning=[result.warning,'结果已返回，但防重复记录未能清理；请核对后解除提示。'].filter(Boolean).join(' ');}
    }
    if(result.ok){
      aiSession.lastCreated={task:assistant.validateDraft(value.task,aiDraft.projects),projects:aiDraft.projects,scene:aiDraft.scene,timeZone:aiDraft.timeZone,dateCheck:result.dateCheck};
      aiDraft=null;aiSession.preview=null;didaRevision++;
      aiSession.messages.push({role:'assistant',content:'上一项已添加到滴答，不要重复创建；本轮不支持修改已创建任务。'});
      aiSession.messages=aiSession.messages.slice(-12);
      try {const dashboard=await getDidaDashboard();result.dashboard=dashboard;if(!['live','partial'].includes(dashboard?.source)||dashboard.failedProjectIds?.includes(result.projectId))result.warning=[result.warning,'任务已创建，但目标清单刷新未成功；请稍后刷新，不要重复创建。'].filter(Boolean).join(' ');}
      catch {result.warning=[result.warning,'任务已创建，但刷新失败；请稍后刷新，不要重复创建。'].filter(Boolean).join(' ');}
      aiSession.lastCreated.warning=result.warning||'';
    }
    return result;
  } finally {aiCreating=false;}
}
function aiUpdatePreview(value) {
  if(aiCreating||!aiDraft||value?.id!==aiDraft.id||value?.revision!==aiDraft.revision+1)return false;
  // Bounded incomplete edits are kept for handoff; generation/submission validate them.
  const source=value.task;
  if(!source||typeof source!=='object')return false;
  const task={};for(const key of ['title','projectId','content','date','time','dateKind'])task[key]=typeof source[key]==='string'?source[key].slice(0,key==='content'?4000:200):'';
  task.isAllDay=source.isAllDay===true;aiDraft.revision=value.revision;aiSession.preview={...aiDraft,task};return true;
}
const taskCompletion = createDidaCompletion({ getCredential: readDidaCredential, getDashboard: () => latestDidaDashboard, fetch: (...args) => fetch(...args), apiUrl: DIDA_API_URL });
const checkItemCompletion=createCheckItemCompletion({getCredential:readDidaCredential,getDashboard:()=>latestDidaDashboard,fetch:(...args)=>fetch(...args),apiUrl:DIDA_API_URL});
function queueDidaOperation(operation) {
  const result = didaOperationTail.then(operation);
  didaOperationTail = result.catch(() => {});
  return result;
}

// Keep the existing renderer mode unchanged until controlled measurements support a change.
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'home-audio',privileges:{standard:true,secure:true,supportsFetchAPI:true,stream:true}}]);

async function readStartupPreferences() {
  try {
    return normalizeStartupPreferences(JSON.parse(await fs.readFile(startupPreferencesPath(), 'utf8')));
  } catch {
    return normalizeStartupPreferences();
  }
}

async function writeStartupPreferences(value) {
  const preferences = normalizeStartupPreferences(value);
  const destination = startupPreferencesPath();
  const temporary = `${destination}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(preferences, null, 2), 'utf8');
  await fs.rename(temporary, destination);
  return preferences;
}

async function readStartupRecovery() {
  try {
    const value = JSON.parse(await fs.readFile(startupRecoveryPath(), 'utf8'));
    return { pendingDesktopLaunch: Boolean(value.pendingDesktopLaunch), failures: Math.max(0, Math.min(10, Number(value.failures) || 0)) };
  } catch {
    return { pendingDesktopLaunch: false, failures: 0 };
  }
}

async function writeStartupRecovery(value) {
  const destination = startupRecoveryPath();
  const temporary = `${destination}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify({ pendingDesktopLaunch: Boolean(value.pendingDesktopLaunch), failures: Math.max(0, Math.min(10, Number(value.failures) || 0)) }), 'utf8');
  await fs.rename(temporary, destination);
}

function localPageReadyFor(event) {
  const id = event.sender.id;
  localPageReady.add(id);
  if (firstLocalReadyAt === null) firstLocalReadyAt = process.hrtime.bigint();
  const waiters = pageReadyWaiters.get(id);
  if (waiters) {
    pageReadyWaiters.delete(id);
    for (const resolve of waiters) resolve(true);
  }
  const reveal = pendingWindowReveals.get(id);
  if (reveal) {
    pendingWindowReveals.delete(id);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      if (reveal === 'inactive') window.showInactive();
      else { window.show(); window.focus(); }
    }
  }
}

function waitForLocalPage(window, timeoutMs = 15000) {
  const id = window.webContents.id;
  if (localPageReady.has(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const waiters = pageReadyWaiters.get(id) || new Set();
    waiters.add(finish);
    pageReadyWaiters.set(id, waiters);
    function finish(result) {
      clearTimeout(timeout);
      const current = pageReadyWaiters.get(id);
      current?.delete(finish);
      if (current && current.size === 0) pageReadyWaiters.delete(id);
      resolve(result);
    }
  });
}

function clearPageReady(window) {
  if (window?.webContents) localPageReady.delete(window.webContents.id);
}

function forgetPageReady(windowOrId) {
  const id = typeof windowOrId === 'number'
    ? windowOrId
    : (windowOrId && !windowOrId.isDestroyed?.() ? windowOrId.webContents?.id : null);
  if (!Number.isInteger(id)) return;
  localPageReady.delete(id);
  pendingWindowReveals.delete(id);
  const waiters = pageReadyWaiters.get(id);
  if (waiters) {
    pageReadyWaiters.delete(id);
    for (const resolve of waiters) resolve(false);
  }
}

function revealWhenReady(window, mode = 'focus') {
  if (!window || window.isDestroyed()) return;
  const id = window.webContents.id;
  if (!localPageReady.has(id)) {
    pendingWindowReveals.set(id, mode);
    return;
  }
  if (mode === 'inactive') window.showInactive();
  else { window.show(); window.focus(); }
}

function requestCalendarCheck(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (localPageReady.has(window.webContents.id)) window.webContents.send('calendar:check');
}

function validCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function revealInactiveFallback(window, ready) {
  if (!window || window.isDestroyed()) return;
  if (ready) revealWhenReady(window, 'inactive');
  else window.showInactive();
}

function runtimeAbout() {
  const readyAt = firstLocalReadyAt || process.hrtime.bigint();
  const localPageReadyMs = Math.round(Number(readyAt - processStartedAt) / 1e6);
  const metrics = app.getAppMetrics().map((item) => ({
    type: item.type,
    memoryMB: item.memory?.workingSetSize ? Math.round(item.memory.workingSetSize / 1024) : null,
    cpuPercent: Number.isFinite(item.cpu?.percentCPUUsage) ? Math.round(item.cpu.percentCPUUsage * 10) / 10 : null
  }));
  return {
    version: app.getVersion(),
    buildId: BUILD_ID,
    distribution: runtime.preview?'免安装测试版（独立数据，自启动禁写）':'源码版',
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    workingDirectory: process.cwd(),
    executablePath: process.execPath,
    localPageReadyMs,
    firstDidaDashboardDurationMs,
    lastDidaDashboardDurationMs,
    desktopAttachDurationMs,
    desktopAttached: Boolean(trialAttachment),
    runningForSeconds: Math.round(Number(process.hrtime.bigint() - processStartedAt) / 1e9),
    metrics
  };
}

function containsForbiddenReference(value) {
  if (typeof value === 'string') return isForbiddenPath(value);
  if (Array.isArray(value)) return value.some(containsForbiddenReference);
  if (value && typeof value === 'object') return Object.values(value).some(containsForbiddenReference);
  return false;
}

function isConfigShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Number(value.version) === 1 && value.library && typeof value.library === 'object'
    && value.scenes && typeof value.scenes === 'object';
}

async function readConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const config = JSON.parse(raw);
    if (!isConfigShape(config) || containsForbiddenReference(config) || await hasUnsafeConfiguredPath(config)) throw new Error('Invalid config');
    return { config, recovered: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { config: null, recovered: false };
    return { config: null, recovered: true };
  }
}

let configWriteQueue = Promise.resolve();
function writeConfig(config) {
  const snapshot = JSON.parse(JSON.stringify(config));
  const pending = configWriteQueue.then(() => writeConfigNow(snapshot));
  configWriteQueue = pending.catch(() => {});
  return pending;
}
async function writeConfigNow(config, nextPomodoroSettings) {
  // Layout/music/task snapshots cannot overwrite independently committed times.
  config.pomodoroSettings={...(nextPomodoroSettings||pomodoroSettings)};
  if (!isConfigShape(config)) throw new Error('个人首页配置格式无效。');
  if (containsForbiddenReference(config) || await hasUnsafeConfiguredPath(config)) throw new Error('配置包含受保护的数据区域或链接路径，已拒绝保存。');
  const destination = configPath();
  const temporary = `${destination}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(config, null, 2), 'utf8');
  await fs.rename(temporary, destination);
  return true;
}

async function savePomodoroSettings(value){
  const next=pomodoro.validateSettings(value);
  if(pomodoroSettingsBusy||['running','paused'].includes(pomodoroTimer.snapshot().status))return {ok:false,message:'请先重置当前计时，再修改时长。'};
  pomodoroSettingsBusy=true;
  const pending=configWriteQueue.then(async()=>{const loaded=await readConfig();if(!loaded.config)throw new Error('尚未加载有效首页配置。');await writeConfigNow(loaded.config,next);pomodoroSettings=next;pomodoroTimer.configure(next);publishPomodoro();return {ok:true,state:pomodoroTimer.snapshot()};});
  configWriteQueue=pending.catch(()=>{});
  try{return await pending;}finally{pomodoroSettingsBusy=false;}
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function readDidaCredential() {
  try {
    const encrypted = await fs.readFile(didaCredentialPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = safeStorage.decryptString(encrypted);
    const credential = JSON.parse(raw);
    if (!credential?.accessToken || typeof credential.accessToken !== 'string') return null;
    return credential;
  } catch {
    return null;
  }
}

async function writeDidaCredential(credential) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统保护不可用，无法安全保存滴答清单授权。');
  const encrypted = safeStorage.encryptString(JSON.stringify(credential));
  const destination = didaCredentialPath();
  const temporary = `${destination}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, encrypted);
  await fs.rename(temporary, destination);
}

async function readProtectedJson(filePath) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(await fs.readFile(filePath)));
  } catch { return null; }
}

async function writeProtectedJson(filePath, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统保护不可用。');
  const temporary = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)));
  await fs.rename(temporary, filePath);
}

async function didaStatus() {
  const credential = await readDidaCredential();
  const permissions = { canComplete: hasWriteScope(credential), authorizationError: didaAuthorizationError };
  if (didaAuthorization) return { state: 'authorizing', ...permissions, message: '等待你在浏览器中完成滴答清单授权。' };
  if (didaCapabilities?.error) return { state: 'error', message: `已授权，但服务连接失败：${didaCapabilities.error}` };
  if (!credential) return { state: 'unconnected', ...permissions, message: '尚未连接滴答清单。' };
  if (credential.expiresAt && Date.now() >= credential.expiresAt) return { state: 'expired', message: '滴答清单授权已过期，请重新连接。' };
  if (!didaProjects) {
    try { await loadDidaProjects(credential.accessToken); }
    catch (error) {
      didaCapabilities = { error: error.message || '无法读取官方 Open API。' };
      return { state: 'error', message: `已授权，但只读接口连接失败：${didaCapabilities.error}` };
    }
  }
  return { state: 'connected', ...permissions, message: `已连接（读取到 ${didaProjects.length} 个清单）；${permissions.canComplete ? '已启用首页完成任务。' : '当前为只读授权。'}` };
}

function createVerifier() {
  return base64url(crypto.randomBytes(48));
}

function createChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; } catch { value = { raw: text }; }
  if (!response.ok) throw new Error(value.error_description || value.error || `请求失败（${response.status}）`);
  return value;
}

async function loadDidaProjects(accessToken) {
  const response = await fetch(`${DIDA_API_URL}/project`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : []; } catch { payload = { raw }; }
  if (!response.ok) {
    const diagnostic = raw.trim().replace(/access_token[^\s,}]*/gi, 'access_token=[已隐藏]').slice(0, 240);
    throw new Error(`Open API 请求失败（${response.status}）${diagnostic ? `：${diagnostic}` : ''}`);
  }
  if (!Array.isArray(payload)) throw new Error('Open API 返回的清单格式无法识别。');
  didaProjects = payload.map((project) => ({ id: String(project.id || ''), name: String(project.name || '未命名清单'), color: project.color || null })).filter((project) => project.id);
  return didaProjects;
}

function sanitizeDidaTask(task, fallbackProjectId) {
  const checkItems = Array.isArray(task.items) ? task.items.map((item) => ({
    id: String(item.id || ''), title: String(item.title || ''), status: item.status ?? 0
  })).filter((item) => item.title) : [];
  return {
    id: String(task.id || ''), projectId: String(task.projectId || fallbackProjectId || ''), title: String(task.title || ''),
    dueDate: task.dueDate || null, startDate: task.startDate || null, timeZone: task.timeZone || null,
    isAllDay: Boolean(task.isAllDay), repeatFlag: task.repeatFlag || null, status: task.status ?? 0, checkItems
  };
}

async function loadDidaProjectData(accessToken, project) {
  const response = await fetch(`${DIDA_API_URL}/project/${encodeURIComponent(project.id)}/data`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const diagnostic = raw.trim().replace(/access_token[^\s,}]*/gi, 'access_token=[已隐藏]').slice(0, 180);
    throw new Error(`${project.name}：${response.status}${diagnostic ? ` ${diagnostic}` : ''}`);
  }
  const source = Array.isArray(payload) ? payload : Array.isArray(payload.tasks) ? payload.tasks : [];
  return source.map((task) => sanitizeDidaTask(task, project.id)).filter((task) => task.id && task.title);
}

async function didaDashboard() {
  const credential = await readDidaCredential();
  const cached = await readProtectedJson(didaCachePath());
  if (!credential) return cached ? { ...cached, source: 'cache', message: '未连接，正在显示加密离线缓存。' } : { source: 'none', projects: [], tasks: [], message: '尚未连接滴答清单。' };
  if (credential.expiresAt && Date.now() >= credential.expiresAt) return cached ? { ...cached, source: 'cache', message: '授权已过期，正在显示加密离线缓存。' } : { source: 'expired', projects: [], tasks: [], message: '授权已过期。' };
  try {
    if (!didaProjects) await loadDidaProjects(credential.accessToken);
    const settled = await Promise.allSettled(didaProjects.map(async (project) => ({ project, tasks: await loadDidaProjectData(credential.accessToken, project) })));
    const successful = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    const failed = settled.filter((item) => item.status === 'rejected').map((item) => item.reason?.message || '未知错误');
    const failedProjectIds = settled.flatMap((item, index) => item.status === 'rejected' ? [didaProjects[index]?.id].filter(Boolean) : []);
    if (!successful.length) throw new Error(failed[0] || '所有清单读取失败。');
    const fetchedAt = new Date().toISOString();
    const dashboard = { fetchedAt, lastSuccessfulAt: failed.length ? cached?.lastSuccessfulAt || cached?.fetchedAt || null : fetchedAt, projects: didaProjects, tasks: successful.flatMap((item) => item.tasks), source: failed.length ? 'partial' : 'live', failedCount: failed.length, failedProjectIds, message: failed.length ? `已读取 ${successful.length}/${didaProjects.length} 个清单；${failed.length} 个清单暂时不可用。` : `已同步 ${didaProjects.length} 个清单。` };
    const confirmed = taskCompletion.reconcile(dashboard);
    if (!failed.length) await writeProtectedJson(didaCachePath(), confirmed);
    return confirmed;
  } catch (error) {
    if (cached) return { ...cached, source: 'cache', message: `实时同步失败，正在显示加密离线缓存：${error.message}` };
    return { source: 'error', projects: didaProjects || [], tasks: [], message: `同步失败：${error.message}` };
  }
}

function getDidaStatus() {
  if(!didaStatusFlight)didaStatusFlight=didaStatus().finally(()=>{didaStatusFlight=null;});
  return didaStatusFlight;
}

function getDidaDashboard() {
  if(!didaDashboardFlight){
    const startedAt=process.hrtime.bigint();
    didaDashboardFlight=queueDidaOperation(async () => {
      const dashboard = await didaDashboard();
      const elapsed=Math.round(Number(process.hrtime.bigint()-startedAt)/1e6);
      if(firstDidaDashboardDurationMs===null)firstDidaDashboardDurationMs=elapsed;
      lastDidaDashboardDurationMs=elapsed;
      latestDidaDashboard = { ...taskCompletion.reconcile(dashboard), revision: didaRevision };
      return latestDidaDashboard;
    }).finally(()=>{didaDashboardFlight=null;});
  }
  return didaDashboardFlight;
}

async function registerDidaClient(redirectUri, scope = 'tasks:read') {
  return requestJson(DIDA_REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: '个人首页 Windows 本地软件',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope
    })
  });
}

function replyCallback(response, title, detail) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px 'Microsoft YaHei',sans-serif;padding:42px;color:#2e302d"><h2>${title}</h2><p>${detail}</p><p>现在可以关闭此页面，回到“个人首页”。</p></body>`);
}

async function beginDidaAuthorization(write = false) {
  if (didaAuthorization) return { started: false, message: '授权窗口已打开，请在浏览器中完成操作。' };
  if (taskCompletionFlights.size) return { started: false, message: '请等待任务完成操作结束后再授权。' };
  const oldCredential = await readDidaCredential();
  const scope = write === true || hasWriteScope(oldCredential) ? 'tasks:read tasks:write' : 'tasks:read';
  didaAuthorizationError = '';
  let server;
  try {
    const verifier = createVerifier();
    const state = base64url(crypto.randomBytes(24));
    server = http.createServer(async (request, response) => {
      const callback = new URL(request.url, 'http://127.0.0.1');
      if (callback.pathname !== '/oauth/callback') { response.writeHead(404); response.end(); return; }
      const code = callback.searchParams.get('code');
      if (!code || callback.searchParams.get('state') !== state) {
        replyCallback(response, '授权未完成', '状态校验失败或授权被取消。');
        server.close(); didaAuthorization = null; return;
      }
      replyCallback(response, '授权已收到', '正在核对权限与连接，完成后请回到首页查看结果。');
      try {
        const token = await requestJson(DIDA_TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: didaAuthorization.clientId, code, redirect_uri: didaAuthorization.redirectUri, code_verifier: verifier }).toString()
        });
        if (!token.access_token) throw new Error('授权服务没有返回访问令牌。');
        const credential = { accessToken: token.access_token, expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : null, scope: token.scope || scope };
        if (scope.includes('tasks:write') && !hasWriteScope(credential)) throw new Error('本次未授予完成任务权限；原有授权仍保留。');
        await loadDidaProjects(token.access_token);
        await writeDidaCredential(credential);
        didaCapabilities = null;
        didaAuthorizationError = '';
      } catch (error) {
        didaAuthorizationError = '授权升级未完成，原有授权仍保留。请检查浏览器授权结果后重试。';
      } finally {
        didaAuthorization = null;
        server.close();
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const registration = await registerDidaClient(redirectUri, scope);
    if (!registration.client_id) throw new Error('滴答清单未返回 OAuth 客户端标识。');
    didaAuthorization = { clientId: registration.client_id, redirectUri };
    const url = new URL(DIDA_AUTHORIZE_URL);
    url.search = new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: redirectUri, scope, resource: DIDA_MCP_URL, state, code_challenge: createChallenge(verifier), code_challenge_method: 'S256' }).toString();
    await shell.openExternal(url.toString());
    setTimeout(() => {
      if (didaAuthorization?.clientId === registration.client_id) {
        didaAuthorization = null;
        if (server.listening) server.close();
      }
    }, 10 * 60 * 1000).unref();
    return { started: true };
  } catch (error) {
    didaAuthorization = null;
    if (server?.listening) server.close();
    return { started: false, message: error.message || '无法开始滴答清单授权。' };
  }
}

async function disconnectDida() {
  if (taskCompletionFlights.size) return { ok: false, message: '任务正在同步完成，请稍后再断开。' };
  await didaOperationTail;
  didaCapabilities = null;
  didaProjects = null;
  latestDidaDashboard = null;
  taskCompletion.clear();
  try { await fs.unlink(didaCredentialPath()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.unlink(didaCachePath()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ok: true };
}

function completeDidaTask(projectId, taskId, expectedOccurrence, itemId=null, expectedItem=null) {
  const key = JSON.stringify([projectId, taskId,itemId]);
  if (!taskCompletionFlights.has(key)) taskCompletionFlights.set(key, queueDidaOperation(async () => {
    if (didaAuthorization) return { ok: false, code: 'authorizing', message: '请先完成浏览器授权。' };
    const result = itemId===null?await taskCompletion.complete(projectId, taskId, expectedOccurrence):await checkItemCompletion.complete(projectId,taskId,itemId,expectedOccurrence,expectedItem);
    if (!result.ok) return result;
    didaRevision++;
    if(itemId!==null){
      const task=sanitizeDidaTask(result.task,projectId);
      const patch=dashboard=>({...dashboard,tasks:(dashboard?.tasks||[]).map(value=>value.id===taskId&&value.projectId===projectId?task:value),revision:didaRevision});
      latestDidaDashboard=patch(latestDidaDashboard);
      let warning='';try{const cached=await readProtectedJson(didaCachePath());if(cached)await writeProtectedJson(didaCachePath(),patch(cached));}catch{warning='小项已确认完成，但离线缓存未更新，请联网刷新。';}
      return {ok:true,alreadyCompleted:result.alreadyCompleted===true,dashboard:latestDidaDashboard,warning};
    }
    latestDidaDashboard = { ...taskCompletion.reconcile(latestDidaDashboard), revision: didaRevision };
    let warning = '';
    try {
      const cached = await readProtectedJson(didaCachePath());
      if (cached) await writeProtectedJson(didaCachePath(), taskCompletion.reconcile(cached));
    } catch { warning = '任务已完成，但离线缓存未能更新；请联网刷新。'; }
    try {
      const refreshed = taskCompletion.reconcile(await didaDashboard());
      latestDidaDashboard = { ...refreshed, revision: didaRevision };
      if (!['live', 'partial'].includes(refreshed.source)) warning = warning || '完成已同步，最新安排暂未读到；重复任务请联网刷新查看下一次安排。';
    } catch { warning = warning || '任务已完成，最新安排读取失败；请刷新核对。'; }
    return { ...result, dashboard: latestDidaDashboard, warning };
  }).finally(() => taskCompletionFlights.delete(key)));
  return taskCompletionFlights.get(key);
}

function showHomepage() {
  if (trialWindow && !trialWindow.isDestroyed()) {
    revealWhenReady(trialWindow, 'focus');
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow('focus');
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  revealWhenReady(mainWindow, 'focus');
}

function currentUiWindow() {
  if (trialWindow && !trialWindow.isDestroyed()) return trialWindow;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const inDesktopTrial = Boolean(trialWindow && !trialWindow.isDestroyed());
  const items = [
    { label: '打开首页', click: showHomepage },
    { label: musicState.playing ? `暂停音乐${musicState.title ? ` · ${musicState.title}` : ''}` : '播放音乐', enabled: Boolean(musicState.title), click: () => { const win = currentUiWindow(); if (win && !win.isDestroyed()) win.webContents.send('music:command', musicState.playing ? 'pause' : 'play'); } },
    { label: '返回普通窗口', enabled: inDesktopTrial, click: () => requestUiTransition('return-home') },
    { label: '结束桌面试验', enabled: inDesktopTrial, click: () => requestUiTransition('end-trial') },
    { type: 'separator' },
    { label: '退出个人首页', click: () => requestUiTransition('quit') }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

async function requestUiTransition(action) {
  let win = currentUiWindow();
  if (!win) {
    if (action === 'quit') { isQuitting = true; app.quit(); return; }
    showHomepage();
    win = currentUiWindow();
  }
  if (!win || win.isDestroyed()) return;
  if (win === mainWindow) showHomepage();
  else { win.show(); win.focus(); }
  const send = () => { if (!win.isDestroyed()) win.webContents.send('app:request-transition', action); };
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send);
  else send();
}

async function performTransition(action) {
  if(pomodoroSettingsBusy)return {ok:false,error:'番茄钟设置正在保存或恢复，请稍候再切换窗口或退出。'};
  if(aiCreating)return {ok:false,error:'任务正在创建，请等待结果后再切换窗口或退出。'};
  if(aiController)aiController.abort();
  if (action === 'enter-desktop') return enterDesktopTrial();
  if (action === 'return-home') {
    const result=await exitDesktopTrial(true);
    if(!result.ok)notifyWindow(currentUiWindow(),result.error||'桌面试验未能正常恢复。');
    return result;
  }
  if (action === 'end-trial') {
    const result=await exitDesktopTrial(false);
    if(!result.ok)await dialog.showMessageBox({type:'warning',title:'个人首页桌面试验',message:result.error||'桌面试验未能正常恢复。'});
    return result;
  }
  if (action === 'quit') {
    isQuitting = true;
    app.quit();
    return { ok: true };
  }
  return { ok: false, error: '未知的页面切换操作。' };
}

function notifyWindow(win,message){
  if(!win||win.isDestroyed())return;
  const send=()=>{if(!win.isDestroyed())win.webContents.send('app:notice',message);};
  if(win.webContents.isLoadingMainFrame())win.webContents.once('did-finish-load',send);else send();
}

function dialogParentWindow() {
  if (trialWindow && !trialWindow.isDestroyed()) return trialWindow;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return undefined;
}

const execFileAsync = promisify(execFile);
async function desktopBridge(action, window, previous = null, timeoutMs = 8000) {
  const bytes = window.getNativeWindowHandle();
  const handle = bytes.length >= 8 ? Number(bytes.readBigUInt64LE()) : bytes.readUInt32LE();
  const bridge = path.join(__dirname, 'desktop-bridge.ps1');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',bridge,'-WindowHandle',String(handle),'-Action',action];
  if (previous) args.push('-Owner',String(previous.owner),'-TopMost',String(previous.topMost));
  try {
    const { stdout } = await execFileAsync(powershell,args,{windowsHide:true,timeout:timeoutMs,maxBuffer:4096});
    const result=JSON.parse(stdout.trim());
    if(!result.ok)throw new Error('窗口层操作未通过核验。');
    return result;
  } catch(error) {
    throw new Error(String(error.stderr||error.message||'桌面窗口操作失败。').replace(/[\\r\\n]+/g,' ').slice(0,300));
  }
}

async function createTrialWindow() {
  if(trialWindow&&!trialWindow.isDestroyed())return trialWindow;
  const area=screen.getPrimaryDisplay().workArea;
  const window=new BrowserWindow({x:area.x,y:area.y,width:area.width,height:area.height,resizable:false,frame:false,transparent:true,backgroundColor:'#00000000',show:false,skipTaskbar:true,alwaysOnTop:false,hasShadow:false,title:'个人首页 · 桌面试验',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  trialWindow=window;
  window.on('show', () => requestCalendarCheck(window));
  window.on('close',(event)=>{
    if(!destroyingTrial&&!isQuitting){event.preventDefault();void requestUiTransition('end-trial');}
  });
  const pageId = window.webContents.id;
  window.on('closed',()=>{forgetPageReady(pageId);if(trialWindow===window)trialWindow=null;trialAttachment=null;destroyingTrial=false;stopDesktopMonitoring();updateTrayMenu();});
  window.webContents.on('did-start-loading',()=>clearPageReady(window));
  window.webContents.on('render-process-gone',()=>{void recoverFromDesktopTrial('首页页面意外停止，已恢复普通窗口。');});
  await window.loadFile(path.join(__dirname,'src','index.html'),{query:{desktop:'1'}});
  return window;
}

function updateTrialBounds() {
  if(!trialWindow||trialWindow.isDestroyed())return;
  const display=screen.getPrimaryDisplay();
  const area=display.workArea;
  trialWindow.setBounds({x:area.x,y:area.y,width:area.width,height:area.height});
}

function startDesktopMonitoring() {
  stopDesktopMonitoring();
  const check=async()=>{
    if(desktopProbeInFlight||!trialWindow||trialWindow.isDestroyed()||!trialAttachment)return;
    desktopProbeInFlight=true;
    try{
      const result=await desktopBridge('probe',trialWindow);
      if(!result.attached)await recoverFromDesktopTrial('检测到 Windows 桌面已重启或连接变化，个人首页已退回普通窗口。');
    }catch{
      await recoverFromDesktopTrial('无法确认 Windows 桌面连接状态，个人首页已退回普通窗口。');
    }finally{desktopProbeInFlight=false;}
  };
  desktopProbeCallback=check;
  desktopProbeTimer=setInterval(check,30000);
  const onDisplayChange=()=>{updateTrialBounds();void check();};
  screen.on('display-metrics-changed',onDisplayChange);
  screen.on('display-added',onDisplayChange);
  screen.on('display-removed',onDisplayChange);
  desktopProbeCallback.onDisplayChange=onDisplayChange;
  powerMonitor.on('resume',check);
  void check();
}

function stopDesktopMonitoring() {
  if(desktopProbeTimer){clearInterval(desktopProbeTimer);desktopProbeTimer=null;}
  if(desktopProbeCallback){
    screen.removeListener('display-metrics-changed',desktopProbeCallback.onDisplayChange);
    screen.removeListener('display-added',desktopProbeCallback.onDisplayChange);
    screen.removeListener('display-removed',desktopProbeCallback.onDisplayChange);
    powerMonitor.removeListener('resume',desktopProbeCallback);
    desktopProbeCallback=null;
  }
}

async function recoverFromDesktopTrial(message) {
  if(desktopRecovering||trialExiting||!trialWindow||trialWindow.isDestroyed())return;
  desktopRecovering=true;
  try{
    if (loginStartupLaunch) await writeStartupRecovery({ pendingDesktopLaunch: false, failures: 0 });
    const result=await exitDesktopTrial(true);
    const win=mainWindow;
    if(win&&!win.isDestroyed()){
      const announce=()=>{if(!win.isDestroyed())win.webContents.send('app:notice',result.ok?message:`${message} ${result.error||''}`);};
      if(win.webContents.isLoadingMainFrame())win.webContents.once('did-finish-load',announce);else announce();
    }
  }finally{desktopRecovering=false;}
}

async function enterDesktopTrial({ automatic = false, delayMs = 0 } = {}) {
  if(trialEntering)return {ok:false,error:'桌面试验正在启动。'};
  trialEntering=true;
  let attachStartedAt=null;
  try {
    const win=await createTrialWindow();
    if (automatic) {
      const ready = await waitForLocalPage(win, 15000);
      if (!ready) throw new Error('本地首页未能在 15 秒内完成初始化。');
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else win.showInactive();
    win.setAlwaysOnTop(false);
    let result;
    if (automatic) {
      attachStartedAt=process.hrtime.bigint();
      let lastError;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          result = await desktopBridge('attach', win, null, 3000);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
      if (!result) throw lastError || new Error('Windows 桌面宿主尚未就绪。');
    } else {attachStartedAt=process.hrtime.bigint();result=await desktopBridge('attach',win);}
    desktopAttachDurationMs=Math.round(Number(process.hrtime.bigint()-attachStartedAt)/1e6);
    trialAttachment={owner:result.owner,topMost:result.topMost};
    win.showInactive();
    if(!win.isDestroyed())win.webContents.send('desktop-trial:attached',{ok:true});
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.destroy();
    mainWindow=null;
    startDesktopMonitoring();
    updateTrayMenu();
    return {ok:true};
  } catch(error) {
    if(attachStartedAt!==null)desktopAttachDurationMs=Math.round(Number(process.hrtime.bigint()-attachStartedAt)/1e6);
    if(trialWindow&&!trialWindow.isDestroyed()){trialWindow.hide();destroyingTrial=true;trialWindow.destroy();}
    if (!automatic) { mainWindow?.show();mainWindow?.focus(); }
    updateTrayMenu();
    return {ok:false,error:error.message||'桌面绑定失败，已回到普通首页。'};
  } finally { trialEntering=false; }
}

async function exitDesktopTrial(showHome=true) {
  if(trialExiting)return {ok:false,error:'桌面试验正在结束。'};
  trialExiting=true;
  stopDesktopMonitoring();
  try{
    const win=trialWindow;
    if(win&&!win.isDestroyed()){
      if(trialAttachment){
        try{await desktopBridge('restore',win,trialAttachment);}
        catch(error){win.hide();destroyingTrial=true;win.destroy();trialWindow=null;trialAttachment=null;if(showHome)showHomepage();updateTrayMenu();return {ok:false,error:error.message||'桌面卡片已关闭，桌面将由 Windows 接管。'};}
      }
      win.hide();destroyingTrial=true;win.destroy();
    }
    trialWindow=null;trialAttachment=null;
    if (loginStartupLaunch) await writeStartupRecovery({ pendingDesktopLaunch: false, failures: 0 });
    if(showHome)showHomepage();
    updateTrayMenu();
    return {ok:true};
  }finally{trialExiting=false;}
}

function createWindow(showMode = 'focus') {
  if(mainWindow&&!mainWindow.isDestroyed())return mainWindow;
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 580,
    show: false,
    backgroundColor: '#e4ddd0',
    title: runtime.preview?'个人首页 · 免安装测试版':'个人首页',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow=window;
  window.on('show', () => requestCalendarCheck(window));
  window.webContents.on('did-start-loading',()=>clearPageReady(window));
  window.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (showMode) pendingWindowReveals.set(window.webContents.id, showMode);
  window.once('ready-to-show',()=>{
    if (showMode === 'focus' && !window.isDestroyed()) window.show();
  });
  const pageId = window.webContents.id;
  window.on('closed',()=>{forgetPageReady(pageId);if(mainWindow===window)mainWindow=null;updateTrayMenu();});
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  return window;
}

function createTray() {
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#547265"/><path d="M8 16.5 16 9l8 7.5v7a2 2 0 0 1-2 2h-4v-6h-4v6h-4a2 2 0 0 1-2-2z" fill="#fffdf9"/></svg>'
  ).toString('base64')}`);
  tray = new Tray(icon);
  tray.setToolTip(runtime.preview?'个人首页 · 免安装测试版':'个人首页');
  updateTrayMenu();
  tray.on('click', showHomepage);
}

function notifyAfterLocalReady(window, message) {
  if (!window || window.isDestroyed()) return;
  void waitForLocalPage(window, 15000).then((ready) => {
    if (ready && !window.isDestroyed()) window.webContents.send('app:notice', message);
  });
}

async function launchAtLogin() {
  const preferences = await readStartupPreferences();
  if (preferences.mode !== 'desktop') {
    const window = createWindow(null);
    const ready = await waitForLocalPage(window, 15000);
    if (preferences.delayMs) await new Promise((resolve) => setTimeout(resolve, preferences.delayMs));
    revealInactiveFallback(window, ready);
    if (!ready) notifyAfterLocalReady(window, '首页界面初始化较慢；已尝试以普通窗口恢复。');
    return;
  }

  const previous = await readStartupRecovery();
  const failures = Math.min(10, previous.failures + (previous.pendingDesktopLaunch ? 1 : 0));
  if (failures >= 2) {
    await writeStartupRecovery({ pendingDesktopLaunch: false, failures });
    const window = createWindow(null);
    const ready = await waitForLocalPage(window, 15000);
    if (preferences.delayMs) await new Promise((resolve) => setTimeout(resolve, preferences.delayMs));
    revealInactiveFallback(window, ready);
    notifyAfterLocalReady(window, '检测到桌面首页连续启动异常，本次已安全改用普通窗口。可在设置中重新保存桌面首页启动方式后再试。');
    return;
  }

  await writeStartupRecovery({ pendingDesktopLaunch: true, failures });
  const result = await enterDesktopTrial({ automatic: true, delayMs: preferences.delayMs });
  if (result.ok) return;
  await writeStartupRecovery({ pendingDesktopLaunch: false, failures: failures + 1 });
  const window = createWindow(null);
  const ready = await waitForLocalPage(window, 15000);
  revealInactiveFallback(window, ready);
  notifyAfterLocalReady(window, `桌面首页未能连接（${result.error || '桌面宿主尚未就绪'}），已安全打开普通窗口；不会反复抢占焦点。`);
}

async function getStartupSettings() {
  if(runtime.preview)return {supported:false,registered:false,enabled:false,state:'preview',message:'免安装测试版使用独立数据；暂不读取或改写原版登录启动项。',preferences:await readStartupPreferences()};
  return { ...await startupAdapter.read(), preferences: await readStartupPreferences() };
}

async function applyStartupSettings(value = {}) {
  if(runtime.preview)return {...await getStartupSettings(),ok:false,error:'免安装测试版暂不写入登录启动项；原版设置未改变。'};
  const preferences = await writeStartupPreferences(value);
  const before = await startupAdapter.read();
  const change = decideLoginItemChange(before, Boolean(value.enabled));
  if (change === 'unknown') {
    return { ...before, ok: false, error: '启动方式和延迟已保存，但 Windows 启动项状态未知；为避免覆盖状态，本次未修改启动项。', preferences, preferencesSaved: true };
  }
  let registration = { ok: true, ...before };
  if (change === 'mismatch') {
    registration = { ...before, ok: false, error: '检测到现有启动项的程序路径或参数不一致；本次未改动启动项。请关闭并应用后，再明确开启。' };
  }
  // A disabled item remains visibly selected; do not silently re-enable a Windows-disabled item.
  if (change === 'change') registration = await startupAdapter.setEnabled(Boolean(value.enabled));
  if (registration.ok) await writeStartupRecovery({ pendingDesktopLaunch: false, failures: 0 });
  return { ...registration, preferences, preferencesSaved: true };
}

function setHotkey(accelerator) {
  if(runtime.isolatedTest)return {ok:true,accelerator:''};
  const normalized = String(accelerator || '').trim();
  const previous = registeredHotkey;
  globalShortcut.unregisterAll();
  registeredHotkey = '';
  if (!normalized) return { ok: true, accelerator: '' };
  const ok = globalShortcut.register(normalized, showHomepage);
  if (ok) registeredHotkey = normalized;
  if (!ok && previous && globalShortcut.register(previous, showHomepage)) registeredHotkey = previous;
  return ok ? { ok: true, accelerator: normalized } : { ok: false, message: '这个快捷键已被其他程序或系统占用；原快捷键已保留。' };
}

function isForbiddenPath(candidate) {
  const normalized = path.win32.normalize(String(candidate || '')).replace(/\\+$/, '').toLowerCase();
  const forbiddenRoot = 'd:\\k science\\r 软件资料'.toLowerCase();
  return normalized === forbiddenRoot || normalized.startsWith(`${forbiddenRoot}\\`);
}

async function containsSymlinkSegment(candidate) {
  const normalized = path.win32.normalize(String(candidate || ''));
  const parsed = path.win32.parse(normalized);
  let current = parsed.root;
  for (const part of normalized.slice(parsed.root.length).split('\\').filter(Boolean)) {
    current = path.win32.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return true;
    } catch {
      break;
    }
  }
  return false;
}

async function hasUnsafeConfiguredPath(config) {
  const candidates = [];
  for (const item of Object.values(config?.library || {})) {
    if (item?.target && item.kind !== 'website') candidates.push(item.target);
  }
  for (const track of Array.isArray(config?.music?.tracks) ? config.music.tracks : []) {
    if (track?.target) candidates.push(track.target);
  }
  if (config?.appearance?.wallpaper) candidates.push(config.appearance.wallpaper);
  for (const candidate of candidates) {
    if (isForbiddenPath(candidate) || await containsSymlinkSegment(candidate)) return true;
  }
  return false;
}

function entryLabel(kind) {
  return { application: '应用', file: '文件', folder: '文件夹', website: '网站' }[kind] || '入口';
}

async function chooseLocalEntry(kind) {
  if (!['application', 'file', 'folder'].includes(kind)) return { error: '请先选择本机应用、文件或文件夹。' };
  const folder = kind === 'folder';
  const filters = kind === 'application'
    ? [{ name: 'Windows 应用', extensions: ['exe'] }]
    : [{ name: '所有文件', extensions: ['*'] }];
  const result = await dialog.showOpenDialog(dialogParentWindow(), {
    title: folder ? '选择一个文件夹' : `选择一个${entryLabel(kind)}`,
    properties: [folder ? 'openDirectory' : 'openFile'],
    filters
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selected = result.filePaths[0];
  if (isForbiddenPath(selected)) {
    return { error: '此路径位于受保护的数据区域，个人首页不会读取、保存或打开它。' };
  }
  if (/\.lnk$/i.test(selected)) {
    return { error: '为避免通过快捷方式间接访问受保护数据，本版本不打开 .lnk 快捷方式。请选择应用本身、文件、文件夹或网站。' };
  }
  if (await containsSymlinkSegment(selected)) {
    return { error: '为避免通过链接间接访问受保护数据，本版本不使用包含符号链接或目录联接的路径。' };
  }
  const checked = await validateEntry({ kind, target: selected });
  if (!checked.ok) return { error: checked.error };
  return { canceled: false, target: checked.target, kind };
}

async function chooseAudioFiles() {
  const result = await dialog.showOpenDialog(dialogParentWindow(), {
    title: '选择本地音频（可多选）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音频文件', extensions: ['mp3','wav','m4a','aac','ogg','flac','webm'] }]
  });
  if (result.canceled) return { canceled: true, files: [] };
  const files = [];
  for (const selected of result.filePaths) {
    if (isForbiddenPath(selected) || /\.lnk$/i.test(selected) || await containsSymlinkSegment(selected)) continue;
    const checked = await validateEntry({ kind: 'file', target: selected });
    if (!checked.ok) continue;
    files.push({ target: checked.target, name: path.basename(checked.target) });
  }
  if (!files.length) return { canceled: false, files: [], error: '没有可用的音频文件；受保护、链接或失效路径不会被加入。' };
  return { canceled: false, files };
}

async function getConfiguredAudioTrack(trackId) {
  if (typeof trackId !== 'string' || !trackId || trackId.length > 180) return null;
  const loaded = await readConfig();
  const tracks = loaded?.config?.music?.tracks;
  const track = Array.isArray(tracks) ? tracks.find(item => item?.id === trackId) : null;
  if (!track || typeof track.target !== 'string') return null;
  const checked = await validateEntry({ kind: 'file', target: track.target });
  return checked.ok ? checked.target : null;
}

async function chooseWallpaper() {
  const result = await dialog.showOpenDialog(dialogParentWindow(), {
    title: '选择个人首页壁纸',
    properties: ['openFile'],
    filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selected = result.filePaths[0];
  if (isForbiddenPath(selected) || await containsSymlinkSegment(selected)) {
    return { error: '此图片位于受保护的数据区域或链接路径，个人首页不会使用它。' };
  }
  try {
    if (!(await fs.stat(selected)).isFile()) return { error: '请选择一张图片文件。' };
  } catch {
    return { error: '无法读取所选图片。' };
  }
  return { canceled: false, target: selected };
}

async function launchEntry(entry) {
  const result = await launchValidatedEntry(entry, shell);
  if (!result.ok) return result;
  // Launching an entry only hands the target to Windows. In ordinary-window
  // mode the homepage must remain a normal taskbar window; in desktop mode the
  // attached surface must also be left untouched. Hiding is an explicit action
  // handled solely by app:hide / the tray button.
  return { ok: true, launchRequested: true, targetWindowVerified: false, homepageDisposition: 'unchanged' };
}

async function getConfiguredEntryById(entryId) {
  if (typeof entryId !== 'string' || !entryId || entryId.length > 160) return null;
  try {
    const config = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    if (!isConfigShape(config) || containsForbiddenReference(config)) return null;
    return config.library[entryId] || null;
  } catch { return null; }
}

async function copyConfiguredFolderPath(entryId) {
  const item = await getConfiguredEntryById(entryId);
  if (!item || item.kind !== 'folder') return { ok: false, error: '只允许复制已保存的文件夹入口路径。' };
  const checked = await validateEntry(item);
  if (!checked.ok) return { ok: false, error: checked.error || '文件夹路径无效或不可访问。' };
  try {
    clipboard.writeText(checked.target);
    return { ok: true };
  } catch {
    return { ok: false, error: '无法复制文件夹路径。' };
  }
}

const resolveEntryIcon = createEntryIconResolver({ app, getEntryById: getConfiguredEntryById, validateEntry });

app.setAppUserModelId(runtime.appId);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_event, commandLine) => {
  if (commandLine.includes(STARTUP_ARGUMENT)) return;
  if (loginStartupInProgress) { manualWakeDuringLoginStartup = true; return; }
  showHomepage();
});
app.whenReady().then(async () => {
  protocol.handle('home-audio', async (request) => {
    try {
      const url = new URL(request.url);
      const trackId = decodeURIComponent(url.pathname.replace(/^\/track\//, ''));
      const target = await getConfiguredAudioTrack(trackId);
      if (!target) return new Response('Audio not available', { status: 404 });
      return net.fetch(pathToFileURL(target).href, { headers: request.headers });
    } catch {
      return new Response('Audio request failed', { status: 404 });
    }
  });
  ipcMain.on('app:page-ready', localPageReadyFor);
  ipcMain.handle('calendar:state', () => calendarSession);
  ipcMain.on('calendar:state', (event, value) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow !== mainWindow && senderWindow !== trialWindow) return;
    if (value?.follow === true) calendarSession = null;
    else if (value?.follow === false && validCalendarDay(value.cursor) && validCalendarDay(value.selected)) {
      calendarSession = { follow: false, cursor: value.cursor, selected: value.selected };
    }
  });
  powerMonitor.on('resume', () => {
    requestCalendarCheck(mainWindow);
    requestCalendarCheck(trialWindow);
    pomodoroTimer.snapshot(true);publishPomodoro();
  });
  ipcMain.handle('config:load', readConfig);
  const localAssistant = handler => async(event,...args) => {
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||(win!==mainWindow&&win!==trialWindow))return {ok:false,message:'此窗口无权限。'};
    try{return await handler(...args);}catch{return {ok:false,message:'操作失败，未确认成功，请重试或核对结果。'};}
  };
  ipcMain.handle('codex-quota:read',localAssistant(async force=>({...await quotaService.read(force===true),build:BUILD_ID})));
  pomodoroSettings=pomodoro.normalizeSettings((await readConfig()).config?.pomodoroSettings);
  pomodoroTimer.configure(pomodoroSettings);
  pomodoroInterval=setInterval(()=>pomodoroTimer.snapshot(),1000);
  ipcMain.handle('pomodoro:state',localAssistant(()=>pomodoroTimer.snapshot()));
  ipcMain.handle('pomodoro:command',localAssistant(action=>{if(pomodoroSettingsBusy)return {ok:false,message:'正在保存时长，请稍候。'};const state=pomodoroTimer.command(action);publishPomodoro();return {ok:true,state};}));
  ipcMain.handle('pomodoro:settings',localAssistant(async value=>{try{return await savePomodoroSettings(value);}catch(error){return {ok:false,message:error.message==='专注需为1～120分钟，休息需为1～30分钟的整数。'?error.message:'时长保存失败，原设置已保留。'};}}));
  ipcMain.handle('assistant:status',localAssistant(aiStatus));
  ipcMain.handle('assistant:settings',localAssistant(aiSaveSettings));
  ipcMain.handle('assistant:generate',localAssistant(aiGenerate));
  ipcMain.handle('assistant:test',localAssistant(async()=>{
    if(aiController||aiCreating)return {ok:false,message:'请等当前请求结束。'};
    const controller=new AbortController();aiController=controller;
    try{const saved=await readProtectedJson(aiCredentialPath());return await assistant.generate({key:saved?.key,model:saved?.model||assistant.MODELS[0],input:'仅做连接测试，请回复连接成功，不生成任务。',scene:'连接测试',projects:[],signal:controller.signal});}
    finally {if(aiController===controller)aiController=null;}
  }));
  ipcMain.handle('assistant:cancel',localAssistant(()=>{aiController?.abort();return {ok:true};}));
  ipcMain.handle('assistant:create',localAssistant(aiCreate));
  ipcMain.handle('assistant:session',localAssistant(async()=>({...aiSession,uncertain:(await aiSubmissionState()).uncertain})));
  ipcMain.on('assistant:input',(event,value)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if((win===mainWindow||win===trialWindow)&&typeof value==='string')aiSession.input=value.slice(0,2000);
  });
  ipcMain.on('assistant:preview',(event,value)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(win===mainWindow||win===trialWindow)aiUpdatePreview(value);
  });
  ipcMain.handle('assistant:clear',localAssistant(()=>{
    if(aiCreating||aiController)return {ok:false,message:'请先等待请求完成或取消生成。'};
    // Keep the last-created guard even when visible history is cleared.
    aiSession={messages:[],input:'',preview:null,lastCreated:aiSession.lastCreated};aiDraft=null;return {ok:true};
  }));
  ipcMain.handle('assistant:resolve',localAssistant(async()=>{
    if(aiCreating)return {ok:false,message:'仍在提交，请稍候。'};
    // Explicit user acknowledgement, never automatic retry or guessed duplicate match.
    await writeProtectedJson(aiSubmissionPath(),{uncertain:false});aiDraft=null;aiSession.preview=null;
    return {ok:true};
  }));
  ipcMain.handle('config:save', (_event, config) => writeConfig(config));
  ipcMain.handle('config:backup', async (_event, config) => {
    config={...config,pomodoroSettings:{...pomodoroSettings}};
    if (!isConfigShape(config) || containsForbiddenReference(config) || await hasUnsafeConfiguredPath(config)) return { canceled: false, error: '当前配置格式无效或包含受保护的数据区域，未备份。' };
    const { canceled, filePath } = await dialog.showSaveDialog(dialogParentWindow(), {
      title: '备份个人首页配置',
      defaultPath: 'personal-homepage-backup.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    if(isForbiddenPath(filePath)||await containsSymlinkSegment(filePath))return {canceled:false,error:'备份路径属于受保护区域或链接路径，已拒绝访问。'};
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
    return { canceled: false };
  });
  ipcMain.handle('config:restore', async () => {
    if(pomodoroSettingsBusy||['running','paused'].includes(pomodoroTimer.snapshot().status))return {canceled:false,error:'请先重置番茄钟，再恢复配置。'};
    pomodoroSettingsBusy=true;
    try{
    const { canceled, filePaths } = await dialog.showOpenDialog(dialogParentWindow(), {
      title: '恢复个人首页配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    if(isForbiddenPath(filePaths[0])||await containsSymlinkSegment(filePaths[0]))return {canceled:false,error:'恢复路径属于受保护区域或链接路径，已拒绝访问。'};
    try {
      const config = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
      if (!isConfigShape(config) || containsForbiddenReference(config) || await hasUnsafeConfiguredPath(config)) throw new Error('Invalid config');
      const next=pomodoro.normalizeSettings(config.pomodoroSettings);
      const pending=configWriteQueue.then(async()=>{await writeConfigNow(config,next);pomodoroSettings=next;pomodoroTimer.configure(next);publishPomodoro();});configWriteQueue=pending.catch(()=>{});await pending;
      return { canceled: false, config };
    } catch {
      return { canceled: false, error: '配置恢复未成功（文件无效或写入失败）；原配置和番茄钟时长已保留。' };
    }
    }finally{pomodoroSettingsBusy=false;}
  });
  ipcMain.handle('entry:choose-local', (_event, kind) => chooseLocalEntry(kind));
  ipcMain.handle('entry:validate', (_event, entry) => validateEntry(entry));
  ipcMain.handle('entry:icon', (_event, entryId) => resolveEntryIcon(entryId));
  ipcMain.handle('wallpaper:choose', chooseWallpaper);
  ipcMain.handle('entry:launch', (_event, entry) => launchEntry(entry));
  ipcMain.handle('entry:copy-path', (_event, entryId) => copyConfiguredFolderPath(entryId));
  ipcMain.handle('audio:choose', () => chooseAudioFiles());
  ipcMain.on('music:state', (_event, value) => {
    const next = { playing: Boolean(value?.playing), title: typeof value?.title === 'string' ? value.title.slice(0, 160) : '' };
    if (next.playing === musicState.playing && next.title === musicState.title) return;
    musicState = next;
    updateTrayMenu();
  });
  ipcMain.on('music:command-result', () => updateTrayMenu());
  ipcMain.handle('audio:url', (_event, trackId) => `home-audio://track/${encodeURIComponent(String(trackId || ''))}`);
  ipcMain.handle('dida:status', getDidaStatus);
  ipcMain.handle('dida:dashboard', getDidaDashboard);
  ipcMain.handle('dida:connect', (_event, write) => beginDidaAuthorization(write === true));
  ipcMain.handle('dida:complete', (event, projectId, taskId, expectedOccurrence) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || (senderWindow !== mainWindow && senderWindow !== trialWindow)) return { ok: false, code: 'sender', message: '此窗口不能完成任务。' };
    return completeDidaTask(projectId, taskId, expectedOccurrence);
  });
  ipcMain.handle('dida:complete-item',(event,projectId,taskId,itemId,occurrence,item)=>{
    const senderWindow=BrowserWindow.fromWebContents(event.sender);
    if(!senderWindow||(senderWindow!==mainWindow&&senderWindow!==trialWindow))return {ok:false,code:'sender',message:'此窗口不能完成小项。'};
    if(typeof itemId!=='string')return {ok:false,code:'invalid',message:'小项标识无效。'};
    return completeDidaTask(projectId,taskId,occurrence,itemId,item);
  });
  ipcMain.handle('dida:disconnect', disconnectDida);
  ipcMain.handle('app:set-hotkey', (_event, accelerator) => setHotkey(accelerator));
  ipcMain.handle('app:hide', () => mainWindow?.hide());
  ipcMain.handle('app:window-state', () => ({ maximized: mainWindow?.isMaximized() || false, hotkey: registeredHotkey }));
  ipcMain.handle('app:startup-settings', getStartupSettings);
  ipcMain.handle('app:save-startup-settings', (_event, value) => applyStartupSettings(value));
  ipcMain.handle('app:about', runtimeAbout);
  ipcMain.handle('app:perform-transition', (_event, action) => performTransition(action));
  createTray();
  if (loginStartupLaunch) {
    try { await launchAtLogin(); }
    catch {
      const window = createWindow(null);
      const ready = await waitForLocalPage(window, 15000);
      revealInactiveFallback(window, ready);
      notifyAfterLocalReady(window, '登录启动初始化遇到问题，已尝试使用普通窗口恢复。');
    } finally { loginStartupInProgress = false; }
    if (manualWakeDuringLoginStartup) showHomepage();
  } else createWindow('focus');
});

app.on('will-quit', () => {quotaService.dispose();clearInterval(pomodoroInterval);globalShortcut.unregisterAll();});
app.on('before-quit',(event)=>{
  if(pomodoroSettingsBusy){event.preventDefault();isQuitting=false;notifyWindow(currentUiWindow(),'番茄钟设置正在保存或恢复，请完成后再退出。');return;}
  if (loginStartupLaunch && !startupQuitCleanupInFlight && !startupQuitCleanupDone) {
    event.preventDefault();
    startupQuitCleanupInFlight = true;
    void readStartupRecovery().then((recovery) => writeStartupRecovery({ pendingDesktopLaunch: false, failures: 0 }))
      .catch(() => {})
      .finally(() => { startupQuitCleanupInFlight = false; startupQuitCleanupDone = true; app.quit(); });
    return;
  }
  if(!trialWindow||trialWindow.isDestroyed()||!trialAttachment||quitAfterTrialRestore)return;
  event.preventDefault();quitAfterTrialRestore=true;isQuitting=true;
  void exitDesktopTrial(false).finally(()=>app.quit());
});
app.on('window-all-closed', (event) => event.preventDefault());
