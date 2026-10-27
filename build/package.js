// Empaqueta la app (Electron + yt-dlp + ffmpeg) para Windows o macOS.
//   node build/package.js                                  -> la plataforma en la que estás
//   node build/package.js --platform=darwin --arch=arm64   -> app de macOS (Apple Silicon)
//   node build/package.js --platform=darwin --arch=x64     -> app de macOS (Intel)
// En bin/ deben estar los binarios de la plataforma destino (ver build/fetch-mac-bins.js para macOS).
const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const platform = arg('platform', process.platform === 'darwin' ? 'darwin' : 'win32');
const arch = arg('arch', process.arch === 'arm64' ? 'arm64' : 'x64');

// Rutas (relativas a la raíz del proyecto) que se empaquetan dentro de app.asar.
const KEEP = [/^\/package\.json$/, /^\/src(\/|$)/, /^\/build$/, /^\/build\/icon\.ico$/, /^\/node_modules(\/|$)/];

const REQUIRED = {
  win32: ['bin/yt-dlp.exe', 'bin/ffmpeg.exe', 'build/icon.ico'],
  darwin: ['bin/yt-dlp', 'bin/ffmpeg', 'build/icon.icns'],
};

(async () => {
  if (!REQUIRED[platform]) throw new Error(`Plataforma no soportada: ${platform}`);
  for (const f of REQUIRED[platform]) {
    if (!fs.existsSync(path.join(root, f))) throw new Error(`Falta ${f}`);
  }

  const common = {
    dir: root,
    out: path.join(root, 'out'),
    name: 'Descargador',
    executableName: 'Descargador',
    appVersion: pkg.version,
    platform,
    arch,
    // Sin extensión: el empaquetador elige .ico en Windows y .icns en macOS.
    icon: path.join(root, 'build', 'icon'),
    overwrite: true,
    prune: true,
    // koffi (número de secuencia del portapapeles, solo Windows) trae un .node que debe quedar fuera del asar.
    asar: { unpack: '*.node' },
    extraResource: [path.join(root, 'bin')],
    // Lista de lo que SÍ va dentro de la app: así carpetas del proyecto como android/ o .android-tools/
    // (varios GB) nunca se cuelan en el instalador.
    ignore: (file) => {
      if (file === '') return false;
      if (/^\/node_modules\/koffi\/(doc|vendor|lib)(\/|$)/.test(file)) return true;
      return !KEEP.some((re) => re.test(file));
    },
  };

  const extra = platform === 'win32'
    ? {
        win32metadata: {
          CompanyName: 'Hugo',
          FileDescription: 'Descargador de videos y audio',
          ProductName: 'Descargador',
          InternalName: 'Descargador',
          OriginalFilename: 'Descargador.exe',
        },
      }
    : {
        appBundleId: 'cl.hugo.descargador',
        appCategoryType: 'public.app-category.video',
        darwinDarkModeSupport: true,
      };

  const paths = await packager({ ...common, ...extra });
  console.log('Empaquetado en:', paths.join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
