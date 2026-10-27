package cl.hugo.descargador

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat

/**
 * Servicio en primer plano: sin él Android mata la app (y los procesos yt-dlp) al salir a segundo plano.
 * Lo arranca y detiene App.onStats según haya descargas activas o en cola.
 */
class DownloadService : Service() {
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, App.NOTIF_PROGRESS, App.instance.buildProgress("Preparando descargas…"), type)
        wake = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "descargador:downloads")
            .apply { setReferenceCounted(false); acquire(6L * 60 * 60 * 1000) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY

    override fun onDestroy() {
        wake?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }
}
