# Descargador para Android: guía rápida

Archivos listos en la carpeta `installer/` (todos firmados con la misma llave, Android 7.0 o superior):

| Archivo | Tamaño | Cuándo usarlo |
|---|---|---|
| `Descargador-Android-universal.apk` | 146 MB | **Funciona en cualquier teléfono.** Si dudas, este. |
| `Descargador-Android-arm64-v8a.apk` | 54 MB | Casi todos los teléfonos de 2017 en adelante. Más fácil de enviar (cabe en WhatsApp). |
| `Descargador-Android-armeabi-v7a.apk` | 48 MB | Teléfonos antiguos de 32 bits. |
| `Descargador-Android-x86_64.apk` | 57 MB | Emuladores y Chromebooks. |

No instales dos a la vez: cada uno reemplaza al anterior.

## 1. Instalar en tu teléfono (2 minutos)

1. Pasa el APK al teléfono: cable USB, Google Drive, Telegram o WhatsApp ("Mensajes a ti mismo", solo el de 54 MB).
2. En el teléfono, ábrelo desde la app **Archivos** o **Descargas**.
3. Android pedirá permiso para instalar apps desde esa fuente:
   **Ajustes → permitir "Instalar apps desconocidas"** para esa app (Archivos, Chrome, Drive…) → vuelve atrás → **Instalar**.
4. Si Google Play Protect avisa de una app "no verificada": **Más detalles → Instalar de todos modos**.
   Es normal con una app propia que no está en Play.
5. Abre **Descargador** y acepta el permiso de **notificaciones**.
   La primera vez tarda unos segundos: extrae Python, yt-dlp y ffmpeg y se actualiza solo.

Por USB, como desarrollador (depuración USB activada):

```
adb install -r installer\Descargador-Android-universal.apk
```

## 2. Cómo se usa

| Quiero… | Hago… |
|---|---|
| Descargar desde otra app | En YouTube, Instagram, TikTok, X, el navegador…: **Compartir → Descargador** |
| Descargar un enlace copiado | Copia el enlace y abre Descargador: lo añade solo (o pulsa **Pegar**) |
| Elegir calidad o solo audio | Selector junto a **Añadir** (4K … 360p, MP3, M4A) |
| Bajar una playlist | Pega el enlace de la lista → se abre el selector de videos (marcar/desmarcar, filtrar, "Solo el video del enlace") |
| Ver lo descargado | Videos en **Películas/Descargador** (aparecen en la Galería); audio en **Música/Descargador** |
| Reproducir al terminar | Toca la miniatura o el botón ▶ de la descarga |
| Instagram/X/TikTok que piden sesión | Preferencias → **Archivo cookies.txt** (exportado desde tu navegador de escritorio) |
| Si YouTube deja de funcionar | Preferencias → **Buscar actualización** (YouTube cambia seguido; también se actualiza solo cada 12 h al abrir) |

Las descargas siguen en segundo plano con una notificación fija. Si tu marca corta las apps en segundo plano
(Xiaomi, Huawei, Samsung, Oppo…): **Ajustes → Apps → Descargador → Batería → Sin restricciones**.

## 3. Volver a compilar (opcional)

Las herramientas (JDK 17, Android SDK, Gradle) están en `.android-tools/` y la firma en `android/keystore/`.

```
powershell -File android\build-apk.ps1
```

Regenera los cuatro APK en `installer/`. También puedes abrir la carpeta `android/` con Android Studio.
La interfaz es la misma del escritorio (`src/renderer`), así que un cambio ahí se refleja en Windows y en Android.

> **Guarda una copia de `android/keystore/` y `android/keystore.properties`.** Android solo deja actualizar una app
> con la misma firma: si pierdes esa llave, la próxima versión habrá que instalarla borrando la anterior.
> No los compartas ni los subas a ningún repositorio.

`.android-tools/` pesa unos 4 GB (JDK, SDK, Gradle y el emulador con su imagen de Android, usados para probar).
Si solo vas a recompilar, puedes borrar `.android-tools\sdk\emulator` y `.android-tools\sdk\system-images`.

## 4. Lo que conviene saber

- **No la subas a Google Play.** Las políticas de Play (Device and Network Abuse) rechazan apps que descargan
  videos de YouTube sin respetar sus condiciones de uso, y subirla pone en riesgo tu cuenta de desarrollador.
  Para uso privado basta el APK; tu cuenta de desarrollador no hace falta para instalarlo.
- **Verificación de desarrolladores de Google:** desde el 30-sep-2026 Google exige apps registradas por
  desarrolladores verificados en Brasil, Indonesia, Singapur y Tailandia, y lo extenderá al resto del mundo desde 2027.
  Chile no está en la primera fase; cuando llegue, tu cuenta de desarrollador te servirá para registrar el paquete
  `cl.hugo.descargador`.
- **Probado en:** emulador Android 14 (x86_64) con YouTube (video, MP3, playlist con selector, pausa/reanudar),
  Instagram, "Compartir", botón atrás y preferencias. **No probado** en un teléfono físico, con el portapapeles
  automático ni con TikTok/X; el APK arm64 es el mismo código y las mismas librerías.
- Respeta los derechos de autor y las condiciones de cada sitio; úsala solo con contenido que puedas descargar.
