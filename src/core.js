// Núcleo de descargas: envoltorio sobre yt-dlp, sin dependencias de Electron.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');

const FORMATS = {
  best: 'Mejor calidad (MP4)',
  2160: '4K (2160p)',
  1440: '1440p',
  1080: '1080p',
  720: '720p',
  480: '480p',
  360: '360p',
  mp3: 'Solo audio (MP3)',
  m4a: 'Solo audio (M4A)',
  original: 'Original sin conversión (MKV)',
};

const DEFAULT_SETTINGS = {
  outputDir: '',
  maxConcurrent: 3,
  speedLimit: '',
  proxy: '',
  cookiesBrowser: '',
  cookiesFile: '',
  // Qué hacer con listas: 'ask' = elegir videos, 'all' = bajar todo, 'video' = solo el video del enlace.
  playlists: 'ask',
  defaultFormat: 'best',
  subtitles: false,
  subLangs: 'es.*,en.*',
  embedMetadata: true,
  embedThumbnail: false,
  clipboardWatch: true,
  autoUpdateCheck: true,
};

const ACTIVE = new Set(['downloading', 'processing']);
const MP4_PREF = ['-S', 'res,vcodec:h264,acodec:aac'];

function formatArgs(id) {
  if (/^\d+$/.test(id)) {
    const h = id;
    return ['-f', `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`, ...MP4_PREF, '--merge-output-format', 'mp4'];
  }
  switch (id) {
    case 'mp3':
      return ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
    case 'm4a':
      return ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a', '--audio-quality', '0'];
    case 'original':
      return ['-f', 'bv*+ba/b', '--merge-output-format', 'mkv'];
    default:
      return ['-f', 'bv*+ba/b', ...MP4_PREF, '--merge-output-format', 'mp4'];
  }
}

function sanitizeDirName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstErrorLine(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => /^ERROR:/.test(l));
  if (!lines.length) return '';
  return lines[lines.length - 1].replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 300);
}

function urlKind(url) {
  return {
    hasList: /[?&]list=/i.test(url) || /\/playlist\b/i.test(url),
    hasVideo: /[?&]v=|youtu\.be\/|\/shorts\//i.test(url),
  };
}

// Un enlace con v= o youtu.be/ apunta a un video concreto aunque traiga list=.
function isSingleVideoUrl(url) {
  return urlKind(url).hasVideo && !/\/playlist\?/i.test(url);
}

function videoIdOf(url) {
  const m = /[?&]v=([\w-]{6,})/.exec(url) || /youtu\.be\/([\w-]{6,})/.exec(url) || /\/shorts\/([\w-]{6,})/.exec(url);
  return m ? m[1] : '';
}

const CLEAN_NAME_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|soundcloud\.com)$/i;

// Traduce los errores más comunes de yt-dlp a algo accionable.
function friendlyError(raw) {
  const m = String(raw || '');
  const rules = [
    [/not a bot|confirm you.re not/i, 'YouTube pide comprobar que no eres un robot. En Preferencias activa las cookies del navegador.'],
    [/cookie database|decrypt|DPAPI|could not find .*cookies|cookies? (file|from browser)/i, 'No pude leer las cookies del navegador. Ciérralo, usa Firefox o un archivo cookies.txt (Preferencias).'],
    [/empty media response|login required|requires? (a )?login|log ?in|use --cookies|--cookies-from-browser|rate-limit|restricted video|age[- ]restricted|private (video|account)|protected tweet|NSFW/i, 'Requiere iniciar sesión. En Preferencias elige las cookies de tu navegador (Firefox funciona mejor) o un archivo cookies.txt.'],
    [/Cannot parse data|Cannot find video|registered users/i, 'No pude leer ese video. Si es de Facebook o de una cuenta privada, necesita sesión: en Preferencias usa las cookies del navegador (Firefox) o un archivo cookies.txt. Si es público, prueba "Buscar actualización" de yt-dlp.'],
    [/No video could be found in this (tweet|post)|no video (formats )?found|does not contain (a )?video/i, 'Esta publicación no contiene video.'],
    [/IP address is blocked|geo.?restrict|not available in your country/i, 'El sitio bloquea tu región o IP para este contenido.'],
    [/Unsupported URL/i, 'Enlace no compatible.'],
    [/Video unavailable|has been removed|no longer available|deleted|does not exist|404/i, 'El video no está disponible (borrado o privado).'],
    [/Requested format is not available/i, 'Esa calidad no está disponible. Prueba con "Mejor calidad".'],
    [/HTTP Error 429|Too Many Requests/i, 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.'],
    [/Unable to download|getaddrinfo|timed out|Connection (reset|refused|aborted)|Network is unreachable/i, 'Sin conexión o el sitio no responde.'],
  ];
  for (const [re, text] of rules) if (re.test(m)) return text;
  return m || 'Error desconocido';
}

class Downloader extends EventEmitter {
  /**
   * @param {{binDir:string, jsRuntime?:string, getSettings:()=>object}} opts
   */
  constructor(opts) {
    super();
    this.binDir = opts.binDir;
    this.jsRuntime = opts.jsRuntime || '';
    this.getSettings = opts.getSettings;
    this.items = new Map();
    this.procs = new Map();
    this.choices = new Map();
    // Windows: bin\yt-dlp.exe. macOS/Linux: bin/yt-dlp (o la copia escribible que indique main.js).
    this.ytdlp = opts.ytdlpPath || path.join(this.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  }

  // ---------- utilidades ----------
  _env() {
    return { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  }

  _commonArgs() {
    const s = this.getSettings();
    const args = ['--no-update', '--encoding', 'utf-8', '--ffmpeg-location', this.binDir];
    if (this.jsRuntime) args.push('--js-runtimes', `node:${this.jsRuntime}`);
    if (s.proxy) args.push('--proxy', s.proxy);
    if (s.cookiesFile && fs.existsSync(s.cookiesFile)) args.push('--cookies', s.cookiesFile);
    else if (s.cookiesBrowser) args.push('--cookies-from-browser', s.cookiesBrowser);
    return args;
  }

  _emit(item) {
    this.emit('update', this.snapshot(item));
  }

  snapshot(item) {
    const out = {};
    for (const k of Object.keys(item)) if (k[0] !== '_') out[k] = item[k];
    return out;
  }

  list() {
    return [...this.items.values()].map((i) => this.snapshot(i));
  }

  serialize() {
    return this.list();
  }

  restore(list) {
    for (const raw of list || []) {
      const item = { ...raw };
      if (item.status === 'choosing') continue;
      if (ACTIVE.has(item.status) || item.status === 'queued') item.status = 'paused';
      if (item.status === 'analyzing') item.status = 'error', item.error = 'Análisis interrumpido';
      item.speed = null;
      item.eta = null;
      this.items.set(item.id, item);
    }
  }

  // ---------- análisis de URLs ----------
  _fetchInfo(url, noPlaylist) {
    return new Promise((resolve, reject) => {
      const args = [
        '-J', '--flat-playlist', '--no-warnings', '--ignore-errors',
        ...(noPlaylist ? ['--no-playlist'] : []),
        ...this._commonArgs(), url,
      ];
      const p = spawn(this.ytdlp, args, { windowsHide: true, env: this._env() });
      const out = [];
      let err = '';
      const timer = setTimeout(() => { p.kill(); reject(new Error('Tiempo de espera agotado al analizar el enlace')); }, 180000);
      p.stdout.on('data', (d) => out.push(d));
      p.stderr.on('data', (d) => { err += d.toString('utf8'); });
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', () => {
        clearTimeout(timer);
        const text = Buffer.concat(out).toString('utf8').trim();
        const fail = () => reject(new Error(firstErrorLine(err) || 'No se pudo analizar el enlace'));
        if (!text || text === 'null') return fail();
        let info;
        try { info = JSON.parse(text); } catch { return reject(new Error('Respuesta inválida de yt-dlp')); }
        if (!info || typeof info !== 'object') return fail();
        resolve(info);
      });
    });
  }

  _thumbOf(e) {
    if (e.thumbnail) return e.thumbnail;
    if (Array.isArray(e.thumbnails) && e.thumbnails.length) return e.thumbnails[e.thumbnails.length - 1].url;
    if (e.id && /youtube/i.test(e.ie_key || e.extractor_key || '')) return `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`;
    return '';
  }

  // `inline`: la entrada trae sus datos dentro de la lista (p. ej. varios videos en una
  // publicación de Instagram); se descarga con --playlist-items sobre la URL original.
  _entryToItem(e, base, idx = 0, fromPlaylist = false) {
    const inline = fromPlaylist && !e.ie_key && e._type !== 'url';
    return {
      ...base,
      url: inline ? base.sourceUrl : e.webpage_url || e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : base.url),
      playlistIndex: inline ? idx + 1 : 0,
      title: e.title || e.id || base.url,
      uploader: e.uploader || e.channel || e.uploader_id || '',
      duration: num(e.duration),
      thumbnail: this._thumbOf(e),
    };
  }

  async _resolve(url, noPlaylist, depth = 0) {
    const info = await this._fetchInfo(url, noPlaylist);
    if (info._type === 'playlist' && depth < 2) {
      let entries = (info.entries || []).filter(Boolean);
      // Canal: sus entradas son pestañas (Videos, Shorts...). Se elige "Videos".
      if (entries.length && entries.every((e) => e._type === 'playlist' || /YoutubeTab/i.test(e.ie_key || ''))) {
        const tab = entries.find((e) => /\/videos\/?$/.test(e.url || e.webpage_url || '')) || entries[0];
        return this._resolve(tab.url || tab.webpage_url, false, depth + 1);
      }
      // Se descartan los videos borrados/privados, que en la lista llegan sin título.
      entries = entries.filter((e) => !/^\[(private|deleted) video\]$/i.test(e.title || '') && !(e.ie_key && !e.title));
      return { playlist: info.title || '', entries, fromPlaylist: true };
    }
    return { playlist: '', entries: [info], fromPlaylist: false };
  }

  // ---------- cola ----------
  /**
   * @param {string} rawUrl
   * @param {string} format  id de FORMATS
   * @param {{mode?:'auto'|'video'|'all', silentFail?:boolean}} opts
   *   mode: 'video' = solo el video del enlace, 'all' = toda la lista sin preguntar.
   *   silentFail: si el análisis falla, quita la fila y avisa con un aviso (portapapeles).
   *   background: la app no se está mirando; no se hacen preguntas (un video de una lista baja solo el video).
   *   announce: emite 'added' cuando el enlace ya se añadió a la cola (para avisar con una notificación).
   */
  async add(rawUrl, format, opts = {}) {
    const url = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid' };
    for (const it of this.items.values()) {
      if (it.sourceUrl === url && !['error', 'canceled'].includes(it.status)) {
        this.emit('notice', { type: 'info', text: 'Ese enlace ya está en la lista' });
        return { ok: false, reason: 'duplicate' };
      }
    }
    const settings = this.getSettings();
    const fmt = FORMATS[format] ? format : settings.defaultFormat;
    const { hasList, hasVideo } = urlKind(url);
    let mode = opts.mode || 'auto';
    if (mode === 'auto') {
      // En segundo plano (portapapeles con la app minimizada) no se puede preguntar: se baja solo el video.
      if (hasList && hasVideo && (settings.playlists === 'video' || (opts.background && settings.playlists === 'ask'))) mode = 'video';
      else if (settings.playlists === 'all') mode = 'all';
    }
    const noPlaylist = hasVideo && (mode === 'video' || !hasList);

    const placeholder = {
      id: randomUUID(), url, sourceUrl: url, title: url, uploader: '', duration: null, thumbnail: '',
      playlist: '', playlistIndex: 0, format: fmt, status: 'analyzing', progress: 0, speed: null, eta: null,
      filepath: '', size: null, error: '', errorDetail: '', addedAt: Date.now(),
    };
    this.items.set(placeholder.id, placeholder);
    this._emit(placeholder);

    try {
      const { playlist, entries, fromPlaylist } = await this._resolve(url, noPlaylist);
      if (!this.items.has(placeholder.id)) return { ok: false, reason: 'removed' };
      if (!entries.length) throw new Error('El enlace no contiene videos');
      if (entries.length > 1 && mode !== 'all') {
        this._offerChoice(placeholder, url, playlist, entries, fromPlaylist);
        return { ok: true, choose: true };
      }
      this._materialize(placeholder, entries.map((e, i) => ({ e, i })), playlist, fromPlaylist);
      if (opts.announce) this.emit('added', { title: placeholder.title, count: entries.length });
      if (entries.length > 1) this.emit('notice', { type: 'info', text: `Lista añadida: ${entries.length} videos` });
    } catch (e) {
      const friendly = friendlyError(e.message);
      if (this.items.has(placeholder.id)) {
        if (opts.silentFail) {
          this.items.delete(placeholder.id);
          this.emit('remove', placeholder.id);
          this.emit('notice', { type: 'error', text: friendly });
        } else {
          placeholder.status = 'error';
          placeholder.error = friendly;
          placeholder.errorDetail = e.message;
          this._emit(placeholder);
        }
      }
      return { ok: false, reason: 'error', error: friendly };
    }
    this._pump();
    return { ok: true };
  }

  // Convierte las entradas elegidas en elementos de la cola (la primera reutiliza la fila).
  _materialize(placeholder, picks, playlist, fromPlaylist) {
    const url = placeholder.sourceUrl;
    const base = { ...placeholder, playlist: picks.length > 1 ? playlist : '', status: 'queued', error: '', errorDetail: '' };
    const [first, ...rest] = picks;
    Object.assign(placeholder, this._entryToItem(first.e, base, first.i, fromPlaylist), { id: placeholder.id });
    placeholder.sourceUrl = url;
    this._emit(placeholder);
    for (const p of rest) {
      const it = this._entryToItem(p.e, { ...base, id: randomUUID(), addedAt: Date.now() }, p.i, fromPlaylist);
      it.sourceUrl = it.url;
      this.items.set(it.id, it);
      this._emit(it);
    }
  }

  _offerChoice(placeholder, url, playlist, entries, fromPlaylist) {
    placeholder.status = 'choosing';
    placeholder.title = playlist || url;
    placeholder.playlist = playlist;
    placeholder.thumbnail = this._thumbOf(entries[0]);
    placeholder.uploader = `${entries.length} videos`;
    this.choices.set(placeholder.id, { url, playlist, entries, fromPlaylist });
    this._emit(placeholder);
    const vid = videoIdOf(url);
    this.emit('choose', {
      id: placeholder.id,
      title: playlist || url,
      format: placeholder.format,
      hasVideo: !!vid,
      current: vid ? entries.findIndex((e) => e.id === vid) : -1,
      entries: entries.map((e) => ({
        title: e.title || e.id || '',
        duration: num(e.duration),
        thumbnail: this._thumbOf(e),
        uploader: e.uploader || e.channel || '',
      })),
    });
  }

  /** Confirma la selección del usuario (índices dentro de la lista ofrecida). */
  resolveChoice(id, indexes) {
    const ch = this.choices.get(id);
    const ph = this.items.get(id);
    if (!ch || !ph) return;
    this.choices.delete(id);
    const picks = [...new Set(indexes)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < ch.entries.length)
      .sort((a, b) => a - b)
      .map((i) => ({ e: ch.entries[i], i }));
    if (!picks.length) { this.remove(id); return; }
    this._materialize(ph, picks, ch.playlist, ch.fromPlaylist);
    if (picks.length > 1) this.emit('notice', { type: 'info', text: `Se añadieron ${picks.length} videos` });
    this._pump();
  }

  /** "Solo este video": ignora la lista y baja únicamente el video del enlace. */
  chooseSingle(id) {
    const ch = this.choices.get(id);
    const ph = this.items.get(id);
    if (!ch || !ph) return;
    const vid = videoIdOf(ch.url);
    const idx = ch.entries.findIndex((e) => e.id === vid);
    if (idx >= 0) { this.resolveChoice(id, [idx]); return; }
    const { url } = ch;
    const { format } = ph;
    this.choices.delete(id);
    this.items.delete(id);
    this.emit('remove', id);
    this.add(url, format, { mode: 'video' });
  }

  _pump() {
    const max = Math.max(1, Math.min(8, Number(this.getSettings().maxConcurrent) || 3));
    let running = [...this.items.values()].filter((i) => ACTIVE.has(i.status)).length;
    for (const item of this.items.values()) {
      if (running >= max) break;
      if (item.status === 'queued') {
        this._start(item);
        running++;
      }
    }
    this.emit('stats');
  }

  _outputTemplate(item) {
    const s = this.getSettings();
    const root = s.outputDir;
    const dir = item.playlist ? path.join(root, sanitizeDirName(item.playlist)) : root;
    fs.mkdirSync(dir, { recursive: true });
    let host = '';
    try { host = new URL(item.url).hostname; } catch { /* sin host */ }
    // En redes sociales muchos títulos se repiten ("Video by ..."), así que se añade el id.
    const name = CLEAN_NAME_HOSTS.test(host) ? '%(title).150B.%(ext)s' : '%(title).120B [%(id)s].%(ext)s';
    return path.join(dir, name);
  }

  _buildArgs(item) {
    const s = this.getSettings();
    const args = [
      '--newline', '--no-colors', '--progress', '--windows-filenames', '--no-mtime',
      ...(item.playlistIndex ? ['--playlist-items', String(item.playlistIndex)] : ['--no-playlist']),
      '--retries', '10', '--fragment-retries', '10', '--concurrent-fragments', '4',
      ...this._commonArgs(),
      ...formatArgs(item.format),
      '--progress-template',
      'download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s|%(info.format_id)s|%(progress.fragment_index)s|%(progress.fragment_count)s',
      '--progress-template', 'postprocess:PP|%(progress.status)s|%(progress.postprocessor)s',
      '--print', 'after_move:FINAL|%(filepath)s',
      '-o', this._outputTemplate(item),
    ];
    if (s.speedLimit) args.push('-r', s.speedLimit);
    if (s.embedMetadata) args.push('--embed-metadata');
    if (s.embedThumbnail) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
    if (s.subtitles && !/^(mp3|m4a)$/.test(item.format)) {
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', s.subLangs || 'es.*,en.*', '--embed-subs');
    }
    args.push(item.url);
    return args;
  }

  _start(item) {
    item.status = 'downloading';
    item.error = '';
    item.speed = null;
    item.eta = null;
    if (!item.progress || item.progress >= 100) item.progress = 0;
    this._emit(item);

    let proc;
    try {
      // En macOS/Linux el proceso va en su propio grupo para poder detener yt-dlp junto con ffmpeg.
      proc = spawn(this.ytdlp, this._buildArgs(item), { windowsHide: true, env: this._env(), detached: process.platform !== 'win32' });
    } catch (e) {
      item.status = 'error';
      item.error = e.message;
      this._emit(item);
      return;
    }
    this.procs.set(item.id, proc);

    const st = { files: [], lastErr: '', final: '' };
    const onLine = (line) => this._onLine(item, st, line);
    readline.createInterface({ input: proc.stdout }).on('line', onLine);
    readline.createInterface({ input: proc.stderr }).on('line', (l) => {
      if (/^ERROR:/.test(l)) st.lastErr = l;
    });

    proc.on('error', (e) => {
      this.procs.delete(item.id);
      item.status = 'error';
      item.error = e.message;
      this._emit(item);
      this._pump();
    });
    proc.on('close', (code) => {
      this.procs.delete(item.id);
      if (item._stop) {
        const reason = item._stop;
        item._stop = null;
        if (reason === 'pause') item.status = 'paused';
        else if (reason === 'cancel') item.status = 'canceled';
        if (this.items.has(item.id)) { item.speed = null; item.eta = null; this._emit(item); }
      } else if (code === 0) {
        item.status = 'done';
        item.progress = 100;
        item.speed = null;
        item.eta = null;
        item.filepath = st.final || item.filepath;
        try { item.size = fs.statSync(item.filepath).size; } catch { /* sin tamaño */ }
        this._emit(item);
        this.emit('done', this.snapshot(item));
      } else {
        item.status = 'error';
        item.speed = null;
        item.eta = null;
        const raw = firstErrorLine(st.lastErr);
        item.error = raw ? friendlyError(raw) : `yt-dlp terminó con código ${code}`;
        item.errorDetail = raw;
        this._emit(item);
      }
      this._pump();
    });
  }

  _onLine(item, st, line) {
    if (line.startsWith('PROG|')) {
      const f = line.split('|');
      const [, status, dl, total, est, speed, eta, filename, formatId, fragIdx, fragCnt] = f;
      if (!st.files.includes(filename)) st.files.push(filename);
      const idx = st.files.indexOf(filename);
      const streams = (formatId || '').includes('+') ? formatId.split('+').length : 1;
      const tot = num(total) || num(est);
      let frac = tot ? Math.min(1, num(dl) / tot) : null;
      if (frac === null && num(fragCnt)) frac = Math.min(1, num(fragIdx) / num(fragCnt));
      if (status === 'finished') frac = 1;
      if (frac !== null) {
        // Con video+audio el video pesa mucho más: se reparte 85% / 15%.
        const w = streams === 2 ? [0.85, 0.15] : [1];
        const before = w.slice(0, Math.min(idx, w.length - 1)).reduce((a, b) => a + b, 0);
        const cur = w[Math.min(idx, w.length - 1)];
        const p = Math.min(99, (before + cur * frac) * 100);
        item.progress = Math.max(item.progress || 0, Math.round(p * 10) / 10);
      }
      item.speed = status === 'finished' ? null : num(speed);
      item.eta = status === 'finished' ? null : num(eta);
      item.status = 'downloading';
      this._throttledEmit(item);
    } else if (line.startsWith('PP|')) {
      const [, status, pp] = line.split('|');
      if (status === 'started' && pp !== 'MoveFiles') {
        item.status = 'processing';
        item.progress = Math.max(item.progress || 0, 99);
        item.speed = null;
        item.eta = null;
        this._emit(item);
      }
    } else if (line.startsWith('FINAL|')) {
      st.final = line.slice(6).trim();
    }
  }

  _throttledEmit(item) {
    const now = Date.now();
    if (item._lastEmit && now - item._lastEmit < 200) return;
    item._lastEmit = now;
    this._emit(item);
  }

  _kill(id, reason) {
    const item = this.items.get(id);
    const proc = this.procs.get(id);
    if (item) item._stop = reason;
    if (proc && proc.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
      } else {
        // Se envía la señal a todo el grupo (yt-dlp y sus hijos); si no termina en 4 s, se fuerza.
        const signal = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch { /* ya terminó */ } } };
        signal('SIGTERM');
        setTimeout(() => { if (this.procs.get(id) === proc) signal('SIGKILL'); }, 4000).unref();
      }
    } else if (item) {
      item._stop = null;
    }
    return !!proc;
  }

  pause(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (ACTIVE.has(item.status)) this._kill(id, 'pause');
    else if (item.status === 'queued') { item.status = 'paused'; this._emit(item); }
  }

  resume(id) {
    const item = this.items.get(id);
    if (!item || !['paused', 'error', 'canceled'].includes(item.status)) return;
    item.status = 'queued';
    item.error = '';
    this._emit(item);
    this._pump();
  }

  retry(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (!['error', 'canceled', 'done', 'paused'].includes(item.status)) return;
    if (item.status !== 'paused') item.progress = 0;
    item.status = 'queued';
    item.error = '';
    this._emit(item);
    this._pump();
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (this.procs.has(id)) this._kill(id, 'remove');
    this.choices.delete(id);
    this.items.delete(id);
    this.emit('remove', id);
    this._pump();
  }

  pauseAll() {
    for (const it of this.items.values()) this.pause(it.id);
  }

  resumeAll() {
    for (const it of this.items.values()) if (it.status === 'paused') { it.status = 'queued'; this._emit(it); }
    this._pump();
  }

  clearCompleted() {
    for (const it of [...this.items.values()]) {
      if (['done', 'canceled'].includes(it.status)) this.remove(it.id);
    }
  }

  stats() {
    let active = 0, queued = 0, speed = 0, done = 0;
    for (const it of this.items.values()) {
      if (ACTIVE.has(it.status)) { active++; speed += it.speed || 0; }
      else if (it.status === 'queued') queued++;
      else if (it.status === 'done') done++;
    }
    return { active, queued, done, speed, total: this.items.size };
  }

  shutdown() {
    for (const [id] of this.procs) this._kill(id, 'pause');
  }

  // ---------- mantenimiento ----------
  _run(args) {
    return new Promise((resolve) => {
      const p = spawn(this.ytdlp, args, { windowsHide: true, env: this._env() });
      let out = '';
      p.stdout.on('data', (d) => { out += d.toString('utf8'); });
      p.stderr.on('data', (d) => { out += d.toString('utf8'); });
      p.on('error', (e) => resolve({ code: -1, output: e.message }));
      p.on('close', (code) => resolve({ code, output: out.trim() }));
    });
  }

  async version() {
    const r = await this._run(['--version']);
    return r.code === 0 ? r.output.split(/\r?\n/).pop() : '';
  }

  async update() {
    const r = await this._run(['-U']);
    return { ok: r.code === 0, output: r.output, version: await this.version() };
  }
}

// Los enlaces que se copian desde Facebook/Messenger suelen venir envueltos:
// https://l.facebook.com/l.php?u=<enlace real>. Se devuelve el enlace real.
function unwrapRedirect(u) {
  try {
    const url = new URL(u);
    if (/^lm?\.facebook\.com$/i.test(url.hostname) && url.pathname.startsWith('/l.php')) {
      const real = url.searchParams.get('u');
      if (real && /^https?:\/\//i.test(real)) return real;
    }
  } catch { /* se deja tal cual */ }
  return u;
}

module.exports = { Downloader, FORMATS, DEFAULT_SETTINGS, formatArgs, isSingleVideoUrl, urlKind, videoIdOf, friendlyError, sanitizeDirName, unwrapRedirect };
