package cl.hugo.descargador

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

private val I = RegexOption.IGNORE_CASE

/** Calidades disponibles (mismos ids que la versión de escritorio). */
object Formats {
    val labels = linkedMapOf(
        "best" to "Mejor calidad (MP4)",
        "2160" to "4K (2160p)",
        "1440" to "1440p",
        "1080" to "1080p",
        "720" to "720p",
        "480" to "480p",
        "360" to "360p",
        "mp3" to "Solo audio (MP3)",
        "m4a" to "Solo audio (M4A)",
        "original" to "Original sin conversión (MKV)",
    )

    private val mp4Pref = listOf("-S", "res,vcodec:h264,acodec:aac")

    fun args(id: String): List<String> {
        if (id.matches(Regex("\\d+"))) {
            return listOf("-f", "bv*[height<=$id]+ba/b[height<=$id]/bv*+ba/b") + mp4Pref + listOf("--merge-output-format", "mp4")
        }
        return when (id) {
            "mp3" -> listOf("-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0")
            "m4a" -> listOf("-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", "m4a", "--audio-quality", "0")
            "original" -> listOf("-f", "bv*+ba/b", "--merge-output-format", "mkv")
            else -> listOf("-f", "bv*+ba/b") + mp4Pref + listOf("--merge-output-format", "mp4")
        }
    }

    fun labelsJson(): JSONObject = JSONObject().also { o -> labels.forEach { (k, v) -> o.put(k, v) } }
}

object Urls {
    class Kind(val hasList: Boolean, val hasVideo: Boolean)

    private val listRe = Regex("[?&]list=|/playlist\\b", I)
    private val videoRe = Regex("[?&]v=|youtu\\.be/|/shorts/", I)
    private val urlRe = Regex("https?://[^\\s<>\"']+", I)
    private val idRes = listOf(
        Regex("[?&]v=([\\w-]{6,})"),
        Regex("youtu\\.be/([\\w-]{6,})"),
        Regex("/shorts/([\\w-]{6,})"),
    )

    // Sitios cuyos enlaces se añaden solos al copiarlos.
    private val watchHosts = Regex(
        "(^|\\.)(youtube\\.com|youtu\\.be|youtube-nocookie\\.com|vimeo\\.com|dailymotion\\.com|dai\\.ly|facebook\\.com|fb\\.watch|fb\\.com|" +
            "soundcloud\\.com|tiktok\\.com|instagram\\.com|instagr\\.am|threads\\.net|twitter\\.com|x\\.com|twitch\\.tv|reddit\\.com|redd\\.it|" +
            "bilibili\\.com|vk\\.com|rumble\\.com|streamable\\.com|kick\\.com)$", I,
    )
    private val cleanNameHosts = Regex("(^|\\.)(youtube\\.com|youtu\\.be|vimeo\\.com|dailymotion\\.com|soundcloud\\.com)$", I)

    fun kind(url: String) = Kind(listRe.containsMatchIn(url), videoRe.containsMatchIn(url))

    fun videoId(url: String): String {
        for (re in idRes) re.find(url)?.let { return it.groupValues[1] }
        return ""
    }

    /** Saca los enlaces de un texto, sin los signos que suelen pegarse al final. */
    fun extract(text: String?): List<String> =
        urlRe.findAll(text ?: "").map { it.value.trimEnd(')', ']', '.', ',', ';', ':', '!', '?') }.distinct().toList()

    fun host(url: String): String = try { URI(url).host ?: "" } catch (_: Exception) { "" }
    fun isWatched(url: String) = watchHosts.containsMatchIn(host(url))
    fun hasCleanName(url: String) = cleanNameHosts.containsMatchIn(host(url))
}

object Errors {
    fun firstLine(text: String?): String {
        val line = (text ?: "").lines().lastOrNull { it.startsWith("ERROR:") } ?: return ""
        return line.replace(Regex("^ERROR:\\s*(\\[[^\\]]+\\]\\s*)?"), "").take(300)
    }

    private val rules = listOf(
        "not a bot|confirm you.re not" to "YouTube pide comprobar que no eres un robot. Carga un cookies.txt en Preferencias.",
        "empty media response|login required|requires? (a )?login|log ?in|use --cookies|--cookies-from-browser|rate-limit|restricted video|age[- ]restricted|private (video|account)|protected tweet|NSFW" to
            "Requiere iniciar sesión. En Preferencias carga un archivo cookies.txt exportado desde tu navegador.",
        "No video could be found in this (tweet|post)|no video (formats )?found|does not contain (a )?video" to "Esta publicación no contiene video.",
        "IP address is blocked|geo.?restrict|not available in your country" to "El sitio bloquea tu región o IP para este contenido.",
        "Unsupported URL" to "Enlace no compatible.",
        "Video unavailable|has been removed|no longer available|deleted|does not exist|404" to "El video no está disponible (borrado o privado).",
        "Requested format is not available" to "Esa calidad no está disponible. Prueba con \"Mejor calidad\".",
        "HTTP Error 429|Too Many Requests" to "Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.",
        "Unable to download|getaddrinfo|timed out|Connection (reset|refused|aborted)|Network is unreachable" to "Sin conexión o el sitio no responde.",
    ).map { Regex(it.first, I) to it.second }

    /** Traduce los errores más comunes de yt-dlp a algo accionable. */
    fun friendly(raw: String?): String {
        val m = raw ?: ""
        for ((re, text) in rules) if (re.containsMatchIn(m)) return text
        return m.ifBlank { "Error desconocido" }
    }
}

fun sanitizeDirName(name: String): String =
    name.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_").trim().trimEnd('.', ' ').take(80)

// --- Ayudas para org.json: "" / null en vez de excepciones o la cadena "null" ---
fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")
fun JSONObject.dbl(key: String): Double? = if (isNull(key)) null else optDouble(key).takeUnless { it.isNaN() }
fun JSONObject.arr(key: String): JSONArray? = optJSONArray(key)
