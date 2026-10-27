package cl.hugo.descargador

import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Cola de descargas: port a Kotlin de src/core.js del escritorio.
 * Cada descarga es un proceso yt-dlp (vía youtubedl-android); la pausa mata el proceso y
 * al reanudar yt-dlp continúa el archivo .part de la carpeta temporal.
 */
class DownloadManager(private val app: App) {
    interface Sink {
        fun items(list: List<JSONObject>)
        fun removed(id: String)
        fun notice(type: String, text: String)
        fun choose(choice: JSONObject)
    }

    @Volatile var sink: Sink? = null

    private class Choice(val url: String, val playlist: String, val entries: List<JSONObject>, val fromPlaylist: Boolean)
    private class Resolved(val playlist: String, val entries: List<JSONObject>, val fromPlaylist: Boolean)
    private class DlState {
        val files = ArrayList<String>()
        var lastErr = ""
        var final = ""
    }

    private val lock = Any()
    private val items = LinkedHashMap<String, Item>()
    private val choices = HashMap<String, Choice>()
    private val active = setOf("downloading", "processing")
    private var saveTask: ScheduledFuture<*>? = null
    private val queueFile get() = File(app.filesDir, "queue.json")

    init { restore() }

    // ---------- persistencia ----------
    private fun restore() {
        val arr = try { JSONArray(queueFile.readText()) } catch (_: Exception) { return }
        synchronized(lock) {
            for (i in 0 until arr.length()) {
                val it = try { Item.fromJson(arr.getJSONObject(i)) } catch (_: Exception) { continue }
                when (it.status) {
                    "choosing" -> continue
                    "downloading", "processing", "queued" -> it.status = "paused"
                    "analyzing" -> { it.status = "error"; it.error = "Análisis interrumpido" }
                }
                items[it.id] = it
            }
        }
    }

    private fun scheduleSave() {
        synchronized(lock) {
            saveTask?.cancel(false)
            saveTask = App.sched.schedule({
                val json = synchronized(lock) { JSONArray(items.values.map { it.toJson() }) }
                try { queueFile.writeText(json.toString()) } catch (_: Exception) { /* sin espacio */ }
            }, 800, TimeUnit.MILLISECONDS)
        }
    }

    private fun emit(item: Item) {
        sink?.items(listOf(item.toJson()))
        scheduleSave()
    }

    private fun notice(type: String, text: String) { sink?.notice(type, text) }

    fun list(): JSONArray = synchronized(lock) { JSONArray(items.values.map { it.toJson() }) }

    fun stats(): JSONObject {
        var activeN = 0; var queued = 0; var done = 0; var speed = 0.0
        synchronized(lock) {
            for (i in items.values) when {
                i.status in active -> { activeN++; speed += i.speed ?: 0.0 }
                i.status == "queued" -> queued++
                i.status == "done" -> done++
            }
            return JSONObject().put("active", activeN).put("queued", queued).put("done", done)
                .put("speed", speed).put("total", items.size)
        }
    }

    private fun statsChanged() = app.onStats(stats())

    // ---------- análisis de enlaces ----------
    private fun commonArgs(): List<String> {
        val s = app.settings
        val a = ArrayList<String>()
        a += listOf("--encoding", "utf-8")
        if (s.str("proxy").isNotBlank()) a += listOf("--proxy", s.str("proxy"))
        val cookies = s.str("cookiesFile")
        if (cookies.isNotBlank() && File(cookies).exists()) a += listOf("--cookies", cookies)
        return a
    }

    private fun fetchInfo(url: String, noPlaylist: Boolean): JSONObject {
        val req = YoutubeDLRequest(url)
        val args = arrayListOf("-J", "--flat-playlist", "--no-warnings", "--ignore-errors")
        if (noPlaylist) args += "--no-playlist"
        args += commonArgs()
        req.addCommands(args)
        val out = try {
            YoutubeDL.getInstance().execute(req).out
        } catch (e: YoutubeDLException) {
            throw Exception(Errors.firstLine(e.message).ifEmpty { e.message ?: "No se pudo analizar el enlace" })
        }.trim()
        if (out.isEmpty() || out == "null") throw Exception("No se pudo analizar el enlace")
        return try { JSONObject(out) } catch (_: Exception) { throw Exception("Respuesta inválida de yt-dlp") }
    }

    private fun thumbOf(e: JSONObject): String {
        e.str("thumbnail").takeIf { it.isNotEmpty() }?.let { return it }
        e.arr("thumbnails")?.let { t -> if (t.length() > 0) t.optJSONObject(t.length() - 1)?.str("url")?.takeIf { it.isNotEmpty() }?.let { return it } }
        val id = e.str("id")
        if (id.isNotEmpty() && Regex("youtube", RegexOption.IGNORE_CASE).containsMatchIn(e.str("ie_key") + e.str("extractor_key"))) {
            return "https://i.ytimg.com/vi/$id/mqdefault.jpg"
        }
        return ""
    }

    private fun resolve(url: String, noPlaylist: Boolean, depth: Int = 0): Resolved {
        val info = fetchInfo(url, noPlaylist)
        if (info.str("_type") == "playlist" && depth < 2) {
            val raw = info.arr("entries") ?: JSONArray()
            var entries = (0 until raw.length()).mapNotNull { raw.optJSONObject(it) }
            // Canal: sus entradas son pestañas (Videos, Shorts...). Se elige "Videos".
            val isTab = { e: JSONObject -> e.str("_type") == "playlist" || e.str("ie_key").contains("YoutubeTab", true) }
            if (entries.isNotEmpty() && entries.all(isTab)) {
                val tab = entries.firstOrNull { e -> Regex("/videos/?$").containsMatchIn(e.str("url").ifEmpty { e.str("webpage_url") }) } ?: entries[0]
                return resolve(tab.str("url").ifEmpty { tab.str("webpage_url") }, false, depth + 1)
            }
            // Se descartan los videos borrados/privados, que llegan sin título.
            entries = entries.filter { e ->
                !Regex("^\\[(private|deleted) video]$", RegexOption.IGNORE_CASE).matches(e.str("title")) &&
                    !(e.str("ie_key").isNotEmpty() && e.str("title").isEmpty())
            }
            return Resolved(info.str("title"), entries, true)
        }
        return Resolved("", listOf(info), false)
    }

    private fun applyEntry(item: Item, e: JSONObject, idx: Int, fromPlaylist: Boolean, baseUrl: String) {
        // "inline": la entrada trae sus datos dentro de la lista (varios videos en un post de Instagram).
        val inline = fromPlaylist && e.str("ie_key").isEmpty() && e.str("_type") != "url"
        item.url = if (inline) baseUrl else e.str("webpage_url").ifEmpty { e.str("url") }
            .ifEmpty { if (e.str("id").isNotEmpty()) "https://www.youtube.com/watch?v=${e.str("id")}" else baseUrl }
        item.playlistIndex = if (inline) idx + 1 else 0
        item.title = e.str("title").ifEmpty { e.str("id") }.ifEmpty { baseUrl }
        item.uploader = e.str("uploader").ifEmpty { e.str("channel") }.ifEmpty { e.str("uploader_id") }
        item.duration = e.dbl("duration")
        item.thumbnail = thumbOf(e)
    }

    // ---------- cola ----------
    /** mode: auto | video (solo el video del enlace) | all (toda la lista sin preguntar). */
    fun add(rawUrl: String, format: String?, mode: String = "auto", silentFail: Boolean = false) {
        val url = rawUrl.trim()
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return
        synchronized(lock) {
            if (items.values.any { it.sourceUrl == url && it.status != "error" && it.status != "canceled" }) {
                notice("info", "Ese enlace ya está en la lista")
                return
            }
        }
        val st = app.settings
        val fmt = if (format != null && Formats.labels.containsKey(format)) format else st.str("defaultFormat")
        val kind = Urls.kind(url)
        var m = mode
        if (m == "auto") {
            if (kind.hasList && kind.hasVideo && st.str("playlists") == "video") m = "video"
            else if (st.str("playlists") == "all") m = "all"
        }
        val noPlaylist = kind.hasVideo && (m == "video" || !kind.hasList)

        val ph = Item(UUID.randomUUID().toString()).apply {
            this.url = url; sourceUrl = url; title = url; this.format = fmt; status = "analyzing"
        }
        synchronized(lock) { items[ph.id] = ph }
        emit(ph)
        App.io.execute { analyze(ph, url, m, noPlaylist, silentFail) }
    }

    private fun analyze(ph: Item, url: String, mode: String, noPlaylist: Boolean, silentFail: Boolean) {
        try {
            App.awaitReady()
            val res = resolve(url, noPlaylist)
            if (synchronized(lock) { !items.containsKey(ph.id) }) return
            if (res.entries.isEmpty()) throw Exception("El enlace no contiene videos")
            if (res.entries.size > 1 && mode != "all") { offerChoice(ph, url, res); return }
            materialize(ph, res.entries.mapIndexed { i, e -> i to e }, res.playlist, res.fromPlaylist)
            if (res.entries.size > 1) notice("info", "Lista añadida: ${res.entries.size} videos")
            pump()
        } catch (e: Throwable) {
            val friendly = Errors.friendly(e.message)
            val exists = synchronized(lock) { items.containsKey(ph.id) }
            if (!exists) return
            if (silentFail) {
                synchronized(lock) { items.remove(ph.id) }
                sink?.removed(ph.id)
                scheduleSave()
                notice("error", friendly)
            } else {
                ph.status = "error"; ph.error = friendly; ph.errorDetail = e.message ?: ""
                emit(ph)
            }
        }
    }

    /** Convierte las entradas elegidas en elementos de la cola (la primera reutiliza la fila). */
    private fun materialize(ph: Item, picks: List<Pair<Int, JSONObject>>, playlist: String, fromPlaylist: Boolean) {
        val baseUrl = ph.sourceUrl
        val pl = if (picks.size > 1) playlist else ""
        val created = ArrayList<Item>()
        synchronized(lock) {
            picks.forEachIndexed { n, (idx, e) ->
                val it = if (n == 0) ph else Item(UUID.randomUUID().toString()).also { x -> x.format = ph.format; items[x.id] = x }
                applyEntry(it, e, idx, fromPlaylist, baseUrl)
                it.playlist = pl; it.status = "queued"; it.error = ""; it.errorDetail = ""
                it.sourceUrl = if (n == 0) baseUrl else it.url
                created += it
            }
        }
        created.forEach { emit(it) }
    }

    private fun offerChoice(ph: Item, url: String, res: Resolved) {
        ph.status = "choosing"; ph.title = res.playlist.ifEmpty { url }; ph.playlist = res.playlist
        ph.thumbnail = thumbOf(res.entries[0]); ph.uploader = "${res.entries.size} videos"
        synchronized(lock) { choices[ph.id] = Choice(url, res.playlist, res.entries, res.fromPlaylist) }
        emit(ph)
        val vid = Urls.videoId(url)
        val entries = JSONArray()
        res.entries.forEach { e ->
            entries.put(JSONObject().put("title", e.str("title").ifEmpty { e.str("id") })
                .put("duration", e.dbl("duration") ?: JSONObject.NULL).put("thumbnail", thumbOf(e))
                .put("uploader", e.str("uploader").ifEmpty { e.str("channel") }))
        }
        sink?.choose(JSONObject().put("id", ph.id).put("title", res.playlist.ifEmpty { url }).put("format", ph.format)
            .put("hasVideo", vid.isNotEmpty())
            .put("current", if (vid.isEmpty()) -1 else res.entries.indexOfFirst { it.str("id") == vid })
            .put("entries", entries))
    }

    fun resolveChoice(id: String, indexes: List<Int>) {
        val ch: Choice; val ph: Item
        synchronized(lock) { ch = choices.remove(id) ?: return; ph = items[id] ?: return }
        val picks = indexes.distinct().filter { it in ch.entries.indices }.sorted().map { it to ch.entries[it] }
        if (picks.isEmpty()) { remove(id); return }
        materialize(ph, picks, ch.playlist, ch.fromPlaylist)
        if (picks.size > 1) notice("info", "Se añadieron ${picks.size} videos")
        pump()
    }

    /** "Solo este video": ignora la lista y baja únicamente el video del enlace. */
    fun chooseSingle(id: String) {
        val ch: Choice; val ph: Item
        synchronized(lock) { ch = choices[id] ?: return; ph = items[id] ?: return }
        val idx = ch.entries.indexOfFirst { it.str("id") == Urls.videoId(ch.url) }
        if (idx >= 0) { resolveChoice(id, listOf(idx)); return }
        synchronized(lock) { choices.remove(id); items.remove(id) }
        sink?.removed(id)
        add(ch.url, ph.format, "video")
    }

    private fun pump() {
        val max = app.settings.int("maxConcurrent").coerceIn(1, 4)
        val start = ArrayList<Item>()
        synchronized(lock) {
            var running = items.values.count { it.status in active }
            for (i in items.values) {
                if (running >= max) break
                if (i.status == "queued") {
                    i.status = "downloading"; i.error = ""; i.errorDetail = ""; i.stop = null
                    if (i.progress >= 100) i.progress = 0.0
                    running++; start += i
                }
            }
        }
        start.forEach { emit(it); App.io.execute { download(it) } }
        statsChanged()
    }

    // ---------- descarga ----------
    private fun buildArgs(item: Item, dir: File): List<String> {
        val s = app.settings
        val a = ArrayList<String>()
        a += listOf("--newline", "--no-colors", "--progress", "--windows-filenames", "--no-mtime")
        a += if (item.playlistIndex > 0) listOf("--playlist-items", item.playlistIndex.toString()) else listOf("--no-playlist")
        a += listOf("--retries", "10", "--fragment-retries", "10", "--concurrent-fragments", "4")
        a += commonArgs()
        a += Formats.args(item.format)
        a += listOf(
            "--progress-template",
            "download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s|%(info.format_id)s|%(progress.fragment_index)s|%(progress.fragment_count)s",
            "--progress-template", "postprocess:PP|%(progress.status)s|%(progress.postprocessor)s",
            "--print", "after_move:FINAL|%(filepath)s",
        )
        // En redes sociales muchos títulos se repiten ("Video by ..."), así que se añade el id.
        val name = if (Urls.hasCleanName(item.url)) "%(title).150B.%(ext)s" else "%(title).120B [%(id)s].%(ext)s"
        a += listOf("-o", File(dir, name).absolutePath)
        if (s.str("speedLimit").isNotBlank()) a += listOf("-r", s.str("speedLimit"))
        if (s.bool("embedMetadata")) a += "--embed-metadata"
        if (s.bool("embedThumbnail")) a += listOf("--embed-thumbnail", "--convert-thumbnails", "jpg")
        if (s.bool("subtitles") && item.format != "mp3" && item.format != "m4a") {
            a += listOf("--write-subs", "--write-auto-subs", "--sub-langs", s.str("subLangs").ifBlank { "es.*,en.*" }, "--embed-subs")
        }
        return a
    }

    private fun download(item: Item) {
        val dir = File(app.stagingRoot(), item.id)
        try {
            App.awaitReady()
            if (item.stop != null) { handleStop(item, dir); return }
            dir.mkdirs()
            val st = DlState()
            val req = YoutubeDLRequest(item.url).addCommands(buildArgs(item, dir))
            YoutubeDL.getInstance().execute(req, item.id) { _, _, line -> onLine(item, st, line) }
            if (item.stop != null) { handleStop(item, dir); return }
            finish(item, st, dir)
        } catch (_: YoutubeDL.CanceledException) {
            handleStop(item, dir)
        } catch (_: InterruptedException) {
            handleStop(item, dir)
        } catch (e: YoutubeDLException) {
            if (item.stop != null) { handleStop(item, dir); return }
            val raw = Errors.firstLine(e.message)
            fail(item, if (raw.isEmpty()) (e.message ?: "Error de yt-dlp").take(200) else Errors.friendly(raw), raw)
        } catch (e: Throwable) {
            fail(item, e.message ?: "Error inesperado", e.toString())
        }
        pump()
    }

    private fun onLine(item: Item, st: DlState, line: String) {
        when {
            line.startsWith("PROG|") -> {
                val f = line.split("|")
                if (f.size < 11) return
                val (status, dl, total, est, speed) = listOf(f[1], f[2], f[3], f[4], f[5])
                val eta = f[6]; val filename = f[7]; val formatId = f[8]; val fragIdx = f[9]; val fragCnt = f[10]
                if (!st.files.contains(filename)) st.files += filename
                val idx = st.files.indexOf(filename)
                val streams = if (formatId.contains('+')) formatId.split('+').size else 1
                val tot = total.toDoubleOrNull() ?: est.toDoubleOrNull()
                var frac: Double? = tot?.let { (dl.toDoubleOrNull() ?: 0.0).div(it).coerceAtMost(1.0) }
                if (frac == null) {
                    val c = fragCnt.toDoubleOrNull()
                    if (c != null && c > 0) frac = ((fragIdx.toDoubleOrNull() ?: 0.0) / c).coerceAtMost(1.0)
                }
                if (status == "finished") frac = 1.0
                if (frac != null) {
                    // Con video+audio el video pesa mucho más: se reparte 85% / 15%.
                    val w = if (streams == 2) doubleArrayOf(0.85, 0.15) else doubleArrayOf(1.0)
                    val n = minOf(idx, w.size - 1)
                    val before = w.take(n).sum()
                    val p = minOf(99.0, (before + w[n] * frac) * 100)
                    item.progress = maxOf(item.progress, Math.round(p * 10) / 10.0)
                }
                item.speed = if (status == "finished") null else speed.toDoubleOrNull()
                item.eta = if (status == "finished") null else eta.toDoubleOrNull()
                item.status = "downloading"
                val now = System.currentTimeMillis()
                if (now - item.lastEmit >= 250) { item.lastEmit = now; emit(item) }
            }
            line.startsWith("PP|") -> {
                val f = line.split("|")
                if (f.size >= 3 && f[1] == "started" && f[2] != "MoveFiles") {
                    item.status = "processing"; item.progress = maxOf(item.progress, 99.0)
                    item.speed = null; item.eta = null
                    emit(item)
                }
            }
            line.startsWith("FINAL|") -> st.final = line.substring(6).trim()
        }
    }

    private fun finish(item: Item, st: DlState, dir: File) {
        var file = if (st.final.isNotEmpty()) File(st.final) else null
        if (file == null || !file.exists()) {
            file = dir.listFiles()?.filter { it.isFile && !Regex("\\.(part|ytdl|temp|json|jpg|webp)$").containsMatchIn(it.name) }
                ?.maxByOrNull { it.length() }
        }
        if (file == null || !file.exists()) { fail(item, "No se encontró el archivo descargado", ""); return }
        try {
            item.status = "processing"; item.speed = null; item.eta = null; emit(item)
            val pub = Storage.publish(app, file, if (item.playlist.isNotEmpty()) sanitizeDirName(item.playlist) else "")
            item.filepath = pub.uri; item.size = pub.size
            item.status = "done"; item.progress = 100.0; item.error = ""
            dir.deleteRecursively()
            emit(item)
            app.notifyDone(item.title)
        } catch (e: Throwable) {
            fail(item, "No pude guardar el archivo: ${e.message}", e.toString())
        }
    }

    private fun fail(item: Item, message: String, detail: String) {
        item.status = "error"; item.error = message; item.errorDetail = detail
        item.speed = null; item.eta = null
        emit(item)
        pump()
    }

    private fun handleStop(item: Item, dir: File) {
        val reason = item.stop
        item.stop = null
        synchronized(lock) {
            if (reason == "pause") item.status = "paused"
            else if (reason == "cancel") item.status = "canceled"
        }
        if (reason == "remove") dir.deleteRecursively()
        else { item.speed = null; item.eta = null; emit(item) }
        pump()
    }

    // ---------- acciones del usuario ----------
    private fun kill(item: Item, reason: String) {
        item.stop = reason
        YoutubeDL.getInstance().destroyProcessById(item.id)
    }

    fun pause(id: String) {
        val item = synchronized(lock) { items[id] } ?: return
        if (item.status in active) kill(item, "pause")
        else if (item.status == "queued") { item.status = "paused"; emit(item); statsChanged() }
    }

    /** Reanuda una descarga en pausa (o fallida/cancelada) continuando el archivo parcial. */
    fun resume(id: String) {
        val item = synchronized(lock) { items[id] } ?: return
        if (item.status !in setOf("paused", "error", "canceled")) return
        item.status = "queued"; item.error = ""; item.errorDetail = ""
        emit(item)
        pump()
    }

    /** Reintenta desde cero el progreso mostrado (yt-dlp igualmente reutiliza lo ya bajado). */
    fun retry(id: String) {
        val item = synchronized(lock) { items[id] } ?: return
        if (item.status !in setOf("paused", "error", "canceled", "done")) return
        if (item.status != "paused") item.progress = 0.0
        item.status = "queued"; item.error = ""; item.errorDetail = ""
        emit(item)
        pump()
    }

    fun remove(id: String) {
        val item: Item?
        synchronized(lock) { choices.remove(id); item = items.remove(id) }
        if (item == null) return
        if (item.status in active) kill(item, "remove") else File(app.stagingRoot(), id).deleteRecursively()
        sink?.removed(id)
        scheduleSave()
        pump()
    }

    fun pauseAll() { synchronized(lock) { items.keys.toList() }.forEach { pause(it) } }

    fun resumeAll() {
        synchronized(lock) { items.values.filter { it.status == "paused" }.forEach { it.status = "queued"; emit(it) } }
        pump()
    }

    fun clearCompleted() {
        synchronized(lock) { items.values.filter { it.status == "done" || it.status == "canceled" }.map { it.id } }.forEach { remove(it) }
    }

    fun shutdown() {
        synchronized(lock) { items.values.filter { it.status in active } }.forEach { kill(it, "pause") }
    }

    /** Se llama al guardar preferencias: puede haber cambiado el máximo de descargas simultáneas. */
    fun settingsChanged() = pump()
}
