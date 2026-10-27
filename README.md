# Descargador

Aplicación de escritorio para Windows (uso privado) para descargar videos y audio. Interfaz inspirada en MediaHuman YouTube Downloader; el motor es [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg.

## Funciones
- Cola de descargas con miniatura, progreso, velocidad y tiempo restante.
- Pegar enlaces (`Ctrl+V`), arrastrarlos a la ventana o copiarlos: se añaden solos desde el portapapeles.
- Listas de reproducción y canales: al añadir un enlace con varios videos se abre un selector (marcar/desmarcar, filtrar por título, "Solo el video del enlace"). En Preferencias se puede elegir "descargar la lista completa" o "solo el video del enlace" sin preguntar. Los videos van a una subcarpeta con el nombre de la lista.
- Instagram, TikTok, X, Facebook, Twitch, Reddit y más: se pegan o copian igual que YouTube. Si el sitio exige sesión, usa las cookies del navegador (Firefox funciona mejor) o un archivo cookies.txt en Preferencias.
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

## Android
La misma interfaz corre en Android (`android/`): Kotlin + WebView + [youtubedl-android](https://github.com/JunkFood02/youtubedl-android)
(Python, yt-dlp, ffmpeg y QuickJS dentro del APK). Guía de instalación y uso en [GUIA-ANDROID.md](GUIA-ANDROID.md).

```
powershell -File android\build-apk.ps1      # APKs firmados en installer\ (universal + por arquitectura)
```
La interfaz web se comparte con el escritorio (`src/renderer`); solo `platform.js` cambia (puente Kotlin en vez de Electron).

## Notas
- El portapapeles se vigila con `GetClipboardSequenceNumber` (vía koffi) para detectar incluso una copia repetida del mismo enlace. En Electron 45 `clipboard.readText()` es asíncrono (devuelve una promesa).
- El instalador es por usuario (no pide administrador), así yt-dlp puede actualizarse solo.
- El solucionador de firmas de YouTube necesita un runtime JS: la app usa su propio Electron como Node (`ELECTRON_RUN_AS_NODE`), sin instalar nada más.
- El instalador no está firmado: Windows SmartScreen puede avisar la primera vez ("Más información" → "Ejecutar de todas formas").
- Respeta los términos de servicio de cada sitio y los derechos de autor; úsalo solo con contenido que puedas descargar.
