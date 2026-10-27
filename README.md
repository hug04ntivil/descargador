# Descargador

Aplicación de escritorio para Windows (uso privado) para descargar videos y audio. Interfaz inspirada en MediaHuman YouTube Downloader; el motor es [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg.

## Funciones
- Cola de descargas con miniatura, progreso, velocidad y tiempo restante.
- Pegar enlaces (`Ctrl+V`), arrastrarlos a la ventana o copiarlos: se añaden solos desde el portapapeles.
- Listas de reproducción y canales: al añadir un enlace con varios videos se abre un selector (marcar/desmarcar, filtrar por título, "Solo el video del enlace"). En Preferencias se puede elegir "descargar la lista completa" o "solo el video del enlace" sin preguntar. Los videos van a una subcarpeta con el nombre de la lista.
- **Segundo plano**: con la ventana minimizada el portapapeles sigue funcionando y la descarga empieza sola. Un video dentro de una lista (`&list=...`) baja solo ese video, sin esperar una elección; una playlist completa avisa y espera tu decisión. Windows muestra avisos cuando la descarga inicia o termina y cuando un enlace no se pudo añadir.
- **Facebook**, Instagram, TikTok, X, Twitch, Reddit y más: se pegan o copian igual que YouTube (también los enlaces `l.facebook.com/l.php?u=...` que salen de Messenger). Los videos públicos de Facebook bajan sin iniciar sesión; los privados, de grupos o con restricción necesitan las cookies del navegador (Firefox funciona mejor) o un archivo cookies.txt en Preferencias.
- Calidades: mejor, 4K, 1440p, 1080p, 720p, 480p, 360p; solo audio MP3 o M4A; original sin conversión (MKV).
- Pausar/reanudar, reintentar, descargas simultáneas, límite de velocidad, proxy, cookies del navegador.
- Subtítulos, metadatos y miniatura incrustados (opcional).
- Botón para actualizar yt-dlp desde Preferencias.

## Desarrollo
```
npm install
node node_modules/electron/install.js   # descarga el binario de Electron si hace falta
npm start                                # ejecutar
npm run test:core                        # prueba de integración (descarga un video de 19 s)
npm run dist                             # empaqueta e instala: installer/Descargador-Setup-<versión>.exe
```
`bin/` debe contener `yt-dlp.exe` y `ffmpeg.exe` (no se versionan).

## Guardar cambios y publicar versiones
Repositorio: <https://github.com/hug04ntivil/descargador> (rama `main`).

**Día a día**: edita, prueba con `npm start` y guarda en GitHub:
```
git add -A
git commit -m "Qué cambié"
git push
```

**Publicar una versión nueva** (compila el instalador, lo sube a GitHub Releases y las apps instaladas avisan solas):
```
npm run release -- patch      # 1.1.0 -> 1.1.1  (correcciones)
npm run release -- minor      # 1.1.0 -> 1.2.0  (funciones nuevas)
npm run release -- major      # 1.1.0 -> 2.0.0
```
Antes hay que tener todo guardado con `git commit`. Opciones: `--draft` (crea el release como borrador para revisarlo),
`--dry-run` (compila sin tocar git ni GitHub), `--notes "texto"` (novedades; por defecto se usan los mensajes de commit).
El script comprueba que estés en `main`, que `gh` use la cuenta `hug04ntivil`, actualiza yt-dlp, compila, crea el commit
`Versión X.Y.Z` con su etiqueta `vX.Y.Z`, sube todo y publica `Descargador-Setup-X.Y.Z.exe` con su suma SHA-256.

**Cómo se actualizan las apps instaladas**: 15 s después de abrir (y cada 12 h) consultan el último release; si hay uno más
nuevo muestran un aviso con **Instalar ahora**. Descarga el instalador desde `github.com/hug04ntivil/descargador/releases`,
verifica su SHA-256, lo ejecuta en silencio y vuelve a abrir la app. Se puede desactivar en Preferencias. Las pruebas del
actualizador: `npm run test:updater`.

## Android
La misma interfaz corre en Android (`android/`): Kotlin + WebView + [youtubedl-android](https://github.com/JunkFood02/youtubedl-android)
(Python, yt-dlp, ffmpeg y QuickJS dentro del APK). Guía de instalación y uso en [GUIA-ANDROID.md](GUIA-ANDROID.md).

```
powershell -File android\build-apk.ps1      # APKs firmados en installer\ (universal + por arquitectura)
```
La interfaz web se comparte con el escritorio (`src/renderer`); solo `platform.js` cambia (puente Kotlin en vez de Electron).

## macOS
La misma app corre en macOS (Apple Silicon e Intel). Guía de instalación y diferencias en [GUIA-MAC.md](GUIA-MAC.md).
Los DMG los construye GitHub Actions (`.github/workflows/mac.yml`) porque un Mac no se puede compilar ni firmar desde Windows:
- Al publicar con `npm run release -- ...` se disparan solos y añaden `Descargador-<versión>-mac-arm64.dmg` y `-mac-x64.dmg` al release.
- A mano: `gh workflow run mac.yml` (los DMG quedan como artefactos 14 días; con `-f tag=vX.Y.Z` también se suben a ese release).
- En un Mac: `npm ci && npm run dist:mac`.
- Cada ejecución prueba la app empaquetada de verdad en macOS: descarga un video, lo convierte a MP3 con ffmpeg y
  comprueba que el vigilante del portapapeles detecta un enlace copiado (`test/smoke-packaged.js`, `test/smoke-clipboard.js`).
- Sin cuenta de pago de Apple la app va firmada "ad-hoc" y no notarizada: la primera vez hay que abrirla con
  clic derecho → Abrir (o "Abrir de todos modos" en Ajustes → Privacidad y seguridad).

## Notas
- Los binarios incluidos (yt-dlp, ffmpeg) tienen sus propias licencias; ffmpeg se distribuye en builds estáticos (GPL).
- El portapapeles se vigila con `GetClipboardSequenceNumber` (vía koffi) para detectar incluso una copia repetida del mismo enlace. En Electron 45 `clipboard.readText()` es asíncrono (devuelve una promesa).
- El instalador es por usuario (no pide administrador), así yt-dlp puede actualizarse solo.
- El solucionador de firmas de YouTube necesita un runtime JS: la app usa su propio Electron como Node (`ELECTRON_RUN_AS_NODE`), sin instalar nada más.
- El instalador no está firmado: Windows SmartScreen puede avisar la primera vez ("Más información" → "Ejecutar de todas formas").
- Respeta los términos de servicio de cada sitio y los derechos de autor; úsalo solo con contenido que puedas descargar.
