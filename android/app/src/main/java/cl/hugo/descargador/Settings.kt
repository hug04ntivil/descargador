package cl.hugo.descargador

import org.json.JSONObject
import java.io.File

/** Preferencias en settings.json (mismos nombres que en el escritorio). */
class Settings(private val file: File) {
    private var o = JSONObject()

    private val defaults = JSONObject()
        .put("maxConcurrent", 2)
        .put("speedLimit", "")
        .put("proxy", "")
        .put("cookiesBrowser", "")
        .put("cookiesFile", "")
        .put("playlists", "ask")
        .put("defaultFormat", "1080")
        .put("subtitles", false)
        .put("subLangs", "es.*,en.*")
        .put("embedMetadata", true)
        .put("embedThumbnail", false)
        .put("clipboardWatch", true)

    init { load() }

    @Synchronized
    private fun load() {
        o = try { JSONObject(file.readText()) } catch (_: Exception) { JSONObject() }
        for (k in defaults.keys()) if (!o.has(k)) o.put(k, defaults.get(k))
    }

    @Synchronized
    fun patch(p: JSONObject) {
        for (k in defaults.keys()) if (p.has(k)) o.put(k, p.get(k))
        val max = o.optInt("maxConcurrent", 2).coerceIn(1, 4)
        o.put("maxConcurrent", max)
        try { file.writeText(o.toString()) } catch (_: Exception) { /* sin espacio: se pierde el guardado */ }
    }

    @Synchronized fun str(k: String): String = o.optString(k, defaults.optString(k, ""))
    @Synchronized fun bool(k: String): Boolean = o.optBoolean(k, defaults.optBoolean(k, false))
    @Synchronized fun int(k: String): Int = o.optInt(k, defaults.optInt(k, 0))

    /** Copia para la interfaz (outputDir es solo informativo en Android). */
    @Synchronized
    fun json(): JSONObject = JSONObject(o.toString()).put("outputDir", "Películas/Descargador")
}
