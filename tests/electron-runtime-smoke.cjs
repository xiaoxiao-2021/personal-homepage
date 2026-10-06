'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const profile = path.resolve(__dirname, '../../..', 'work/electron-runtime-smoke/profile');

async function run() {
  app.setPath('userData', profile);
  await app.whenReady();
  await fs.mkdir(profile, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`did-fail-load: ${code} ${description} ${url}`));
  win.webContents.on('render-process-gone', (_event, details) => console.error(`render-process-gone: ${JSON.stringify(details)}`));
  await win.loadURL('data:text/html,<title>Electron isolated probe</title><main id="result">ready</main>');
  const result = await win.webContents.executeJavaScript(`({title:document.title,text:document.querySelector('#result').textContent})`);
  if (result.title !== 'Electron isolated probe' || result.text !== 'ready') throw new Error(`Unexpected page result: ${JSON.stringify(result)}`);
  console.log(`Electron data-page probe passed (${process.versions.electron}; ${process.versions.chrome}). Isolated profile only; no user config or applications accessed.`);
  win.destroy();
  app.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
