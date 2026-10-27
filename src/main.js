const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Downloader, FORMATS, DEFAULT_SETTINGS } = require('./core');
const { watchClipboard } = require('./clipwatch');

// Variables de autoprueba (solo para verificar la interfaz en desarrollo).
const SELFTEST = process.env.DESCARGADOR_SELFTEST ? JSON.parse(process.env.DESCARGADOR_SELFTEST) : null;
if (SELFTEST && SELFTEST.userData) app.setPath('userData', SELFTEST.userData);
if (SELFTEST && SELFTEST.nogpu) app.disableHardwareAcceleration();

const gotLock = SELFTEST ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Sitios cuyos enlaces se añaden solos al copiarlos (los demás se pegan a mano).
const WATCH_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|dai\.ly|facebook\.com|fb\.watch|fb\.com|soundcloud\.com|tiktok\.com|instagram\.com|instagr\.am|threads\.net|twitter\.com|x\.com|twitch\.tv|reddit\.com|redd\.it|bilibili\.com|vk\.com|rumble\.com|streamable\.com|kick\.com)$/i;

const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'bin');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const queueFile = () => path.join(app.getPath('userData'), 'queue.json');

let win = null;
let settings = { ...DEFAULT_SETTINGS };
let downloader = null;
let saveTimer = null;
let clipWatcher = null;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadSettings() {
  settings = { ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) };
  if (!settings.outputDir) settings.outputDir = path.join(app.getPath('videos'), 'Descargador');
  fs.mkdirSync(settings.outputDir, { recursive: true });
}

function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function scheduleQueueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(queueFile(), JSON.stringify(downloader.serialize())); } catch { /* disco no disponible */ }
  }, 800);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Saca los enlaces de un texto; quita signos que suelen pegarse al final al copiar de un mensaje.
function extractUrls(text) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[)\].,;:!?]+$/, '')))];
}

function createDownloader() {
  downloader = new Downloader({ binDir, jsRuntime: process.execPath, getSettings: () => settings });
  downloader.restore(readJson(queueFile(), []));

  const pending = new Map();
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    if (pending.size) send('items:update', [...pending.values()]);
    pending.clear();
    send('stats', downloader.stats());
  };
  const queueFlush = () => { if (!flushTimer) flushTimer = setTimeout(flush, 120); };

  downloader.on('update', (item) => { pending.set(item.id, item); queueFlush(); scheduleQueueSave(); });
  downloader.on('remove', (id) => { pending.delete(id); send('items:remove', id); queueFlush(); scheduleQueueSave(); });
  downloader.on('stats', queueFlush);
  downloader.on('notice', (n) => send('notice', n));
  downloader.on('choose', (choice) => {
    send('choose', choice);
    if (win && !win.isDestroyed() && !win.isFocused()) {
      win.flashFrame(true);
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Lista detectada', body: `Elige qué videos descargar de «${choice.title}»` });
        n.on('click', () => { win.show(); win.focus(); });
        n.show();
      }
    }
  });
  downloader.on('done', (item) => {
    if (Notification.isSupported() && !(win && win.isFocused())) {
      const n = new Notification({ title: 'Descarga completada', body: item.title });
      n.on('click', () => shell.showItemInFolder(item.filepath));
      n.show();
    }
  });
}

function startClipboardWatch() {
  clipWatcher = watchClipboard((text) => {
    for (const u of extractUrls(text)) {
      try {
        if (WATCH_HOSTS.test(new URL(u).hostname)) downloader.add(u, settings.defaultFormat, { silentFail: true });
      } catch { /* URL inválida */ }
    }
  }, () => settings.clipboardWatch);
  if (SELFTEST && SELFTEST.debug) fs.writeFileSync(`${SELFTEST.shot}.clipmode.txt`, clipWatcher.mode);
}

function registerIpc() {
  ipcMain.handle('init', async () => ({
    items: downloader.list(),
    settings,
    formats: FORMATS,
    stats: downloader.stats(),
    ytdlpVersion: await downloader.version(),
  }));
  ipcMain.handle('add', (_e, text, format) => {
    const urls = extractUrls(text);
    urls.forEach((u) => downloader.add(u, format));
    return urls.length;
  });
  ipcMain.on('choice-confirm', (_e, id, indexes) => downloader.resolveChoice(id, Array.isArray(indexes) ? indexes : []));
  ipcMain.on('choice-single', (_e, id) => downloader.chooseSingle(id));
  ipcMain.on('choice-cancel', (_e, id) => downloader.remove(id));
  ipcMain.handle('choose-cookies-file', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'cookies.txt', extensions: ['txt'] }, { name: 'Todos', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.on('pause', (_e, id) => downloader.pause(id));
  ipcMain.on('resume', (_e, id) => downloader.resume(id));
  ipcMain.on('retry', (_e, id) => downloader.retry(id));
  ipcMain.on('remove', (_e, id) => downloader.remove(id));
  ipcMain.on('pause-all', () => downloader.pauseAll());
  ipcMain.on('resume-all', () => downloader.resumeAll());
  ipcMain.on('clear-completed', () => downloader.clearCompleted());
  ipcMain.on('show-file', (_e, file) => {
    if (file && fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(settings.outputDir);
  });
  ipcMain.on('open-file', (_e, file) => { if (file && fs.existsSync(file)) shell.openPath(file); });
  ipcMain.on('open-output', () => shell.openPath(settings.outputDir));
  ipcMain.on('open-external', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.handle('choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('save-settings', (_e, patch) => {
    settings = { ...settings, ...patch };
    settings.maxConcurrent = Math.max(1, Math.min(8, Number(settings.maxConcurrent) || 3));
    fs.mkdirSync(settings.outputDir, { recursive: true });
    saveSettings();
    downloader._pump();
    return settings;
  });
  ipcMain.handle('update-ytdlp', () => downloader.update());
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 680, minWidth: 720, minHeight: 480,
    backgroundColor: '#14161c',
    title: 'Descargador',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('focus', () => win.flashFrame(false));
}

async function runSelftest() {
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 800));
  for (const u of SELFTEST.urls || []) downloader.add(u, SELFTEST.format || 'best');
  await new Promise((r) => setTimeout(r, SELFTEST.waitMs || 6000));
  if (SELFTEST.js) {
    const r = await win.webContents.executeJavaScript(SELFTEST.js);
    if (r !== undefined) fs.writeFileSync(`${SELFTEST.shot}.txt`, JSON.stringify(r));
  }
  await new Promise((r) => setTimeout(r, 600));
  fs.writeFileSync(`${SELFTEST.shot}.items.json`, JSON.stringify(downloader.list().map((i) => ({ url: i.url, title: i.title, status: i.status, error: i.error }))));
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SELFTEST.shot, img.toPNG());
      break;
    } catch (e) {
      fs.writeFileSync(`${SELFTEST.shot}.err.txt`, `intento ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  app.exit(0);
}

if (gotLock) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    app.setAppUserModelId('cl.hugo.descargador');
    loadSettings();
    createDownloader();
    registerIpc();
    createWindow();
    if (!SELFTEST || SELFTEST.watch) startClipboardWatch();
    if (SELFTEST) runSelftest();
  });
  app.on('before-quit', () => {
    if (!downloader) return;
    downloader.shutdown();
    try { fs.writeFileSync(queueFile(), JSON.stringify(downloader.serialize())); } catch { /* ignorar */ }
  });
  app.on('window-all-closed', () => app.quit());
}
