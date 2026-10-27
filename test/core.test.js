// Prueba de integración del núcleo con un video real y corto (19 s).
// Uso: node test/core.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Downloader, DEFAULT_SETTINGS, formatArgs, isSingleVideoUrl, friendlyError, unwrapRedirect } = require('../src/core');

const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'descargador-test-'));
const settings = { ...DEFAULT_SETTINGS, outputDir: out, embedThumbnail: true };

function waitFor(dl, id, pred, ms = 180000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout esperando estado')), ms);
    const check = (it) => { if (it.id === id && pred(it)) { clearTimeout(t); dl.off('update', check); resolve(it); } };
    dl.on('update', check);
  });
}

async function run(format) {
  const dl = new Downloader({
    binDir: path.join(__dirname, '..', 'bin'),
    jsRuntime: process.execPath,
    getSettings: () => settings,
  });
  const ids = new Set();
  dl.on('update', (it) => ids.add(it.id));
  const progress = [];
  dl.on('update', (it) => { if (it.status === 'downloading') progress.push(it.progress); });
  const res = await dl.add(URL, format);
  assert.ok(res.ok, `add falló: ${JSON.stringify(res)}`);
  const item = dl.list()[0];
  assert.ok(item.title && item.title !== URL, 'título resuelto');
  const done = item.status === 'done' ? item : await waitFor(dl, item.id, (i) => ['done', 'error'].includes(i.status));
  assert.strictEqual(done.status, 'done', `estado final: ${done.status} ${done.error}`);
  assert.ok(fs.existsSync(done.filepath), `archivo existe: ${done.filepath}`);
  assert.ok(done.size > 10000, 'tamaño > 10 KB');
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1], 'progreso monótono');
  console.log(`OK ${format}: ${path.basename(done.filepath)} (${done.size} B, ${progress.length} eventos de progreso)`);
  return dl;
}

(async () => {
  assert.ok(isSingleVideoUrl('https://www.youtube.com/watch?v=abc&list=PL1'));
  assert.ok(!isSingleVideoUrl('https://www.youtube.com/playlist?list=PL1'));
  assert.ok(formatArgs('720').join(' ').includes('height<=720'));

  // Facebook: mensaje claro y enlaces envueltos en l.facebook.com
  assert.ok(/Facebook/.test(friendlyError('1022555381530004: Cannot parse data; please report this issue on https://github.com/yt-dlp')));
  assert.ok(/cookies/i.test(friendlyError('This video is only available for registered users')));
  assert.strictEqual(
    unwrapRedirect('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D10153231379946729&h=AT0abc'),
    'https://www.facebook.com/watch/?v=10153231379946729',
  );
  assert.strictEqual(unwrapRedirect('https://lm.facebook.com/l.php?u=https%3A%2F%2Fyoutu.be%2Fabc'), 'https://youtu.be/abc');
  assert.strictEqual(unwrapRedirect('https://www.facebook.com/watch/?v=1'), 'https://www.facebook.com/watch/?v=1');
  assert.strictEqual(unwrapRedirect('https://l.facebook.com/l.php?u=javascript:alert(1)'), 'https://l.facebook.com/l.php?u=javascript:alert(1)');

  await run('360');
  await run('mp3');

  // Duplicados y URL inválida
  const dl = await run('best');
  const dup = await dl.add(URL, 'best');
  assert.strictEqual(dup.reason, 'duplicate');
  const bad = await dl.add('no-es-url', 'best');
  assert.strictEqual(bad.reason, 'invalid');

  // Pausa y reanudación
  const dl2 = new Downloader({ binDir: path.join(__dirname, '..', 'bin'), jsRuntime: process.execPath, getSettings: () => ({ ...settings, outputDir: path.join(out, 'p') }) });
  await dl2.add(URL, '1080');
  const it = dl2.list()[0];
  dl2.pause(it.id);
  await waitFor(dl2, it.id, (i) => i.status === 'paused');
  dl2.resume(it.id);
  const fin = await waitFor(dl2, it.id, (i) => ['done', 'error'].includes(i.status));
  assert.strictEqual(fin.status, 'done', fin.error);
  console.log('OK pausa/reanudar');

  // Listas: elegir videos / solo el video del enlace / toda la lista / errores amigables
  const LIST = 'https://www.youtube.com/watch?v=GvgqDSnpRQM&list=PLBCF2DAC6FFB574DE';
  const mk = (extra) => new Downloader({
    binDir: path.join(__dirname, '..', 'bin'), jsRuntime: process.execPath,
    getSettings: () => ({ ...settings, outputDir: path.join(out, 'listas'), ...extra }),
  });

  const ask = mk({ playlists: 'ask' });
  let choice = null;
  ask.on('choose', (c) => { choice = c; });
  const r1 = await ask.add(LIST, '360');
  assert.ok(r1.ok && r1.choose, 'la lista debe ofrecer elección');
  assert.ok(choice.entries.length >= 5, 'entradas de la lista');
  assert.strictEqual(choice.current, 0, 'el video del enlace se marca como actual');
  assert.ok(choice.hasVideo);
  const only = ask.list()[0];
  assert.strictEqual(only.status, 'choosing');
  ask.chooseSingle(choice.id);
  assert.strictEqual(ask.list().length, 1, 'solo un video');
  const single = await waitFor(ask, only.id, (i) => ['done', 'error'].includes(i.status));
  assert.strictEqual(single.status, 'done', single.error);
  assert.strictEqual(single.playlist, '', 'un solo video no crea subcarpeta');
  console.log('OK solo el video del enlace');

  const ask2 = mk({ playlists: 'ask' });
  ask2.on('choose', (c) => { choice = c; });
  await ask2.add('https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE', '360');
  ask2.resolveChoice(choice.id, [1, 2]);
  const picked = ask2.list();
  assert.strictEqual(picked.length, 2, 'dos videos elegidos');
  assert.ok(picked.every((i) => i.playlist === 'Google Search Stories'), 'subcarpeta de lista');
  ask2.pauseAll();
  console.log('OK elegir videos de una lista');

  const all = mk({ playlists: 'all', maxConcurrent: 1 });
  await all.add('https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE', '360');
  assert.ok(all.list().length >= 5, 'toda la lista añadida');
  all.pauseAll();
  console.log(`OK lista completa (${all.list().length} videos)`);

  // En segundo plano (app minimizada) un video dentro de una lista no pregunta: baja solo ese video y avisa
  const bg = mk({ playlists: 'ask' });
  let asked = false;
  let announced = null;
  bg.on('choose', () => { asked = true; });
  bg.on('added', (a) => { announced = a; });
  const rb = await bg.add(LIST, '360', { background: true, announce: true });
  assert.ok(rb.ok && !rb.choose && !asked, 'en segundo plano no se pregunta');
  assert.strictEqual(bg.list().length, 1, 'solo el video del enlace');
  assert.ok(announced && announced.count === 1, 'se anuncia el video añadido');
  bg.pauseAll();
  console.log('OK segundo plano: video de una lista sin preguntar');

  const badDl = mk({});
  await badDl.add('https://www.instagram.com/reel/C0000000000/', 'best');
  const badItem = badDl.list()[0];
  assert.strictEqual(badItem.status, 'error');
  assert.ok(/iniciar sesión/.test(badItem.error), `error amigable: ${badItem.error}`);
  const quiet = mk({});
  const notices = [];
  quiet.on('notice', (n) => notices.push(n));
  await quiet.add('https://www.instagram.com/reel/C0000000000/', 'best', { silentFail: true });
  assert.strictEqual(quiet.list().length, 0, 'silentFail quita la fila');
  assert.strictEqual(notices[0].type, 'error');
  console.log('OK errores amigables');

  console.log('Archivos generados en', out);
  console.log(fs.readdirSync(out, { recursive: true }).join('\n'));
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
