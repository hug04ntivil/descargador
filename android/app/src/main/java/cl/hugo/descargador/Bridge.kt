package cl.hugo.descargador

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Puente entre la interfaz web (platform.js) y la cola de descargas.
 * JS -> Kotlin: Android.call(id, método, argsJson) / Android.send(método, argsJson).
 * Kotlin -> JS: window.__native.emit(canal, json) y window.__native.resolve(id, json).
 */
class Bridge(private val activity: MainActivity, private val web: WebView) : DownloadManager.Sink {
    private val app = App.instance
    private val mgr get() = app.manager
    private val main = Handler(Looper.getMainLooper())
    private val pending = LinkedHashMap<String, JSONObject>()
    private var flushQueued = false

    // ---------- Kotlin -> JS ----------
    override fun items(list: List<JSONObject>) {
        synchronized(pending) {
            list.forEach { pending[it.getString("id")] = it }
            if (!flushQueued) { flushQueued = true; main.postDelayed({ flush() }, 120) }
        }
    }

    private fun flush() {
        val arr: JSONArray
        synchronized(pending) {
            arr = JSONArray(pending.values.toList())
            pending.clear()
            flushQueued = false
        }
        if (arr.length() > 0) emit("items", arr)
        emit("stats", mgr.stats())
    }

    override fun removed(id: String) {
        synchronized(pending) { pending.remove(id) }
        emit("remove", id)
        emit("stats", mgr.stats())
    }

    override fun notice(type: String, text: String) { emit("notice", JSONObject().put("type", type).put("text", text)) }
    override fun choose(choice: JSONObject) { emit("choose", choice) }

    private fun emit(channel: String, payload: Any?) {
        val json = JSONObject().put("v", payload ?: JSONObject.NULL).toString()
        val js = "window.__native&&window.__native.emit(${JSONObject.quote(channel)},${JSONObject.quote(json)})"
        main.post { web.evaluateJavascript(js, null) }
    }

    // ---------- JS -> Kotlin ----------
    @JavascriptInterface
    fun call(id: Int, method: String, argsJson: String) {
        App.io.execute {
            val result: Any? = try { dispatch(method, JSONArray(argsJson)) } catch (e: Throwable) {
                Log.e("Bridge", "falló $method", e); null
            }
            val json = JSONObject().put("v", result ?: JSONObject.NULL).toString()
            main.post { web.evaluateJavascript("window.__native.resolve($id,${JSONObject.quote(json)})", null) }
        }
    }

    @JavascriptInterface
    fun send(method: String, argsJson: String) {
        App.io.execute {
            try { dispatch(method, JSONArray(argsJson)) } catch (e: Throwable) { Log.e("Bridge", "falló $method", e) }
        }
    }

    private fun JSONArray.s(i: Int): String = if (isNull(i)) "" else optString(i, "")

    private fun dispatch(method: String, a: JSONArray): Any? = when (method) {
        "init" -> JSONObject()
            .put("items", mgr.list())
            .put("settings", app.settings.json())
            .put("formats", Formats.labelsJson())
            .put("stats", mgr.stats())
            .put("ytdlpVersion", app.engineVersion())
        "add" -> {
            val urls = Urls.extract(a.s(0))
            urls.forEach { mgr.add(it, a.s(1).ifEmpty { null }) }
            urls.size
        }
        "pasteClipboard" -> activity.pasteFromClipboard()
        "choiceConfirm" -> {
            val idx = a.getJSONArray(1)
            mgr.resolveChoice(a.s(0), (0 until idx.length()).map { idx.getInt(it) })
            null
        }
        "choiceSingle" -> { mgr.chooseSingle(a.s(0)); null }
        "choiceCancel", "remove" -> { mgr.remove(a.s(0)); null }
        "pause" -> { mgr.pause(a.s(0)); null }
        "resume" -> { mgr.resume(a.s(0)); null }
        "retry" -> { mgr.retry(a.s(0)); null }
        "pauseAll" -> { mgr.pauseAll(); null }
        "resumeAll" -> { mgr.resumeAll(); null }
        "clearCompleted" -> { mgr.clearCompleted(); null }
        "showFile", "openOutput" -> { activity.showFolder(); null }
        "openFile" -> { activity.openMedia(a.s(0)); null }
        "openExternal" -> { activity.openUrl(a.s(0)); null }
        "chooseCookiesFile" -> activity.pickCookiesFile()
        "saveSettings" -> {
            app.settings.patch(a.getJSONObject(0))
            mgr.settingsChanged()
            app.settings.json()
        }
        "updateYtdlp" -> app.updateEngine()
        "version" -> { App.awaitReady(); app.engineVersion() }
        else -> null
    }
}
