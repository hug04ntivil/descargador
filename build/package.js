// Empaqueta la app en out/Descargador-win32-x64 (Electron + yt-dlp + ffmpeg).
const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');

// Rutas (relativas a la raíz del proyecto) que se empaquetan dentro de app.asar.
const KEEP = [/^\/package\.json$/, /^\/src(\/|$)/, /^\/build$/, /^\/build\/icon\.ico$/, /^\/node_modules(\/|$)/];

(async () => {
  for (const f of ['bin/yt-dlp.exe', 'bin/ffmpeg.exe', 'build/icon.ico']) {
    if (!fs.existsSync(path.join(root, f))) throw new Error(`Falta ${f}`);
  }
  const paths = await packager({
    dir: root,
    out: path.join(root, 'out'),
    name: 'Descargador',
    executableName: 'Descargador',
    appVersion: pkg.version,
    platform: 'win32',
    arch: 'x64',
    icon: path.join(root, 'build', 'icon.ico'),
    overwrite: true,
    prune: true,
    // koffi (lectura del número de secuencia del portapapeles) trae un .node que debe quedar fuera del asar.
    asar: { unpack: '*.node' },
    extraResource: [path.join(root, 'bin')],
    // Lista de lo que SÍ va dentro de la app: así carpetas del proyecto como android/ o .android-tools/
    // (varios GB) nunca se cuelan en el instalador de Windows.
    ignore: (file) => {
      if (file === '') return false;
      if (/^\/node_modules\/koffi\/(doc|vendor|lib)(\/|$)/.test(file)) return true;
      return !KEEP.some((re) => re.test(file));
    },
    win32metadata: {
      CompanyName: 'Hugo',
      FileDescription: 'Descargador de videos y audio',
      ProductName: 'Descargador',
      InternalName: 'Descargador',
      OriginalFilename: 'Descargador.exe',
    },
  });
  console.log('Empaquetado en:', paths.join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
