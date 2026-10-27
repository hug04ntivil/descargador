// Actualizaciones de la app de escritorio a partir de los "Releases" de GitHub.
// Sin dependencias de Electron para poder probarlo con Node: main.js le pasa fetch, la carpeta
// temporal y la función que lanza el instalador.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 1 si a > b, -1 si a < b, 0 si son iguales o alguna no es una versión válida. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

const WIN_RE = /^Descargador-Setup-[\w.-]+\.exe$/i;
const MAC_RE = /^Descargador-[\w.]+-mac-(arm64|x64)\.dmg$/i;

/** Windows: Descargador-Setup-X.exe. macOS: Descargador-X-mac-arm64.dmg o -x64.dmg según el procesador. */
function pickAsset(release, platform = process.platform, arch = process.arch) {
  const assets = (release.assets || []).filter((a) => a.state !== 'uploading');
  if (platform === 'darwin') {
    const want = arch === 'arm64' ? 'arm64' : 'x64';
    return assets.find((a) => { const m = MAC_RE.exec(a.name || ''); return m && m[1].toLowerCase() === want; }) || null;
  }
  return assets.find((a) => WIN_RE.test(a.name || '')) || null;
}

class Updater extends EventEmitter {
  /**
   * @param {{currentVersion:string, repo:string, apiUrl?:string, fetchFn?:Function, tempDir:string,
   *          runInstaller:(file:string)=>void, allowAnyHost?:boolean}} opts
   *   allowAnyHost solo se usa en pruebas (servidor local); en la app real las descargas
   *   deben venir de github.com/<repo>/releases/download/.
   */
  constructor(opts) {
    super();
    this.currentVersion = opts.currentVersion;
    this.repo = opts.repo;
    this.apiUrl = opts.apiUrl || `https://api.github.com/repos/${opts.repo}/releases/latest`;
    this.fetchFn = opts.fetchFn || fetch;
    this.tempDir = opts.tempDir;
    this.runInstaller = opts.runInstaller;
    this.allowAnyHost = !!opts.allowAnyHost;
    this.platform = opts.platform || process.platform;
    this.arch = opts.arch || process.arch;
    this.pending = null;
  }

  get headers() {
    return { Accept: 'application/vnd.github+json', 'User-Agent': `Descargador/${this.currentVersion}` };
  }

  trusted(url) {
    if (this.allowAnyHost) return /^https?:\/\//i.test(url);
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith(`/${this.repo}/releases/download/`);
    } catch {
      return false;
    }
  }

  /** @returns {Promise<{status:'latest'|'available'|'error', current:string, latest?:string, notes?:string, size?:number, pageUrl?:string, message?:string}>} */
  async check() {
    const base = { current: this.currentVersion };
    try {
      const res = await this.fetchFn(this.apiUrl, { headers: this.headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) { this.pending = null; return { ...base, status: 'latest', latest: this.currentVersion }; }
      if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!parseVersion(latest)) throw new Error('La versión publicada no es válida');
      const asset = pickAsset(rel, this.platform, this.arch);
      if (!asset || compareVersions(latest, this.currentVersion) <= 0) {
        this.pending = null;
        return { ...base, status: 'latest', latest };
      }
      this.pending = { version: latest, asset, release: rel };
      return { ...base, status: 'available', latest, notes: rel.body || '', size: asset.size, pageUrl: rel.html_url };
    } catch (e) {
      return { ...base, status: 'error', message: e.message };
    }
  }

  async expectedSha(p) {
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(p.asset.digest || '');
    if (digest) return digest[1].toLowerCase();
    const sum = (p.release.assets || []).find((a) => a.name === `${p.asset.name}.sha256`);
    if (sum && this.trusted(sum.browser_download_url)) {
      const res = await this.fetchFn(sum.browser_download_url, { headers: { 'User-Agent': this.headers['User-Agent'] } });
      const m = res.ok && /\b([0-9a-f]{64})\b/i.exec(await res.text());
      if (m) return m[1].toLowerCase();
    }
    throw new Error('La versión publicada no incluye suma de verificación');
  }

  /** Descarga el instalador de la versión pendiente y comprueba su SHA-256. Devuelve la ruta. */
  async download(onProgress) {
    const p = this.pending;
    if (!p) throw new Error('No hay ninguna actualización pendiente');
    const url = p.asset.browser_download_url;
    if (!this.trusted(url)) throw new Error('La descarga no viene del repositorio oficial');
    const expected = await this.expectedSha(p);

    fs.mkdirSync(this.tempDir, { recursive: true });
    const file = path.join(this.tempDir, path.basename(p.asset.name));
    const res = await this.fetchFn(url, { headers: { 'User-Agent': this.headers['User-Agent'] } });
    if (!res.ok) throw new Error(`No se pudo descargar (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || p.asset.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (onProgress) onProgress(total ? Math.min(1, got / total) : null);
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      fs.rmSync(file, { force: true });
      throw e;
    }
    if (hash.digest('hex') !== expected) {
      fs.rmSync(file, { force: true });
      throw new Error('La descarga llegó dañada (la suma de verificación no coincide)');
    }
    return file;
  }

  async install(onProgress) {
    const file = await this.download(onProgress);
    this.runInstaller(file);
    return file;
  }
}

module.exports = { Updater, compareVersions, parseVersion, pickAsset };
