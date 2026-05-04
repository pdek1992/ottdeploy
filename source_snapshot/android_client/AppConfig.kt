package com.ott.app

// ─── Data Models ─────────────────────────────────────────────────────────────

data class VideoItem(
    val id: String,
    val title: String,
    val description: String,
    val category: String,
    val year: String = "",
    val duration: String = "",
    val maturity: String = "U/A",
    val mpdUrl: String = "",
    val thumbnail: String = "",
    val adCuePoints: List<Int> = listOf(30, 90),
    val playable: Boolean = true
)

data class UserSession(
    val email: String = "",
    val userId: String = "",
    val displayName: String = "",
    val authorizedBy: String = "",
    val signedInAt: String = ""
)

data class CatalogState(
    val videos: List<VideoItem> = emptyList(),
    val featured: VideoItem? = null,
    val rails: Map<String, List<VideoItem>> = emptyMap()
)

// ─── App Constants ────────────────────────────────────────────────────────────

object AppConfig {
    const val GITHUB_BASE = "https://raw.githubusercontent.com/pdek1992/ott/main"
    const val ALLOWED_EMAILS_URL = "$GITHUB_BASE/keys/allowed_emails.json"
    const val ALLOWED_USER_IDS_URL = "$GITHUB_BASE/keys/allowed_userids.json"
    const val DESCRIPTIONS_URL = "$GITHUB_BASE/keys/description.json"
    const val MPD_MAPPING_URL = "$GITHUB_BASE/keys/mpd_mapping.json"
    const val KEYS_URL = "$GITHUB_BASE/keys/keys.json"
    const val CDN_BASE = "https://ott.prashantkadam.in/"
    const val FEATURED_VIDEO_ID = "angel_one"

    // Prometheus / Grafana Cloud (Influx Line Protocol endpoint)
    const val PROMETHEUS_URL =
        "https://prometheus-prod-43-prod-ap-south-1.grafana.net/api/prom/push"
    const val PROMETHEUS_INFLUX_URL =
        "https://prometheus-prod-43-prod-ap-south-1.grafana.net/influx/api/v1/push/influx/write"
    const val PROMETHEUS_USER = "2490227"
    const val PROMETHEUS_API_KEY = "YOUR_GRAFANA_API_KEY_HERE"
    const val APP_NAME = "VigilSiddhi_OTT_Android"
    const val REGION = "IN"
    const val PUSH_INTERVAL_MS = 60_000L

    // Hard-coded allow list supplements (same as webapp config.js)
    val ALLOWED_EMAILS = listOf("pdek1991@gmail.com", "pdek1992@gmail.com", "admin@prashantkadam.in")
    val ALLOWED_USER_IDS = listOf("pdek1991", "admin")

    val STATIC_RAILS = listOf(
        "🔥 Trending Now" to listOf("angel_one", "tears_of_steel", "sintel", "big_buck_bunny", "heliocentrism"),
        "🎬 Animation" to listOf("big_buck_bunny", "sintel", "elephant_dream", "cosmos_laundromat"),
        "🚀 Sci-Fi" to listOf("angel_one", "tears_of_steel"),
        "🌌 Documentary" to listOf("heliocentrism"),
        "😂 Comedy" to listOf("tmkoc", "blackmail"),
        "🏏 Sports" to listOf("asiacup"),
        "📡 Reference Streams" to listOf("dash_if_livesim", "multirate_dash", "bitmovin_demo"),
        "▶️ Your Content" to listOf("free", "output_2min")
    )

    // Default videos matching webapp config.js staticVideos
    val DEFAULT_VIDEOS = listOf(
        VideoItem("angel_one",         "Angel One",                      "A celestial sci-fi adventure with ABR-adaptive streaming.", "Sci-Fi",              "2016", "4m",       "U",   thumbnail = "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=640&q=80"),
        VideoItem("tears_of_steel",    "Tears of Steel",                 "Robots invade Amsterdam in this stunning sci-fi short.",     "Sci-Fi",              "2012", "12m",      "U/A", thumbnail = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=640&q=80"),
        VideoItem("heliocentrism",     "Heliocentrism",                  "An immersive space documentary journey.",                    "Documentary",         "2017", "3m",       "U",   thumbnail = "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=640&q=80"),
        VideoItem("big_buck_bunny",    "Big Buck Bunny",                 "A giant rabbit vs three mischievous rodents.",               "Animation",           "2008", "9m 56s",   "U",   thumbnail = "https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=640&q=80"),
        VideoItem("sintel",            "Sintel",                         "Fantasy epic — a lone heroine searches for her dragon.",     "Animation",           "2010", "14m 48s",  "PG",  thumbnail = "https://images.unsplash.com/photo-1628155930542-3c7a64e2aed1?w=640&q=80"),
        VideoItem("elephant_dream",    "Elephant's Dream",               "The world's first open movie.",                              "Animation",           "2006", "10m 54s",  "U",   thumbnail = "https://images.unsplash.com/photo-1557990010-6e3c65a7d8c7?w=640&q=80"),
        VideoItem("cosmos_laundromat", "Cosmos Laundromat",              "A sheep meets a stranger who grants infinite lives.",         "Animation",           "2015", "12m 10s",  "U/A", thumbnail = "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=640&q=80"),
        VideoItem("tmkoc",             "Taarak Mehta Ka Ooltah Chashmah","A light-hearted sitcom set in the Gokuldham Society.",       "Comedy",              "2008", "22m",      "U",   thumbnail = "https://upload.wikimedia.org/wikipedia/commons/2/2f/Cast-of-Taarak-Mehta-Ka-Ooltah-Chashmah-celebrate-the-12-year-anniversary-of-the-show.jpg"),
        VideoItem("blackmail",         "Blackmail",                      "Starring Irrfan Khan. A dark comedy thriller.",              "Comedy",              "2018", "1h 54m",   "A",   thumbnail = "https://images.unsplash.com/photo-1572177812156-58036aae439c?w=640&q=80"),
        VideoItem("asiacup",           "Asia Cup Finals",                "India vs Pakistan — edge-of-your-seat cricket action.",      "Sports",              "2026", "2h 15m",   "U",   thumbnail = "https://upload.wikimedia.org/wikipedia/commons/8/89/Test_Match_Cricket_India_Vs._Pakistan.jpg"),
        VideoItem("dash_if_livesim",   "DASH-IF LiveSim",                "Industry-standard reference live stream.",                   "Reference Streams",   "2024", "LIVE",     "U",   thumbnail = "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=640&q=80"),
        VideoItem("multirate_dash",    "Qualcomm MultiRate",             "Official Qualcomm multi-rate ABR reference.",                "Reference Streams",   "2023", "ABR",      "U",   thumbnail = "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=640&q=80"),
        VideoItem("bitmovin_demo",     "Bitmovin Gold Standard",         "Global benchmark for premium adaptive video delivery.",      "Reference Streams",   "2023", "Feature",  "U",   thumbnail = "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=640&q=80"),
        VideoItem("free",              "Free Preview",                   "Start watching instantly with a premium experience.",        "Featured",            "2026", "2m",       "U",   thumbnail = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=640&q=80"),
        VideoItem("output_2min",       "Quick Preview",                  "A short title for a fast watch.",                            "Featured",            "2026", "2m",       "U",   thumbnail = "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=640&q=80")
    )
}
