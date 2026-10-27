package cl.hugo.descargador

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Mueve el archivo terminado desde la carpeta temporal de la app a Películas/Música visibles para el usuario. */
object Storage {
    class Published(val uri: String, val size: Long)

    private const val ROOT = "Descargador"

    fun mimeOf(file: File): String {
        val ext = file.extension.lowercase()
        return when (ext) {
            "mkv" -> "video/x-matroska"
            "m4a" -> "audio/mp4"
            "opus", "ogg" -> "audio/ogg"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    fun publish(ctx: Context, file: File, subDir: String): Published {
        val mime = mimeOf(file)
        val audio = mime.startsWith("audio/")
        val base = if (audio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES
        val rel = if (subDir.isEmpty()) "$base/$ROOT" else "$base/$ROOT/$subDir"
        val size = file.length()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val collection = if (audio) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            else MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val resolver = ctx.contentResolver
            val uri = resolver.insert(collection, values) ?: error("No se pudo crear el archivo en $rel")
            try {
                resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out, 256 * 1024) } }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
            return Published(uri.toString(), size)
        }

        // Android 7-9: escritura directa (permiso WRITE_EXTERNAL_STORAGE) y aviso al escáner de medios.
        @Suppress("DEPRECATION")
        val dir = File(Environment.getExternalStoragePublicDirectory(base), if (subDir.isEmpty()) ROOT else "$ROOT/$subDir")
        dir.mkdirs()
        var dest = File(dir, file.name)
        var n = 1
        while (dest.exists()) dest = File(dir, "${file.nameWithoutExtension} ($n).${file.extension}").also { n++ }
        file.copyTo(dest)
        val latch = CountDownLatch(1)
        var scanned: String? = null
        MediaScannerConnection.scanFile(ctx, arrayOf(dest.absolutePath), arrayOf(mime)) { _, uri ->
            scanned = uri?.toString()
            latch.countDown()
        }
        latch.await(5, TimeUnit.SECONDS)
        return Published(scanned ?: android.net.Uri.fromFile(dest).toString(), size)
    }
}
