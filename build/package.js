// Empaqueta la app en out/Descargador-win32-x64 (Electron + yt-dlp + ffmpeg).
const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');

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
    ignore: [
      /^\/(out|installer|test|bin|\.claude|graphify-out)(\/|$)/,
      /^\/build\/(make-icon|package|installer)\.js$/,
      /^\/build\/icon\.png$/,
      /^\/node_modules\/koffi\/(doc|vendor|lib)(\/|$)/,
      /^\/\.gitignore$/,
      /^\/package-lock\.json$/,
    ],
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
