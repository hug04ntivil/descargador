package cl.hugo.descargador

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager as SystemDownloads
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    private val app get() = App.instance

    @Volatile private var cookiesFuture: CompletableFuture<String?>? = null
    private val pickCookies = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        cookiesFuture?.complete(uri?.let { copyCookies(it) })
    }
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply { setBackgroundColor(0xFF14161C.toInt()) }
        web = WebView(this).apply {
            setBackgroundColor(0xFF14161C.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            overScrollMode = android.view.View.OVER_SCROLL_NEVER
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Edge-to-edge (obligatorio con targetSdk 35): se deja espacio para barras del sistema y teclado.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                openUrl(request.url.toString())
                return true
            }
        }
        bridge = Bridge(this, web)
        web.addJavascriptInterface(bridge, "Android")
        app.manager.sink = bridge
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__back&&window.__back()") { r -> if (r != "true") moveTaskToBack(true) }
            }
        })

        requestPermissions()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Desde Android 10 solo la app en primer plano puede leer el portapapeles.
        if (hasFocus && app.settings.bool("clipboardWatch")) checkClipboard()
    }

    override fun onDestroy() {
        if (app.manager.sink === bridge) app.manager.sink = null
        web.destroy()
        super.onDestroy()
    }

    // ---------- permisos ----------
    private fun requestPermissions() {
        val need = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) need += Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT < 29 && !granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) need += Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (need.isNotEmpty()) askPermissions.launch(need.toTypedArray())
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    // ---------- entrada de enlaces ----------
    /** "Compartir" desde otra app hacia Descargador. */
    private fun handleIntent(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND || i.type?.startsWith("text/") != true) return
        val urls = Urls.extract(i.getStringExtra(Intent.EXTRA_TEXT))
        if (urls.isEmpty()) {
            toast("No encontré ningún enlace en lo compartido")
        } else {
            urls.forEach { app.manager.add(it, null) }
            toast(if (urls.size == 1) "Añadido a Descargador" else "${urls.size} enlaces añadidos")
        }
        i.action = null
    }

    private fun readClip(): Pair<String, Long>? {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val text = clip.getItemAt(0).coerceToText(this)?.toString() ?: return null
        val stamp = if (Build.VERSION.SDK_INT >= 26) cm.primaryClipDescription?.timestamp ?: 0L else 0L
        return text to stamp
    }

    /** Añade solos los enlaces de sitios conocidos que se copiaron desde la última vez. */
    private fun checkClipboard() {
        val prefs = getSharedPreferences("clip", Context.MODE_PRIVATE)
        val (text, stamp) = try { readClip() } catch (_: Exception) { null } ?: return
        val same = if (stamp != 0L) stamp == prefs.getLong("stamp", -1L) else text == prefs.getString("text", null)
        if (same) return
        prefs.edit().putLong("stamp", stamp).putString("text", text).apply()
        Urls.extract(text).filter { Urls.isWatched(it) }.forEach { app.manager.add(it, null, "auto", silentFail = true) }
    }

    /** Botón "Pegar": añade todos los enlaces del portapapeles (cualquier sitio). */
    fun pasteFromClipboard(): Int {
        val urls = Urls.extract(try { readClip()?.first } catch (_: Exception) { null })
        urls.forEach { app.manager.add(it, null) }
        return urls.size
    }

    // ---------- archivos ----------
    private fun copyCookies(uri: Uri): String? = try {
        val dest = File(filesDir, "cookies.txt")
        contentResolver.openInputStream(uri)!!.use { input -> dest.outputStream().use { input.copyTo(it) } }
        dest.absolutePath
    } catch (_: Exception) { null }

    /** Abre el selector de documentos y devuelve la ruta del cookies.txt copiado (o null). */
    fun pickCookiesFile(): String? {
        val f = CompletableFuture<String?>()
        cookiesFuture = f
        runOnUiThread { pickCookies.launch(arrayOf("text/plain", "text/*", "application/octet-stream", "*/*")) }
        return try { f.get(5, TimeUnit.MINUTES) } catch (_: Exception) { null }
    }

    fun showFolder() = runOnUiThread {
        val movies = Uri.parse("content://com.android.externalstorage.documents/document/primary%3AMovies%2FDescargador")
        val tries = listOf(
            Intent(Intent.ACTION_VIEW).setDataAndType(movies, "vnd.android.document/directory"),
            Intent(SystemDownloads.ACTION_VIEW_DOWNLOADS),
        )
        for (t in tries) {
            try { startActivity(t); return@runOnUiThread } catch (_: Exception) { /* siguiente opción */ }
        }
        toast("Guardado en Películas/Descargador (y Música/Descargador para audio)")
    }

    fun openMedia(uriString: String) = runOnUiThread {
        try {
            val uri = Uri.parse(uriString)
            val mime = contentResolver.getType(uri) ?: "video/*"
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (_: Exception) {
            toast("No encontré una app para abrir este archivo")
        }
    }

    fun openUrl(url: String) = runOnUiThread {
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return@runOnUiThread
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { /* sin navegador */ }
    }

    private fun toast(text: String) = runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }
}
