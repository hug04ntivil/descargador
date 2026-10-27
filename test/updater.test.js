// Prueba del actualizador con un servidor local que imita la API de Releases de GitHub.
// Uso: node test/updater.test.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Updater, compareVersions, pickAsset } = require('../src/updater');

// --- funciones puras ---
assert.strictEqual(compareVersions('1.2.0', '1.1.9'), 1);
assert.strictEqual(compareVersions('v1.10.0', '1.9.9'), 1);
assert.strictEqual(compareVersions('1.1.0', 'v1.1.0'), 0);
assert.strictEqual(compareVersions('1.0.9', '1.1.0'), -1);
assert.strictEqual(compareVersions('basura', '1.1.0'), 0);
assert.strictEqual(pickAsset({ assets: [{ name: 'notas.txt' }, { name: 'Descargador-Setup-1.2.0.exe' }] }, 'win32', 'x64').name, 'Descargador-Setup-1.2.0.exe');
assert.strictEqual(pickAsset({ assets: [{ name: 'otro.exe' }] }, 'win32', 'x64'), null);
{
  // macOS: cada procesador recibe su DMG; Windows ignora los DMG y Mac ignora el .exe
  const rel = { assets: [
    { name: 'Descargador-Setup-1.4.0.exe' },
    { name: 'Descargador-1.4.0-mac-x64.dmg' },
    { name: 'Descargador-1.4.0-mac-arm64.dmg' },
    { name: 'Descargador-1.4.0-mac-arm64.dmg.sha256' },
  ] };
  assert.strictEqual(pickAsset(rel, 'darwin', 'arm64').name, 'Descargador-1.4.0-mac-arm64.dmg');
  assert.strictEqual(pickAsset(rel, 'darwin', 'x64').name, 'Descargador-1.4.0-mac-x64.dmg');
  assert.strictEqual(pickAsset(rel, 'win32', 'x64').name, 'Descargador-Setup-1.4.0.exe');
  assert.strictEqual(pickAsset({ assets: [{ name: 'Descargador-Setup-1.4.0.exe' }] }, 'darwin', 'arm64'), null);
}

const installer = crypto.randomBytes(300 * 1024); // "instalador" falso
const sha = crypto.createHash('sha256').update(installer).digest('hex');

function startServer(state) {
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/api/latest') {
      if (state.status === 404) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        tag_name: state.tag, html_url: `${base}/release`, body: 'Novedades de prueba',
        assets: [
          { name: `Descargador-Setup-${state.tag.replace(/^v/, '')}.exe`, size: installer.length, state: 'uploaded',
            browser_download_url: `${base}/dl/setup.exe`, digest: state.digest === undefined ? `sha256:${sha}` : state.digest },
          { name: `Descargador-Setup-${state.tag.replace(/^v/, '')}.exe.sha256`, state: 'uploaded', browser_download_url: `${base}/dl/setup.sha256` },
        ],
      }));
    }
    if (req.url === '/dl/setup.exe') {
      res.writeHead(200, { 'Content-Length': installer.length });
      return res.end(state.corrupt ? Buffer.alloc(installer.length, 1) : installer);
    }
    if (req.url === '/dl/setup.sha256') { res.writeHead(200); return res.end(`${sha}  Descargador-Setup.exe\n`); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const state = { tag: 'v1.2.0', status: 200 };
  const server = await startServer(state);
  const base = `http://127.0.0.1:${server.address().port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'descargador-upd-'));
  let launched = null;
  const make = (current) => new Updater({
    currentVersion: current, repo: 'hug04ntivil/descargador', apiUrl: `${base}/api/latest`,
    tempDir, runInstaller: (f) => { launched = f; }, allowAnyHost: true, platform: 'win32', arch: 'x64',
  });

  // Hay versión nueva
  let up = make('1.1.0');
  let r = await up.check();
  assert.strictEqual(r.status, 'available');
  assert.strictEqual(r.latest, '1.2.0');
  assert.strictEqual(r.notes, 'Novedades de prueba');

  // Descarga + verificación + lanzamiento
  const steps = [];
  const file = await up.install((p) => steps.push(p));
  assert.ok(fs.existsSync(file), 'instalador descargado');
  assert.ok(fs.readFileSync(file).equals(installer), 'contenido idéntico');
  assert.strictEqual(launched, file, 'se lanzó el instalador');
  assert.ok(steps.length > 0 && steps[steps.length - 1] === 1, 'progreso hasta 100%');
  console.log('OK actualización disponible, descarga y verificación');

  // Sin suma en la API: usa el archivo .sha256 de la release
  state.digest = null;
  up = make('1.1.0');
  await up.check();
  fs.rmSync(file);
  await up.download();
  console.log('OK suma de verificación desde el archivo .sha256');

  // Descarga dañada: se rechaza y no queda el archivo
  state.digest = undefined;
  state.corrupt = true;
  up = make('1.1.0');
  await up.check();
  launched = null;
  await assert.rejects(() => up.install(), /dañada/);
  assert.strictEqual(launched, null, 'no se ejecuta un instalador dañado');
  assert.ok(!fs.existsSync(file), 'el archivo dañado se borra');
  console.log('OK descarga dañada rechazada');

  // Misma versión o más antigua: no hay actualización
  state.corrupt = false;
  r = await make('1.2.0').check();
  assert.strictEqual(r.status, 'latest');
  r = await make('2.0.0').check();
  assert.strictEqual(r.status, 'latest');

  // Aún no hay releases (404)
  state.status = 404;
  r = await make('1.1.0').check();
  assert.strictEqual(r.status, 'latest');

  // Error de red
  server.close();
  r = await make('1.1.0').check();
  assert.strictEqual(r.status, 'error');
  console.log('OK sin cambios / sin releases / error de red');

  // Solo se confía en github.com/<repo>/releases/download/
  const strict = new Updater({ currentVersion: '1.1.0', repo: 'hug04ntivil/descargador', tempDir, runInstaller() {} });
  assert.ok(strict.trusted('https://github.com/hug04ntivil/descargador/releases/download/v1.2.0/Descargador-Setup-1.2.0.exe'));
  assert.ok(!strict.trusted('https://github.com/otro/descargador/releases/download/v1.2.0/x.exe'));
  assert.ok(!strict.trusted('http://github.com/hug04ntivil/descargador/releases/download/v1.2.0/x.exe'));
  assert.ok(!strict.trusted('https://evil.example.com/hug04ntivil/descargador/releases/download/x.exe'));
  console.log('OK solo descargas del repositorio oficial');

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Todas las pruebas del actualizador pasaron');
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
