// Publica una versión nueva de la app de Windows en GitHub Releases.
//
//   npm run release -- patch            1.1.0 -> 1.1.1   (correcciones)
//   npm run release -- minor            1.1.0 -> 1.2.0   (funciones nuevas)
//   npm run release -- major            1.1.0 -> 2.0.0
//   npm run release -- 1.4.0            versión exacta
//
// Opciones:
//   --dry-run     compila el instalador pero no toca git ni GitHub (restaura package.json)
//   --draft       crea el release como borrador para revisarlo antes de publicarlo
//   --notes "..." texto de las novedades (si no, se usan los mensajes de commit desde la versión anterior)
//   --skip-tests  no ejecuta las pruebas rápidas antes de compilar
//
// Las apps ya instaladas detectan el release nuevo y ofrecen instalarlo (src/updater.js).
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OWNER = 'hug04ntivil';
const REPO = 'hug04ntivil/descargador';

// ---------- utilidades ----------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd), ...opts });
  if (opts.allowFail) return r;
  if (r.status !== 0) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    throw new Error(`${cmd} ${args.join(' ')} falló (${r.status})${out ? `:\n${out}` : ''}`);
  }
  return r;
}
const out = (cmd, args) => run(cmd, args).stdout.trim();
const step = (msg) => console.log(`\n▶ ${msg}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const opts = { bump: null, dryRun: false, draft: false, skipTests: false, notes: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--draft') opts.draft = true;
    else if (a === '--skip-tests') opts.skipTests = true;
    else if (a === '--notes') opts.notes = argv[++i] || '';
    else if (!opts.bump) opts.bump = a;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!opts.bump) throw new Error('Indica la versión: patch, minor, major o un número (npm run release -- patch)');
  return opts;
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) throw new Error(`Versión actual no válida: ${current}`);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') { maj++; min = 0; pat = 0; }
  else if (bump === 'minor') { min++; pat = 0; }
  else if (bump === 'patch') pat++;
  else throw new Error(`"${bump}" no es patch, minor, major ni una versión X.Y.Z`);
  return `${maj}.${min}.${pat}`;
}

function cmpVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

function releaseNotes(prevTag, version, sha, extra) {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
  const log = out('git', ['log', range, '--no-merges', '--pretty=format:%s'])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Versión \d/.test(l));
  const lines = [];
  if (extra) lines.push(extra, '');
  if (log.length) lines.push('### Cambios', ...log.map((l) => `- ${l}`), '');
  lines.push('### Instalar', `Descarga \`Descargador-Setup-${version}.exe\` y ejecútalo. Si ya tienes Descargador, te avisará solo y podrás actualizar desde la propia app.`, '');
  lines.push(`SHA-256: \`${sha}\``);
  return lines.join('\n');
}

// ---------- flujo ----------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkgPath = path.join(root, 'package.json');
  const current = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  const version = nextVersion(current, opts.bump);
  const tag = `v${version}`;
  console.log(`Descargador ${current} -> ${version}${opts.dryRun ? ' (simulacro)' : ''}${opts.draft ? ' (borrador)' : ''}`);

  step('Comprobaciones');
  if (cmpVersions(version, current) <= 0) throw new Error(`La versión nueva (${version}) debe ser mayor que la actual (${current}).`);
  if (!opts.dryRun) {
    const dirty = out('git', ['status', '--porcelain']);
    if (dirty) throw new Error(`Hay cambios sin guardar. Haz commit primero (git add -A && git commit -m "..."):\n${dirty}`);
    const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== 'main') throw new Error(`Publica desde la rama main (estás en ${branch}).`);
    run('git', ['fetch', 'origin', '--quiet']);
    const behind = Number(out('git', ['rev-list', '--count', 'HEAD..origin/main']));
    if (behind > 0) throw new Error(`Tu rama está ${behind} commit(s) detrás de origin/main. Ejecuta: git pull --rebase`);
    if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFail: true }).status === 0) throw new Error(`La etiqueta ${tag} ya existe.`);
    const login = run('gh', ['api', 'user', '--jq', '.login'], { allowFail: true });
    if (login.status !== 0) throw new Error('GitHub CLI no está autenticado. Ejecuta: gh auth login');
    if (login.stdout.trim().toLowerCase() !== OWNER) {
      throw new Error(`gh está usando la cuenta "${login.stdout.trim()}" y el repositorio es de ${OWNER}. Ejecuta: gh auth switch --user ${OWNER}`);
    }
    if (run('gh', ['release', 'view', tag, '--repo', REPO], { allowFail: true }).status === 0) throw new Error(`Ya existe un release ${tag}.`);
  }
  for (const f of ['bin/yt-dlp.exe', 'bin/ffmpeg.exe']) if (!fs.existsSync(path.join(root, f))) throw new Error(`Falta ${f}`);

  if (!opts.skipTests) {
    step('Pruebas rápidas');
    run(npm, ['run', 'test:updater'], { stdio: 'inherit' });
  }

  step('Actualizando yt-dlp incluido en el instalador');
  const up = run(path.join(root, 'bin', 'yt-dlp.exe'), ['-U'], { allowFail: true });
  console.log((up.stdout || up.stderr || '').trim().split('\n').slice(-2).join('\n'));

  // Si algo falla antes del commit, se devuelve package.json a como estaba para no dejar la versión a medias.
  const lockPath = path.join(root, 'package-lock.json');
  const originals = [pkgPath, lockPath].map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]);
  const restore = () => originals.forEach(([f, buf]) => { if (buf) fs.writeFileSync(f, buf); });
  let committed = false;
  try {
    step(`Versión ${version} en package.json`);
    run(npm, ['version', version, '--no-git-tag-version', '--allow-same-version'], { stdio: 'inherit' });

    step('Compilando instalador (tarda unos minutos)');
    run(npm, ['run', 'dist'], { stdio: 'inherit' });
    const installer = path.join(root, 'installer', `Descargador-Setup-${version}.exe`);
    if (!fs.existsSync(installer)) throw new Error(`No se generó ${installer}`);
    const data = fs.readFileSync(installer);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    const sumFile = `${installer}.sha256`;
    fs.writeFileSync(sumFile, `${sha}  ${path.basename(installer)}\n`);
    console.log(`${path.basename(installer)}  ${(data.length / 1048576).toFixed(1)} MB  sha256 ${sha}`);

    if (opts.dryRun) {
      restore();
      console.log('\nSimulacro terminado: no se tocó git ni GitHub. Instalador en installer\\.');
      return;
    }

    step('Guardando la versión en git');
    run('git', ['add', 'package.json', 'package-lock.json']);
    run('git', ['commit', '-m', `Versión ${version}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`]);
    committed = true;
    const prevTag = run('git', ['describe', '--tags', '--abbrev=0', 'HEAD~1'], { allowFail: true });
    const notes = releaseNotes(prevTag.status === 0 ? prevTag.stdout.trim() : '', version, sha, opts.notes);
    run('git', ['tag', '-a', tag, '-m', `Descargador ${version}`]);

    step('Subiendo a GitHub');
    run('git', ['push', 'origin', 'main', tag], { stdio: 'inherit' });

    step(opts.draft ? 'Creando el release (borrador)' : 'Publicando el release');
    const notesFile = path.join(root, 'installer', `notes-${version}.md`);
    fs.writeFileSync(notesFile, notes);
    const args = ['release', 'create', tag, installer, sumFile, '--repo', REPO, '--title', `Descargador ${version}`, '--notes-file', notesFile, '--verify-tag'];
    if (opts.draft) args.push('--draft');
    const res = run('gh', args, { allowFail: true });
    fs.rmSync(notesFile, { force: true });
    if (res.status !== 0) {
      throw new Error(`El código ya está en GitHub pero el release falló:\n${res.stdout}${res.stderr}\nReintenta con: gh release create ${tag} "${installer}" "${sumFile}" --repo ${REPO} --title "Descargador ${version}"`);
    }
    console.log(`\n✔ Listo: ${res.stdout.trim()}`);
  } catch (e) {
    if (!committed) restore();
    throw e;
  }
}

try {
  main();
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
}
