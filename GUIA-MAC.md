# Descargador para macOS

La misma aplicación que en Windows (mismas pantallas, funciones y atajos), construida con Electron.

## 1. Elegir el instalador

| Archivo | Para qué Mac |
|---|---|
| `Descargador-<versión>-mac-arm64.dmg` | **Apple Silicon**: MacBook/iMac/Mac mini con chip M1, M2, M3, M4… (desde fines de 2020) |
| `Descargador-<versión>-mac-x64.dmg` | **Intel**: Macs más antiguos |

¿Cuál tengo? Menú  → **Acerca de este Mac**: si dice "Chip: Apple M…" usa **arm64**; si dice "Procesador: Intel…" usa **x64**.
Funciona en macOS 11 (Big Sur) o más nuevo.

## 2. Instalar

1. Abre el `.dmg` y arrastra **Descargador** a **Aplicaciones**.
2. La primera vez macOS avisará de que no puede comprobar la app. Es normal: **no está firmada con una cuenta de
   Apple Developer** (cuesta 99 USD al año). Para abrirla una sola vez:
   - **macOS 15 (Sequoia) o más nuevo**: abre Descargador, pulsa *Aceptar*, ve a **Ajustes del Sistema → Privacidad y
     seguridad**, baja hasta el aviso de *Descargador* y pulsa **Abrir de todos modos**.
   - **macOS 14 o anterior**: en Aplicaciones, **clic derecho** (o Control + clic) sobre Descargador → **Abrir** → **Abrir**.
   - **Con Terminal** (cualquier versión): `xattr -dr com.apple.quarantine /Applications/Descargador.app`
3. Después se abre con normalidad. Dentro del DMG también hay un `LEEME` con estos pasos.

## 3. Cómo se usa (igual que en Windows)

- Pega un enlace con **⌘V**, arrástralo a la ventana o simplemente **cópialo**: los enlaces de YouTube, Facebook, Instagram,
  TikTok, X y más se añaden solos y empiezan a bajar, incluso con la ventana minimizada o cerrada.
- Los videos se guardan en **Películas → Descargador** (se cambia en Preferencias).
- Listas de reproducción con selector de videos, calidades (4K… 360p, MP3, M4A), pausa/reanudar, subtítulos, cookies del
  navegador (en Mac también **Safari**; necesita *Acceso total al disco* para Descargador) o `cookies.txt`.
- **Notificaciones**: macOS pedirá permiso la primera vez. Ajustes del Sistema → Notificaciones → Descargador.

## 4. Diferencias con Windows

- Al cerrar la ventana (botón rojo) la app **sigue funcionando** en segundo plano, vigilando el portapapeles y
  descargando. Para salir del todo: **⌘Q**. El icono del Dock vuelve a abrir la ventana.
- El portapapeles detecta un enlace cuando cambia el texto copiado. Si copias **exactamente el mismo enlace** dos veces
  seguidas (por ejemplo, tras quitarlo de la lista) no lo detecta; cópialo otra vez después de copiar otra cosa, o pégalo con ⌘V.
- **Actualizaciones**: la app avisa cuando hay versión nueva; "Instalar ahora" descarga el DMG, comprueba su SHA-256 y lo
  abre; arrastra Descargador a Aplicaciones y reemplaza la anterior (sin firma de Apple no puede reemplazarse sola).
  yt-dlp (el motor) sí se actualiza solo desde Preferencias → Buscar actualización.

## 5. Para quien desarrolla

- Un Mac no se puede compilar desde Windows. Los DMG los construye GitHub Actions
  (`.github/workflows/mac.yml`, ejecutores macOS gratuitos en repos públicos).
- **Al publicar** con `npm run release -- minor`, el workflow se dispara solo y añade los DMG al mismo release.
- **A mano**: GitHub → Actions → *Instaladores de macOS* → *Run workflow* (los DMG quedan como artefactos 14 días;
  si indicas una etiqueta, también se suben a ese release). Desde la terminal: `gh workflow run mac.yml`.
- **En un Mac** también se puede: `npm ci && npm run dist:mac` (descarga yt-dlp y ffmpeg, firma ad-hoc y crea el DMG).
- Para quitar el aviso de "desarrollador no identificado" hay que pagar Apple Developer Program y notarizar la app.
