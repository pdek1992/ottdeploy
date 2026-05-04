window.OTT_CONFIG = {
  appName: "VigilSiddhi OTT",

  // Public GitHub Raw files act as the demo auth/key/license source.
  githubBaseUrl: "https://raw.githubusercontent.com/pdek1992/ott/main",
  allowedEmailsUrl: "https://raw.githubusercontent.com/pdek1992/ott/main/keys/allowed_emails.json",
  allowedUserIdsUrl: "https://raw.githubusercontent.com/pdek1992/ott/main/keys/allowed_userids.json",
  descriptionsUrl: "https://raw.githubusercontent.com/pdek1992/ott/main/keys/description.json",
  mpdMappingUrl: "https://raw.githubusercontent.com/pdek1992/ott/main/keys/mpd_mapping.json",

  keysUrl: "https://raw.githubusercontent.com/pdek1992/ott/main/keys/keys.json",

  // Local copies are used as fallbacks when this folder is hosted by itself.
  localAllowedEmailsUrl: "./keys/allowed_emails.json",
  localAllowedUserIdsUrl: "./keys/allowed_userids.json",
  localDescriptionsUrl: "./keys/description.json",
  localMpdMappingUrl: "./keys/mpd_mapping.json",

  localKeysUrl: "./keys/keys.json",

  // Public playback origins. Do not put R2 secret keys in a browser app.
  cdnBaseUrl: "https://ott.prashantkadam.in",
  r2BaseUrl: "https://e63579be88693f2808e148ec66d99bb4.r2.cloudflarestorage.com/ott",
  localOutputBaseUrl: "./output",

  logoUrl: "./assets/logo.png",
  thumbnailFileNames: ["thumbnail.webp", "thumbnail.jpg", "thumbnail.jpeg", "thumbnail.png"],

  // Master passphrase (loaded from secrets.js)
  fixedKeyPassphrase: "VIGIL_SIDDHI_PROD_2026",

  // Advertising configuration
  googleImaAdTag: "",

  // Cue points for server-side or local ad insertions
  adCuePoints: [30, 90],

  allowedEmails: ["pdek1991@gmail.com", "pdek1992@gmail.com"],
  allowedUserIds: ["pdek1991", "admin", "adminuser"],

  featuredVideoId: "angel_one",

  staticVideos: [
    // ── Featured / Your Content ─────────────────────────────────
    {
      id: "free",
      title: "Free Preview",
      description: "Start watching instantly with a smooth premium playback experience.",
      category: "Featured",
      year: "2026",
      duration: "2m",
      thumbnail: "./assets/thumbnails/free.jpg"
    },
    {
      id: "output_2min",
      title: "Quick Preview",
      description: "A short title for a fast watch.",
      category: "Featured",
      year: "2026",
      duration: "2m",
      thumbnail: "./assets/thumbnails/output_2min.jpg"
    },
    {
      id: "output_02_04",
      title: "Weekend Special",
      description: "A featured pick ready for streaming.",
      category: "Featured",
      year: "2026",
      duration: "Preview",
      thumbnail: "./assets/thumbnails/output_02_04.jpg"
    },
    {
      id: "withlogo",
      title: "Studio Preview",
      description: "A polished sample from the VigilSiddhi OTT collection.",
      category: "Featured",
      year: "2026",
      duration: "Preview",
      thumbnail: "./assets/thumbnails/withlogo.jpg"
    },
    // ── Sci-Fi ──────────────────────────────────────────────────
    {
      id: "angel_one",
      title: "Angel One",
      description: "A celestial sci-fi adventure with stunning ABR-adaptive streaming. Shaka Player official demo asset.",
      category: "Sci-Fi",
      year: "2016",
      duration: "4m",
      maturity: "U",
      thumbnail: "./assets/thumbnails/angel_one.png"
    },
    {
      id: "tears_of_steel",
      title: "Tears of Steel",
      description: "Robots invade Amsterdam in this stunning sci-fi short from the Blender Foundation.",
      category: "Sci-Fi",
      year: "2012",
      duration: "12m",
      maturity: "U/A",
      thumbnail: "./assets/thumbnails/tears_of_steel.jpg"
    },
    // ── Documentary ─────────────────────────────────────────────
    {
      id: "heliocentrism",
      title: "Heliocentrism",
      description: "An immersive space documentary journey through our solar system. Multi-bitrate adaptive streaming.",
      category: "Documentary",
      year: "2017",
      duration: "3m",
      maturity: "U",
      thumbnail: "./assets/thumbnails/heliocentrism.jpg"
    },
    // ── Animation ───────────────────────────────────────────────
    {
      id: "big_buck_bunny",
      title: "Big Buck Bunny",
      description: "A giant rabbit vs. three mischievous rodents. A timeless Blender Foundation classic.",
      category: "Animation",
      year: "2008",
      duration: "9m 56s",
      maturity: "U",
      thumbnail: "./assets/thumbnails/big_buck_bunny.jpg"
    },
    {
      id: "bbb_dark_truths",
      title: "Big Buck Bunny — Dark Truths",
      description: "A darker, cinematic reimagining of the animated classic. Shaka demo with full ABR.",
      category: "Animation",
      year: "2012",
      duration: "10m",
      maturity: "U/A",
      thumbnail: "./assets/thumbnails/bbb_dark_truths.jpg"
    },
    {
      id: "sintel",
      title: "Sintel",
      description: "Fantasy epic — a lone heroine searches for her lost dragon across dangerous lands.",
      category: "Animation",
      year: "2010",
      duration: "14m 48s",
      maturity: "PG",
      thumbnail: "./assets/thumbnails/sintel.png"
    },
    {
      id: "elephant_dream",
      title: "Elephant's Dream",
      description: "The world's first open movie — a surrealist journey through impossible mechanical worlds.",
      category: "Animation",
      year: "2006",
      duration: "10m 54s",
      maturity: "U",
      thumbnail: "./assets/thumbnails/elephant_dream.png"
    },
    {
      id: "cosmos_laundromat",
      title: "Cosmos Laundromat",
      description: "A sheep meets a mysterious stranger who grants infinite lives. Award-winning Blender open short.",
      category: "Animation",
      year: "2015",
      duration: "12m 10s",
      maturity: "U/A",
      thumbnail: "./assets/thumbnails/cosmos_laundromat.jpg"
    },
    // ── Comedy ──────────────────────────────────────────────────
    {
      id: "tmkoc",
      title: "Taarak Mehta Ka Ooltah Chashmah",
      description: "A light-hearted sitcom set in the Gokuldham Society. Humor and wit in every episode.",
      category: "Comedy",
      year: "2008",
      duration: "22m",
      thumbnail: "./assets/thumbnails/tmkoc.jpg"
    },
    {
      id: "blackmail",
      title: "Blackmail",
      description: "Starring Irrfan Khan, Kirti Kulhari, Divya Dutta. A dark comedy thriller.",
      category: "Comedy",
      year: "2018",
      duration: "1h 54m",
      thumbnail: "./assets/thumbnails/blackmail.jpg"
    },
    // ── Sports ──────────────────────────────────────────────────
    {
      id: "asiacup",
      title: "Asia Cup Finals",
      description: "India vs Pakistan — edge-of-your-seat cricket action from a packed stadium.",
      category: "Sports",
      year: "2026",
      duration: "2h 15m",
      thumbnail: "./assets/thumbnails/asiacup.jpg"
    },
    // ── DASH Demo ────────────────────────────────────────────────
    {
      id: "dash_if_livesim",
      title: "DASH-IF LiveSim",
      description: "Industry-standard reference live stream with high-frequency chunking. Perfect for low-latency player verification.",
      category: "Reference Streams",
      year: "2024",
      duration: "LIVE",
      maturity: "U",
      thumbnail: "./assets/thumbnails/dash_if_livesim.jpg"
    },
    {
      id: "multirate_dash",
      title: "Qualcomm MultiRate",
      description: "Official Qualcomm multi-rate patched reference stream for verifying ABR logic and seamless bitrate transitions.",
      category: "Reference Streams",
      year: "2023",
      duration: "ABR",
      maturity: "U",
      thumbnail: "./assets/thumbnails/multirate_dash.jpg"
    },
    {
      id: "hd_multireso",
      title: "Qualcomm HD Reference",
      description: "High-definition multi-resolution reference content for testing multi-view and high-resolution player stability.",
      category: "Reference Streams",
      year: "2023",
      duration: "HD",
      maturity: "U",
      thumbnail: "./assets/thumbnails/hd_multireso.png"
    },
    {
      id: "bitmovin_demo",
      title: "Bitmovin Gold Standard",
      description: "The global benchmark for premium adaptive video delivery — ensuring high-fidelity playback across all network conditions.",
      category: "Reference Streams",
      year: "2023",
      duration: "Feature",
      maturity: "U",
      thumbnail: "./assets/thumbnails/bitmovin_demo.jpg"
    },
    {
      id: "bbb_itec",
      title: "Big Buck Bunny (ITEC)",
      description: "Academic standard ITEC dataset for advanced adaptive bitrate streaming experiments and data-layer analysis.",
      category: "Animation",
      year: "2014",
      duration: "10m",
      maturity: "U",
      thumbnail: "./assets/thumbnails/bbb_itec.jpg"
    }
  ],

  // ── Netflix-like genre rails ─────────────────────────────────
  rails: [
    {
      title: "🔥 Trending Now",
      items: ["angel_one", "tears_of_steel", "sintel", "big_buck_bunny", "heliocentrism", "bbb_dark_truths"]
    },
    {
      title: "🎬 Animation",
      items: ["big_buck_bunny", "bbb_dark_truths", "sintel", "elephant_dream", "cosmos_laundromat"]
    },
    {
      title: "🚀 Sci-Fi",
      items: ["angel_one", "tears_of_steel"]
    },
    {
      title: "🌌 Documentary",
      items: ["heliocentrism"]
    },
    {
      title: "😂 Comedy",
      items: ["tmkoc", "blackmail"]
    },
    {
      title: "🏏 Sports",
      items: ["asiacup"]
    },
    {
      title: "📡 Reference Streams",
      items: ["dash_if_livesim", "multirate_dash", "hd_multireso", "bitmovin_demo", "bbb_itec"]
    },
    {
      title: "▶️ Your Content",
      items: ["free", "output_2min", "output_02_04", "withlogo"]
    },
    {
      title: "⬇️ Continue Watching",
      items: ["angel_one", "sintel", "big_buck_bunny", "tears_of_steel", "heliocentrism"]
    }
  ]
};
