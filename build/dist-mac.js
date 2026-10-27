// Genera el instalador de macOS (.dmg) de una arquitectura. SOLO funciona en un Mac: necesita codesign y hdiutil.
// En Windows lo hace el workflow .github/workflows/mac.yml (ejecutores macOS de GitHub).
//   node build/dist-mac.js --arch=arm64|x64
//
// La app NO lleva firma de Apple Developer ID (haría falta una cuenta de pago): se firma "ad-hoc", lo mínimo
// para que arranque en Apple Silicon. Por eso macOS pide confirmación la primera vez (ver LEEME dentro del DMG).
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

if (process.platform !== 'darwin') {
  console.error('Este script solo funciona en macOS (usa codesign y hdiutil). En Windows usa el workflow de GitHub Actions.');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const arch = (process.argv.find((a) => a.startsWith('--arch=')) || '').slice(7) || (process.arch === 'arm64' ? 'arm64' : 'x64');
const version = pkg.version;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falló (${r.status})`);
}

const LEEME = `Descargador para macOS
======================

1. Arrastra "Descargador" a la carpeta "Aplicaciones".

2. La primera vez, macOS dirá que no puede comprobar que la app esté libre de software malicioso.
   Es normal: la app no está firmada con una cuenta de Apple Developer. Para abrirla UNA vez:

   macOS 15 (Sequoia) o más nuevo:
     - Abre Descargador (saldrá el aviso) y pulsa "Aceptar".
     - Ve a Ajustes del Sistema > Privacidad y seguridad, baja hasta el mensaje sobre "Descargador"
       y pulsa "Abrir de todos modos". Escribe tu contraseña si te la pide.

   macOS 14 o anterior:
     - En Aplicaciones, clic derecho (o Control + clic) sobre Descargador > Abrir > Abrir.

   Alternativa en Terminal (cualquier versión):
     xattr -dr com.apple.quarantine /Applications/Descargador.app

3. Después ya se abre con normalidad.

Los videos se guardan en la carpeta Películas > Descargador (se puede cambiar en Preferencias).
`;

(async () => {
  console.log(`\n== Descargador ${version} para macOS (${arch}) ==`);

  run('node', [path.join('build', 'package.js'), '--platform=darwin', `--arch=${arch}`]);

  const appDir = path.join(root, 'out', `Descargador-darwin-${arch}`);
  const app = path.join(appDir, 'Descargador.app');
  if (!fs.existsSync(app)) throw new Error(`No se generó ${app}`);

  // Firma ad-hoc: primero los binarios sueltos de Resources/bin y después toda la app.
  const bins = path.join(app, 'Contents', 'Resources', 'bin');
  for (const f of fs.readdirSync(bins)) {
    const file = path.join(bins, f);
    fs.chmodSync(file, 0o755);
    run('codesign', ['--force', '--sign', '-', file]);
  }
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);

  // DMG: la app, un acceso a Aplicaciones para arrastrar y el LEEME.
  const stage = path.join(root, 'out', `dmg-${arch}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  run('ditto', [app, path.join(stage, 'Descargador.app')]);
  fs.symlinkSync('/Applications', path.join(stage, 'Aplicaciones'));
  fs.writeFileSync(path.join(stage, 'LEEME - Cómo abrir.txt'), LEEME);

  const outDir = path.join(root, 'installer');
  fs.mkdirSync(outDir, { recursive: true });
  const dmg = path.join(outDir, `Descargador-${version}-mac-${arch}.dmg`);
  fs.rmSync(dmg, { force: true });
  run('hdiutil', ['create', '-volname', 'Descargador', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);

  const sha = crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex');
  fs.writeFileSync(`${dmg}.sha256`, `${sha}  ${path.basename(dmg)}\n`);
  console.log(`\n${path.basename(dmg)}  ${(fs.statSync(dmg).size / 1048576).toFixed(1)} MB  sha256 ${sha}`);
})().catch((e) => { console.error(`\n✖ ${e.message}`); process.exit(1); });
