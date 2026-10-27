// Prueba de humo del portapapeles de la app EMPAQUETADA: abre la app en modo autoprueba con el vigilante
// activado, copia un enlace de YouTube al portapapeles del sistema y comprueba que la app lo añadió sola.
// No exige que la descarga termine (YouTube puede bloquear las IP de los servidores de CI): basta con que el
// enlace aparezca en la cola, lo que demuestra que el vigilante del portapapeles funciona.
//
//   node test/smoke-clipboard.js <ejecutable>
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) { console.error(`No existe el ejecutable: ${exe}`); process.exit(2); }

const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

function readClipboard() {
  if (process.platform === 'darwin') return spawnSync('pbpaste', { encoding: 'utf8' }).stdout;
  if (process.platform === 'win32') return spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' }).stdout;
  return '';
}
function writeClipboard(text) {
  if (process.platform === 'darwin') return spawnSync('pbcopy', { input: text });
  if (process.platform === 'win32') {
    // Windows bloquea el portapapeles unos instantes si otro programa lo está leyendo: se reintenta hasta confirmarlo.
    for (let i = 0; i < 8; i++) {
      const r = spawnSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`]);
      if (r.status === 0 && readClipboard().trim() === text) return r;
    }
    throw new Error('No se pudo escribir el portapapeles');
  }
  throw new Error('Plataforma sin soporte de portapapeles en esta prueba');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'descargador-clip-'));
const ud = path.join(dir, 'datos');
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ outputDir: path.join(dir, 'descargas'), clipboardWatch: true, autoUpdateCheck: false, defaultFormat: '360' }));
const shot = path.join(dir, 'captura.png');
const cfg = { userData: ud, watch: true, urls: [], waitMs: 45000, shot };

const original = readClipboard();
const child = spawn(exe, [], { env: { ...process.env, DESCARGADOR_SELFTEST: JSON.stringify(cfg) }, stdio: 'ignore' });
setTimeout(() => { writeClipboard(URL); console.log('Enlace copiado al portapapeles'); }, 12000);

child.on('exit', () => {
  try { writeClipboard(original); } catch { /* se deja como esté */ }
  try {
    const itemsFile = `${shot}.items.json`;
    assert.ok(fs.existsSync(itemsFile), 'la app no llegó a escribir el resultado');
    const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
    assert.ok(items.some((i) => i.url.includes('jNQXAC9IVRw')), `el enlace copiado no apareció en la cola (hay ${items.length} elementos)`);
    const it = items.find((i) => i.url.includes('jNQXAC9IVRw'));
    console.log(`OK el portapapeles añadió el enlace solo → "${it.title}" [${it.status}]${it.error ? ' ' + it.error : ''}`);
    console.log('Prueba del portapapeles superada');
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error('FALLÓ:', e.message);
    process.exit(1);
  }
});
