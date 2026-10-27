package cl.hugo.descargador

import org.json.JSONObject

/** Una descarga de la cola. Los nombres de los campos coinciden con los de la interfaz web. */
class Item(val id: String) {
    var url = ""
    var sourceUrl = ""
    var title = ""
    var uploader = ""
    var duration: Double? = null
    var thumbnail = ""
    var playlist = ""
    var playlistIndex = 0
    var format = "best"
    var status = "queued"
    var progress = 0.0
    var speed: Double? = null
    var eta: Double? = null
    var filepath = ""
    var size: Long? = null
    var error = ""
    var errorDetail = ""
    var addedAt = System.currentTimeMillis()

    /** Motivo por el que se está deteniendo el proceso: pause, cancel o remove. */
    @Volatile var stop: String? = null
    @Volatile var lastEmit = 0L

    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("url", url).put("sourceUrl", sourceUrl).put("title", title)
        .put("uploader", uploader).put("duration", duration ?: JSONObject.NULL).put("thumbnail", thumbnail)
        .put("playlist", playlist).put("playlistIndex", playlistIndex).put("format", format)
        .put("status", status).put("progress", progress).put("speed", speed ?: JSONObject.NULL)
        .put("eta", eta ?: JSONObject.NULL).put("filepath", filepath).put("size", size ?: JSONObject.NULL)
        .put("error", error).put("errorDetail", errorDetail).put("addedAt", addedAt)

    companion object {
        fun fromJson(o: JSONObject): Item = Item(o.getString("id")).apply {
            url = o.str("url"); sourceUrl = o.str("sourceUrl"); title = o.str("title")
            uploader = o.str("uploader"); duration = o.dbl("duration"); thumbnail = o.str("thumbnail")
            playlist = o.str("playlist"); playlistIndex = o.optInt("playlistIndex", 0)
            format = o.str("format").ifEmpty { "best" }; status = o.str("status").ifEmpty { "paused" }
            progress = o.optDouble("progress", 0.0); filepath = o.str("filepath")
            size = if (o.isNull("size")) null else o.optLong("size")
            error = o.str("error"); errorDetail = o.str("errorDetail"); addedAt = o.optLong("addedAt", addedAt)
        }
    }
}
