'use strict';

const $ = (id) => document.getElementById(id);
const listEl = $('list');
const items = new Map();
const rows = new Map();
let settings = {};
let formats = {};

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 5h3v14H7zm7 0h3v14h-3z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1.5V9l5 3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 5a7 7 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L16.4 3h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4z"/></svg>',
  remove: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>',
};

function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtTime(s) {
  if (s == null) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusText(it) {
  switch (it.status) {
    case 'analyzing': return 'Analizando enlace…';
    case 'queued': return 'En cola';
    case 'choosing': return 'Lista detectada: elige qué videos descargar';
    case 'downloading': {
      const parts = [`${it.progress.toFixed(1)}%`];
      if (it.speed) parts.push(`${fmtBytes(it.speed)}/s`);
      if (it.eta != null) parts.push(`quedan ${fmtTime(it.eta)}`);
      return parts.join(' · ');
    }
    case 'processing': return 'Procesando archivo…';
    case 'paused': return `En pausa · ${it.progress.toFixed(1)}%`;
    case 'done': return `Completado${it.size ? ' · ' + fmtBytes(it.size) : ''}`;
    case 'canceled': return 'Cancelado';
    case 'error': return it.error || 'Error';
    default: return it.status;
  }
}

function buttonsFor(it) {
  const b = [];
  const btn = (act, icon, title, cls = '') => `<button class="icon-btn ${cls}" data-act="${act}" title="${title}" aria-label="${title}">${icon}</button>`;
  if (['downloading', 'queued'].includes(it.status)) b.push(btn('pause', ICONS.pause, 'Pausar'));
  if (it.status === 'paused') b.push(btn('resume', ICONS.play, 'Reanudar'));
  if (it.status === 'choosing') b.push(btn('pick', ICONS.list, 'Elegir videos'));
  if (['error', 'canceled'].includes(it.status)) b.push(btn('retry', ICONS.retry, 'Reintentar'));
  if (it.status === 'error' && /Preferencias/.test(it.error || '')) b.push(btn('prefs', ICONS.gear, 'Abrir preferencias'));
  if (it.status === 'done') {
    b.push(btn('open', ICONS.open, 'Reproducir'));
    b.push(btn('show', ICONS.folder, 'Mostrar en la carpeta'));
  }
  b.push(btn('remove', ICONS.remove, 'Quitar de la lista', 'danger'));
  return b.join('');
}

function metaText(it) {
  const bits = [`<span class="chip">${esc(formats[it.format] || it.format)}</span>`];
  if (it.uploader) bits.push(esc(it.uploader));
  if (it.playlist) bits.push('Lista: ' + esc(it.playlist));
  return bits.join(' ');
}

function render(it) {
  let row = rows.get(it.id);
  if (!row) {
    row = document.createElement('div');
    row.className = 'item';
    row.dataset.id = it.id;
    row.innerHTML = `
      <div class="thumb"><img alt="" referrerpolicy="no-referrer" hidden><span class="dur" hidden></span></div>
      <div class="body">
        <div class="title"></div>
        <div class="meta"></div>
        <div class="bar"><i></i></div>
        <div class="status"></div>
      </div>
      <div class="btns"></div>`;
    rows.set(it.id, row);
    listEl.appendChild(row);
  }
  row.dataset.status = it.status;
  const title = row.querySelector('.title');
  if (title.textContent !== it.title) { title.textContent = it.title; title.title = it.title; }
  row.querySelector('.meta').innerHTML = metaText(it);
  const img = row.querySelector('.thumb img');
  if (it.thumbnail && img.dataset.src !== it.thumbnail) {
    img.dataset.src = it.thumbnail;
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { img.hidden = true; };
    img.src = it.thumbnail;
  }
  const dur = row.querySelector('.dur');
  dur.hidden = !it.duration;
  dur.textContent = fmtTime(it.duration);
  row.querySelector('.bar > i').style.width = `${it.status === 'done' ? 100 : it.progress || 0}%`;
  const st = row.querySelector('.status');
  st.textContent = statusText(it);
  st.title = it.status === 'error' ? it.errorDetail || it.error : '';
  const btns = row.querySelector('.btns');
  const sig = `${it.status}`;
  if (btns.dataset.sig !== sig) { btns.dataset.sig = sig; btns.innerHTML = buttonsFor(it); }
  listEl.classList.toggle('has-items', rows.size > 0);
}

let toastTimer;
function toast(text, type) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('error', type === 'error');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function renderStats(s) {
  if (!s || !s.total) { $('stats').textContent = 'Sin actividad'; return; }
  const bits = [];
  if (s.active) bits.push(`${s.active} descargando${s.speed ? ' · ' + fmtBytes(s.speed) + '/s' : ''}`);
  if (s.queued) bits.push(`${s.queued} en cola`);
  if (s.done) bits.push(`${s.done} completadas`);
  $('stats').textContent = bits.join('  ·  ') || `${s.total} en la lista`;
}

async function addFromText(text) {
  const n = await window.api.add(text, $('format').value);
  if (!n) toast('No encontré ningún enlace válido');
  return n;
}

function fillFormats(sel, value) {
  sel.innerHTML = Object.entries(formats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.value = value;
}

// ---------- eventos de la lista ----------
listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) {
    // Tocar la miniatura o el título de una descarga terminada la abre.
    const row = e.target.closest('.item');
    const it = row && items.get(row.dataset.id);
    if (it && it.status === 'done' && e.target.closest('.thumb, .title')) window.api.openFile(it.filepath);
    return;
  }
  const id = btn.closest('.item').dataset.id;
  const it = items.get(id);
  switch (btn.dataset.act) {
    case 'pause': window.api.pause(id); break;
    case 'resume': window.api.resume(id); break;
    case 'retry': window.api.retry(id); break;
    case 'remove': window.api.remove(id); break;
    case 'open': window.api.openFile(it.filepath); break;
    case 'show': window.api.showFile(it.filepath); break;
    case 'pick': openPicker(id); break;
    case 'prefs': openSettings(); break;
  }
});
listEl.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.item');
  const it = row && items.get(row.dataset.id);
  if (it && it.status === 'done') window.api.openFile(it.filepath);
});

// ---------- barra de añadir ----------
$('btn-add').addEventListener('click', async () => {
  const v = $('url').value.trim();
  if (!v) return;
  if (await addFromText(v)) $('url').value = '';
});
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-add').click(); });
// Solo Android: lee el portapapeles desde el lado nativo (la app debe estar en primer plano).
$('btn-paste').addEventListener('click', async () => {
  const n = await window.api.pasteClipboard();
  if (!n) toast('No hay ningún enlace en el portapapeles');
});
$('url').addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  if (/https?:\/\/\S+\s+\S*https?:\/\//.test(text)) { e.preventDefault(); addFromText(text); }
});
document.addEventListener('paste', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  addFromText(e.clipboardData.getData('text'));
});

// ---------- arrastrar y soltar ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').classList.add('show'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('show'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.remove('show');
  const dt = e.dataTransfer;
  addFromText(dt.getData('text/uri-list') || dt.getData('text/plain'));
});

// ---------- pie ----------
$('btn-pause-all').addEventListener('click', () => window.api.pauseAll());
$('btn-resume-all').addEventListener('click', () => window.api.resumeAll());
$('btn-clear').addEventListener('click', () => window.api.clearCompleted());
$('btn-folder').addEventListener('click', () => window.api.openOutput());

// ---------- preferencias ----------
const dlg = $('settings');
function openSettings() {
  $('s-dir').value = settings.outputDir;
  fillFormats($('s-format'), settings.defaultFormat);
  $('s-max').value = settings.maxConcurrent;
  $('s-speed').value = settings.speedLimit;
  $('s-proxy').value = settings.proxy;
  $('s-cookies').value = settings.cookiesBrowser;
  $('s-playlists').value = settings.playlists;
  $('s-cookiesfile').value = settings.cookiesFile || '';
  $('s-clip').checked = settings.clipboardWatch;
  $('s-autoupd').checked = settings.autoUpdateCheck !== false;
  $('s-meta').checked = settings.embedMetadata;
  $('s-thumb').checked = settings.embedThumbnail;
  $('s-subs').checked = settings.subtitles;
  $('s-sublangs').value = settings.subLangs;
  $('update-log').hidden = true;
  dlg.showModal();
  // En Android el motor puede tardar en arrancar: la versión se pide al abrir las preferencias.
  if (window.api.getVersion) window.api.getVersion().then((v) => { if (v) $('ytv').textContent = v; });
}
$('btn-settings').addEventListener('click', openSettings);
$('s-dir-btn').addEventListener('click', async () => {
  const dir = await window.api.chooseFolder();
  if (dir) $('s-dir').value = dir;
});
$('settings-form').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  settings = await window.api.saveSettings({
    outputDir: $('s-dir').value,
    defaultFormat: $('s-format').value,
    maxConcurrent: Number($('s-max').value) || 3,
    speedLimit: $('s-speed').value.trim(),
    proxy: $('s-proxy').value.trim(),
    cookiesBrowser: $('s-cookies').value,
    playlists: $('s-playlists').value,
    cookiesFile: $('s-cookiesfile').value,
    clipboardWatch: $('s-clip').checked,
    autoUpdateCheck: $('s-autoupd').checked,
    embedMetadata: $('s-meta').checked,
    embedThumbnail: $('s-thumb').checked,
    subtitles: $('s-subs').checked,
    subLangs: $('s-sublangs').value.trim() || 'es.*,en.*',
  });
  $('format').value = settings.defaultFormat;
  toast('Preferencias guardadas');
});
$('s-cookiesfile-btn').addEventListener('click', async () => {
  const f = await window.api.chooseCookiesFile();
  if (f) $('s-cookiesfile').value = f;
});
$('s-cookiesfile-clear').addEventListener('click', () => { $('s-cookiesfile').value = ''; });
$('s-update').addEventListener('click', async () => {
  const btn = $('s-update');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  const r = await window.api.updateYtdlp();
  $('ytv').textContent = r.version || '?';
  const log = $('update-log');
  log.hidden = false;
  log.textContent = r.output || (r.ok ? 'Listo' : 'No se pudo actualizar');
  btn.disabled = false;
  btn.textContent = 'Buscar actualización';
});

// ---------- selector de listas ----------
const choices = new Map();
const picker = { id: null, selected: new Set(), current: -1, rows: [] };

function updatePickerCount() {
  const total = picker.rows.length;
  const n = picker.selected.size;
  $('p-count').textContent = `${n} de ${total} seleccionados`;
  const ok = $('p-ok');
  ok.disabled = n === 0;
  ok.textContent = n === 1 ? 'Descargar 1 video' : `Descargar ${n} videos`;
}

function openPicker(id) {
  const ch = choices.get(id);
  if (!ch || $('picker').open) return;
  picker.id = id;
  picker.current = ch.current;
  picker.selected = new Set(ch.entries.map((_, i) => i));
  $('p-title').textContent = ch.title;
  $('p-sub').textContent = `${ch.entries.length} videos · formato: ${formats[ch.format] || ch.format}`;
  $('p-single').hidden = !ch.hasVideo;
  $('p-filter').value = '';
  const list = $('p-list');
  list.textContent = '';
  const frag = document.createDocumentFragment();
  picker.rows = ch.entries.map((e, i) => {
    const row = document.createElement('label');
    row.className = 'pk-row' + (i === ch.current ? ' current' : '');
    row.innerHTML = '<input type="checkbox" checked><span class="n"></span><img alt="" loading="lazy" referrerpolicy="no-referrer"><div class="t"><b></b><span></span></div>';
    row.querySelector('.n').textContent = String(i + 1);
    row.querySelector('b').textContent = e.title;
    row.querySelector('.t span').textContent = [e.uploader, e.duration ? fmtTime(e.duration) : ''].filter(Boolean).join(' · ');
    const img = row.querySelector('img');
    if (e.thumbnail) img.src = e.thumbnail; else img.style.visibility = 'hidden';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const box = row.querySelector('input');
    box.addEventListener('change', () => {
      if (box.checked) picker.selected.add(i); else picker.selected.delete(i);
      updatePickerCount();
    });
    row.dataset.title = (e.title || '').toLowerCase();
    frag.appendChild(row);
    return { row, box };
  });
  list.appendChild(frag);
  updatePickerCount();
  $('picker').showModal();
  if (ch.current > 0) picker.rows[ch.current].row.scrollIntoView({ block: 'center' });
}

function nextPicker() {
  for (const id of choices.keys()) if (id !== picker.id) { openPicker(id); return; }
}

function finishPicker(action) {
  const id = picker.id;
  if (!id) return;
  if (action === 'ok') window.api.choiceConfirm(id, [...picker.selected]);
  else if (action === 'single') window.api.choiceSingle(id);
  else if (action === 'cancel') window.api.choiceCancel(id);
  choices.delete(id);
  picker.id = null;
  if ($('picker').open) $('picker').close();
  nextPicker();
}

$('p-ok').addEventListener('click', () => finishPicker('ok'));
$('p-single').addEventListener('click', () => finishPicker('single'));
$('p-cancel').addEventListener('click', () => finishPicker('cancel'));
$('p-all').addEventListener('click', () => {
  picker.rows.forEach(({ row, box }, i) => { if (!row.hidden) { box.checked = true; picker.selected.add(i); } });
  updatePickerCount();
});
$('p-none').addEventListener('click', () => {
  picker.rows.forEach(({ row, box }, i) => { if (!row.hidden) { box.checked = false; picker.selected.delete(i); } });
  updatePickerCount();
});
$('p-filter').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  picker.rows.forEach(({ row }) => { row.hidden = !!q && !row.dataset.title.includes(q); });
});
// Esc cierra sin decidir: la fila queda en la lista con el botón "Elegir videos".
$('picker').addEventListener('close', () => { if (!$('picker').open) picker.id = null; });
window.api.onChoose((ch) => { choices.set(ch.id, ch); if (!$('picker').open) openPicker(ch.id); });

// ---------- actualizaciones de la app (solo escritorio) ----------
const banner = { version: '' };
function showUpdate(info) {
  banner.version = info.latest;
  $('update-text').textContent = `Hay una versión nueva de Descargador: ${info.latest} (tienes la ${info.current}).`;
  $('update-install').disabled = false;
  $('update-install').textContent = 'Instalar ahora';
  $('update-banner').hidden = false;
}
if (window.api.onUpdate) {
  window.api.onUpdate(showUpdate);
  window.api.onUpdateProgress((p) => {
    $('update-text').textContent = p == null ? 'Descargando la actualización…' : `Descargando la actualización… ${Math.round(p * 100)} %`;
    if (p === 1) $('update-text').textContent = 'Instalando… Descargador se reiniciará solo.';
  });
  window.api.onUpdateError((msg) => {
    $('update-text').textContent = `No se pudo actualizar: ${msg}`;
    $('update-install').disabled = false;
    $('update-install').textContent = 'Reintentar';
  });
  $('update-install').addEventListener('click', () => {
    $('update-install').disabled = true;
    $('update-text').textContent = 'Descargando la actualización…';
    window.api.installUpdate();
  });
  $('update-notes').addEventListener('click', () => window.api.openRelease());
  $('update-later').addEventListener('click', () => {
    window.api.dismissUpdate(banner.version);
    $('update-banner').hidden = true;
  });
  $('s-appupdate').addEventListener('click', async () => {
    const btn = $('s-appupdate');
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    const r = await window.api.checkAppUpdate();
    btn.disabled = false;
    btn.textContent = 'Buscar actualización';
    if (r.status === 'latest') toast(`Ya tienes la última versión (${r.current}).`);
    else if (r.status === 'error') toast(`No se pudo comprobar: ${r.message}`, 'error');
    else $('settings').close();
  });
}

// ---------- arranque ----------
window.api.onItems((batch) => batch.forEach((it) => { items.set(it.id, it); render(it); }));
window.api.onRemove((id) => {
  items.delete(id);
  choices.delete(id);
  if (picker.id === id && $('picker').open) $('picker').close();
  const row = rows.get(id);
  if (row) row.remove();
  rows.delete(id);
  listEl.classList.toggle('has-items', rows.size > 0);
});
window.api.onStats(renderStats);
window.api.onNotice((n) => toast(n.text, n.type));

(async () => {
  const init = await window.api.init();
  settings = init.settings;
  formats = init.formats;
  $('ytv').textContent = init.ytdlpVersion || '?';
  $('appv').textContent = init.appVersion || '';
  fillFormats($('format'), settings.defaultFormat);
  init.items.sort((a, b) => a.addedAt - b.addedAt).forEach((it) => { items.set(it.id, it); render(it); });
  renderStats(init.stats);
})();
