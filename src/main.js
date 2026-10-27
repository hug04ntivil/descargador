const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Downloader, FORMATS, DEFAULT_SETTINGS, unwrapRedirect } = require('./core');
const { watchClipboard } = require('./clipwatch');
const { Updater } = require('./updater');
const pkg = require('../package.json');

// Variables de autoprueba (solo para verificar la interfaz en desarrollo).
const SELFTEST = process.env.DESCARGADOR_SELFTEST ? JSON.parse(process.env.DESCARGADOR_SELFTEST) : null;
if (SELFTEST && SELFTEST.userData) app.setPath('userData', SELFTEST.userData);
if (SELFTEST && SELFTEST.nogpu) app.disableHardwareAcceleration();

const gotLock = SELFTEST ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Sitios cuyos enlaces se añaden solos al copiarlos (los demás se pegan a mano).
const WATCH_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|dai\.ly|facebook\.com|fb\.watch|fb\.com|soundcloud\.com|tiktok\.com|instagram\.com|instagr\.am|threads\.net|twitter\.com|x\.com|twitch\.tv|reddit\.com|redd\.it|bilibili\.com|vk\.com|rumble\.com|streamable\.com|kick\.com)$/i;

const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'bin');

// En macOS el yt-dlp incluido vive dentro del .app (firmado, y de solo lectura si se abre desde el DMG).
// Se usa una copia en la carpeta de datos del usuario para poder actualizarla con "yt-dlp -U".
// Se vuelve a copiar solo cuando cambia la versión de la app. En Windows se usa bin\yt-dlp.exe tal cual.
function prepareYtdlp() {
  if (process.platform === 'win32') return undefined;
  const bundled = path.join(binDir, 'yt-dlp');
  const dest = path.join(app.getPath('userData'), 'bin', 'yt-dlp');
  const stampFile = `${dest}.version`;
  try {
    const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
    if (!fs.existsSync(dest) || stamp !== app.getVersion()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(bundled, dest);
      fs.chmodSync(dest, 0o755);
      fs.writeFileSync(stampFile, app.getVersion());
    }
    return dest;
  } catch {
    return bundled; // si no se puede copiar, se usa el incluido (no se podrá actualizar)
  }
}
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
  return [...new Set(found.map((u) => unwrapRedirect(u.replace(/[)\].,;:!?]+$/, ''))))];
}

// ¿El usuario no está mirando la app? (minimizada, oculta o en segundo plano)
function windowHidden() {
  return !win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || !win.isFocused();
}

// Aviso de Windows: sirve para saber qué pasó con lo copiado cuando la ventana no se ve.
const liveNotifications = new Set();
function osNotify(title, body, onClick) {
  if (SELFTEST && SELFTEST.debug) fs.appendFileSync(`${SELFTEST.shot}.notifs.log`, `${title} | ${body}\n`);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  liveNotifications.add(n); // evita que se recoja antes de poder pulsarla
  n.on('click', () => { liveNotifications.delete(n); if (onClick) onClick(); });
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- actualizaciones de la app (Releases de GitHub) ----------
let updater = null;
let updateDismissed = '';

function repoFromPackage() {
  const url = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(String(url));
  return m ? m[1] : 'hug04ntivil/descargador';
}

function createUpdater() {
  // Las variables de prueba solo se respetan al ejecutar desde el código fuente, nunca en la app instalada.
  const dev = !app.isPackaged;
  const apiOverride = dev ? process.env.DESCARGADOR_UPDATE_API : '';
  updater = new Updater({
    currentVersion: app.getVersion(),
    repo: repoFromPackage(),
    apiUrl: apiOverride || undefined,
    allowAnyHost: !!apiOverride,
    fetchFn: (url, init) => net.fetch(url, init),
    tempDir: path.join(app.getPath('temp'), 'Descargador-update'),
    runInstaller: (file) => {
      if (dev && process.env.DESCARGADOR_UPDATE_DRYRUN) return;
      if (process.platform === 'darwin') {
        // La app no está firmada con un Developer ID: no se puede reemplazar sola. Se monta el DMG y el
        // usuario arrastra Descargador a Aplicaciones (el DMG verificado queda en la carpeta temporal).
        shell.openPath(file);
        return;
      }
      // El instalador cierra esta ventana, actualiza los archivos y vuelve a abrir la app (/RELAUNCH=1).
      const child = spawn(file, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/RELAUNCH=1'], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 400);
    },
  });
}

async function checkForUpdate(manual) {
  const r = await updater.check();
  if (r.status === 'available' && (manual || r.latest !== updateDismissed)) send('update:available', r);
  return r;
}

function scheduleUpdateChecks() {
  const run = () => { if (settings.autoUpdateCheck !== false) checkForUpdate(false); };
  setTimeout(run, 15000);
  setInterval(run, 12 * 60 * 60 * 1000);
}

function createDownloader() {
  downloader = new Downloader({ binDir, ytdlpPath: prepareYtdlp(), jsRuntime: process.execPath, getSettings: () => settings });
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
  downloader.on('notice', (n) => {
    send('notice', n);
    // Con la ventana minimizada el aviso interno no se ve: se repite como aviso de Windows.
    if (n.type === 'error' && windowHidden()) osNotify('No se pudo añadir el enlace', n.text, showWindow);
  });
  downloader.on('added', ({ title, count }) => {
    if (windowHidden()) osNotify('Descarga iniciada', count > 1 ? `${count} videos de «${title}»` : title, showWindow);
  });
  downloader.on('choose', (choice) => {
    send('choose', choice);
    if (windowHidden()) {
      if (win && !win.isDestroyed()) win.flashFrame(true);
      if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
      osNotify('Lista detectada', `Elige qué videos descargar de «${choice.title}»`, showWindow);
    }
  });
  downloader.on('done', (item) => {
    if (windowHidden()) osNotify('Descarga completada', item.title, () => shell.showItemInFolder(item.filepath));
  });
}

function startClipboardWatch() {
  clipWatcher = watchClipboard((text) => {
    if (SELFTEST && SELFTEST.debug) fs.appendFileSync(`${SELFTEST.shot}.clip.log`, `${Date.now()} detectado ${JSON.stringify(text.slice(0, 200))}\n`);
    for (const u of extractUrls(text)) {
      try {
        if (WATCH_HOSTS.test(new URL(u).hostname)) {
          // background: con la ventana minimizada no se puede responder a ninguna pregunta, así que un video
          // dentro de una lista (&list=...) baja solo ese video en lugar de esperar una elección.
          downloader.add(u, settings.defaultFormat, { silentFail: true, background: windowHidden(), announce: true });
        }
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
    appVersion: app.getVersion(),
  }));
  ipcMain.handle('add', (_e, text, format) => {
    const urls = extractUrls(text);
    urls.forEach((u) => downloader.add(u, format));
    return urls.length;
  });
  ipcMain.handle('app:check-update', () => checkForUpdate(true));
  ipcMain.on('app:install-update', async () => {
    try {
      await updater.install((p) => send('update:progress', p));
    } catch (e) {
      send('update:error', e.message);
    }
  });
  ipcMain.on('app:dismiss-update', (_e, version) => { updateDismissed = String(version || ''); });
  ipcMain.on('app:open-release', () => {
    const url = updater.pending && updater.pending.release.html_url;
    if (url && url.startsWith(`https://github.com/${repoFromPackage()}/`)) shell.openExternal(url);
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
  // macOS exige un menú: sin él no funcionan Cmd+C, Cmd+V ni Cmd+Q. En Windows no se muestra ninguno.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('focus', () => win.flashFrame(false));
  win.on('closed', () => { win = null; });
}

async function runSelftest() {
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 800));
  if (SELFTEST.minimize) win.minimize();
  if (SELFTEST.checkUpdate) checkForUpdate(true);
  for (const u of SELFTEST.urls || []) downloader.add(u, SELFTEST.format || 'best');
  if (SELFTEST.untilDone) {
    // Espera a que todas las descargas terminen (o fallen), con waitMs como límite.
    const deadline = Date.now() + (SELFTEST.waitMs || 60000);
    const finished = () => { const l = downloader.list(); return l.length > 0 && l.every((i) => ['done', 'error', 'canceled', 'choosing'].includes(i.status)); };
    while (Date.now() < deadline && !finished()) await new Promise((r) => setTimeout(r, 500));
  } else {
    await new Promise((r) => setTimeout(r, SELFTEST.waitMs || 6000));
  }
  if (SELFTEST.js) {
    const r = await win.webContents.executeJavaScript(SELFTEST.js);
    if (r !== undefined) fs.writeFileSync(`${SELFTEST.shot}.txt`, JSON.stringify(r));
  }
  await new Promise((r) => setTimeout(r, SELFTEST.afterMs || 600));
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
    createUpdater();
    registerIpc();
    createWindow();
    if (!SELFTEST || SELFTEST.watch) startClipboardWatch();
    if (!SELFTEST) scheduleUpdateChecks();
    if (SELFTEST) runSelftest();
  });
  app.on('before-quit', () => {
    if (!downloader) return;
    downloader.shutdown();
    try { fs.writeFileSync(queueFile(), JSON.stringify(downloader.serialize())); } catch { /* ignorar */ }
  });
  // Windows/Linux: cerrar la ventana cierra la app. macOS: la app sigue viva (sigue vigilando el portapapeles
  // y descargando) hasta Cmd+Q, y el icono del Dock vuelve a abrir la ventana.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!win || win.isDestroyed()) createWindow(); else showWindow(); });
}
