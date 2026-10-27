// Descarga los binarios de macOS que van dentro de la app: yt-dlp (universal) y ffmpeg (estático) para la
// arquitectura indicada. Se ejecuta en el workflow de GitHub Actions o en un Mac.
//   node build/fetch-mac-bins.js --arch=arm64     (Apple Silicon: M1, M2, M3, M4…)
//   node build/fetch-mac-bins.js --arch=x64       (Mac con procesador Intel)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FFMPEG_TAG = 'b6.1.1'; // https://github.com/eugeneware/ffmpeg-static/releases
const arch = (process.argv.find((a) => a.startsWith('--arch=')) || '').slice(7) || (process.arch === 'arm64' ? 'arm64' : 'x64');
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Arquitectura no válida: ${arch}`);

const bin = path.join(__dirname, '..', 'bin');

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'descargador-build' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  fs.mkdirSync(bin, { recursive: true });

  const ytUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  console.log('yt-dlp  <-', ytUrl);
  const yt = await download(ytUrl);
  fs.writeFileSync(path.join(bin, 'yt-dlp'), yt, { mode: 0o755 });
  console.log(`  ${(yt.length / 1048576).toFixed(1)} MB`);

  const ffUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/ffmpeg-darwin-${arch}.gz`;
  console.log('ffmpeg  <-', ffUrl);
  const ff = zlib.gunzipSync(await download(ffUrl));
  fs.writeFileSync(path.join(bin, 'ffmpeg'), ff, { mode: 0o755 });
  console.log(`  ${(ff.length / 1048576).toFixed(1)} MB`);

  // writeFileSync no cambia el modo de un archivo que ya existía
  fs.chmodSync(path.join(bin, 'yt-dlp'), 0o755);
  fs.chmodSync(path.join(bin, 'ffmpeg'), 0o755);
  console.log(`Binarios de macOS (${arch}) listos en bin/`);
})().catch((e) => { console.error(e.message); process.exit(1); });
