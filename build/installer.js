// Compila el instalador con Inno Setup a partir de out/Descargador-win32-x64.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const candidates = [
  process.env.ISCC,
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean);
const iscc = candidates.find((p) => fs.existsSync(p));
if (!iscc) { console.error('No se encontró ISCC.exe (Inno Setup 6).'); process.exit(1); }
if (!fs.existsSync(path.join(__dirname, '..', 'out', 'Descargador-win32-x64', 'Descargador.exe'))) {
  console.error('Primero ejecuta: npm run package'); process.exit(1);
}

const r = spawnSync(iscc, [`/DAppVersion=${pkg.version}`, path.join(__dirname, '..', 'installer', 'Descargador.iss')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
