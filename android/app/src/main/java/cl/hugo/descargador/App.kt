package cl.hugo.descargador

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.atomic.AtomicInteger

class App : Application() {
    companion object {
        lateinit var instance: App
            private set
        val io: ExecutorService = Executors.newCachedThreadPool()
        val sched: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
        private val ready = CountDownLatch(1)
        @Volatile var engineError: String? = null

        const val CH_PROGRESS = "progress"
        const val CH_DONE = "done"
        const val NOTIF_PROGRESS = 1
        private const val UPDATE_EVERY_MS = 12L * 60 * 60 * 1000

        /** Bloquea hasta que Python/yt-dlp/ffmpeg estén extraídos (y yt-dlp actualizado). */
        fun awaitReady() {
            ready.await()
            engineError?.let { throw IllegalStateException("No se pudo iniciar el motor de descarga: $it") }
        }
    }

    lateinit var settings: Settings
    lateinit var manager: DownloadManager
    private var serviceOn = false
    private var lastNotify = 0L
    private val doneId = AtomicInteger(1000)

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannels()
        settings = Settings(File(filesDir, "settings.json"))
        manager = DownloadManager(this)
        io.execute { initEngine() }
    }

    fun stagingRoot(): File = (getExternalFilesDir("staging") ?: File(filesDir, "staging")).also { it.mkdirs() }

    // ---------- motor (yt-dlp + Python + ffmpeg) ----------
    private fun initEngine() {
        try {
            YoutubeDL.getInstance().init(this)
            FFmpeg.getInstance().init(this)
        } catch (e: Throwable) {
            engineError = e.message ?: e.toString()
        }
        if (engineError == null) {
            // El yt-dlp incluido en la librería envejece rápido: se actualiza al abrir (máx. cada 12 h).
            val prefs = getSharedPreferences("engine", Context.MODE_PRIVATE)
            val last = prefs.getLong("lastUpdate", 0L)
            if (System.currentTimeMillis() - last > UPDATE_EVERY_MS) {
                try {
                    YoutubeDL.getInstance().updateYoutubeDL(this, YoutubeDL.UpdateChannel.STABLE)
                    prefs.edit().putLong("lastUpdate", System.currentTimeMillis()).apply()
                } catch (_: Throwable) { /* sin conexión: se usa la versión actual */ }
            }
        }
        ready.countDown()
    }

    fun engineVersion(): String = try {
        YoutubeDL.getInstance().version(this) ?: YoutubeDL.getInstance().versionName(this) ?: ""
    } catch (_: Throwable) { "" }

    fun updateEngine(): JSONObject {
        return try {
            awaitReady()
            val st = YoutubeDL.getInstance().updateYoutubeDL(this, YoutubeDL.UpdateChannel.STABLE)
            getSharedPreferences("engine", Context.MODE_PRIVATE).edit().putLong("lastUpdate", System.currentTimeMillis()).apply()
            val msg = if (st == YoutubeDL.UpdateStatus.DONE) "Motor actualizado." else "Ya tienes la última versión."
            JSONObject().put("ok", true).put("output", msg).put("version", engineVersion())
        } catch (e: Throwable) {
            JSONObject().put("ok", false).put("output", e.message ?: "No se pudo actualizar").put("version", engineVersion())
        }
    }

    // ---------- notificaciones / servicio en primer plano ----------
    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_PROGRESS, "Descargas en curso", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_DONE, "Descargas completadas", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun buildProgress(text: String) = NotificationCompat.Builder(this, CH_PROGRESS)
        .setSmallIcon(R.drawable.ic_stat_download)
        .setContentTitle("Descargador")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openAppIntent())
        .build()

    private fun canNotify() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notifyDone(title: String) {
        if (!canNotify()) return
        val n = NotificationCompat.Builder(this, CH_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle("Descarga completada")
            .setContentText(title)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        getSystemService(NotificationManager::class.java).notify(doneId.incrementAndGet(), n)
    }

    /** Lo llama la cola cada vez que cambian los contadores: mantiene vivo el proceso mientras hay descargas. */
    @Synchronized
    fun onStats(s: JSONObject) {
        val active = s.optInt("active")
        val queued = s.optInt("queued")
        if (active + queued > 0) {
            if (!serviceOn) {
                try {
                    ContextCompat.startForegroundService(this, Intent(this, DownloadService::class.java))
                    serviceOn = true
                } catch (_: Throwable) { /* Android puede impedir arrancarlo en segundo plano */ }
            }
            val now = SystemClock.elapsedRealtime()
            if (serviceOn && now - lastNotify > 1000) {
                lastNotify = now
                val speed = s.optDouble("speed", 0.0)
                val parts = ArrayList<String>()
                if (active > 0) parts += "$active descargando"
                if (queued > 0) parts += "$queued en cola"
                var text = parts.joinToString(" · ")
                if (speed > 0) text += " · %.1f MB/s".format(speed / 1048576.0)
                if (canNotify()) getSystemService(NotificationManager::class.java).notify(NOTIF_PROGRESS, buildProgress(text))
            }
        } else if (serviceOn) {
            stopService(Intent(this, DownloadService::class.java))
            serviceOn = false
        }
    }
}
