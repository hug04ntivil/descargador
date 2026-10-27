// Prueba de humo de la app EMPAQUETADA: la abre en modo autoprueba, descarga un video pequeño desde un enlace
// directo (sin depender de YouTube, que suele bloquear las IP de servidores de CI) y lo convierte a MP3 con ffmpeg.
// Comprueba así que arrancan la app, el yt-dlp incluido, ffmpeg y la cola de descargas.
//
//   node test/smoke-packaged.js <ejecutable> [--rosetta]
//   Windows:  out\Descargador-win32-x64\Descargador.exe
//   macOS:    out/Descargador-darwin-arm64/Descargador.app/Contents/MacOS/Descargador
//   --rosetta ejecuta la app Intel en un Mac Apple Silicon (arch -x86_64).
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
const rosetta = process.argv.includes('--rosetta');
if (!exe || !fs.existsSync(exe)) { console.error(`No existe el ejecutable: ${exe}`); process.exit(2); }

// Videos de dominio público/CC0 de MDN: pequeños (≈1 MB) y estables.
const CASES = [
  { name: 'video MP4', format: 'best', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', ext: '.mp4' },
  { name: 'audio MP3 (ffmpeg)', format: 'mp3', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm', ext: '.mp3' },
];

function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'descargador-smoke-'));
  const out = path.join(dir, 'descargas');
  const ud = path.join(dir, 'datos');
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ outputDir: out, clipboardWatch: false, autoUpdateCheck: false }));
  const shot = path.join(dir, 'captura.png');
  const cfg = { userData: ud, urls: [c.url], format: c.format, untilDone: true, waitMs: 90000, shot };
  const env = { ...process.env, DESCARGADOR_SELFTEST: JSON.stringify(cfg) };
  const [cmd, args] = rosetta ? ['arch', ['-x86_64', exe]] : [exe, []];
  const r = spawnSync(cmd, args, { env, timeout: 240000, encoding: 'utf8' });

  const itemsFile = `${shot}.items.json`;
  assert.ok(fs.existsSync(itemsFile), `${c.name}: la app no llegó a escribir el resultado (código ${r.status}) ${r.stderr || ''}`.trim());
  const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
  assert.strictEqual(items.length, 1, `${c.name}: se esperaba 1 descarga y hay ${items.length}`);
  assert.strictEqual(items[0].status, 'done', `${c.name}: estado ${items[0].status} — ${items[0].error}`);
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const file = files.find((f) => f.toLowerCase().endsWith(c.ext));
  assert.ok(file, `${c.name}: no se generó un archivo ${c.ext} (hay: ${files.join(', ') || 'nada'})`);
  const size = fs.statSync(path.join(out, file)).size;
  assert.ok(size > 10000, `${c.name}: archivo demasiado pequeño (${size} B)`);
  console.log(`OK ${c.name}: ${file} (${(size / 1024).toFixed(0)} KB)`);
  fs.rmSync(dir, { recursive: true, force: true });
}

try {
  for (const c of CASES) runCase(c);
  console.log('Prueba de humo superada');
} catch (e) {
  console.error('FALLÓ:', e.message);
  process.exit(1);
}
