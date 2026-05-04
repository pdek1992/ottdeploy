window.OTT_CONFIG = {
  appName: "VigilSiddhi OTT",
  
  // API Endpoints (Same-origin on Vercel)
  api: {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    session: "/api/auth/session",
    catalog: "/api/catalog",
    rails: "/api/catalog/rails",
    video: "/api/videos", // append /:slug
    license: "/api/license", // append /:slug
    metrics: "/api/metrics/ingest",
    dashboardSummary: "/api/dashboard/summary"
  },

  // Public playback origins
  cdnBaseUrl: "https://ott.prashantkadam.in",
  
  logoUrl: "./assets/logo.png",
  thumbnailFileNames: ["thumbnail.webp", "thumbnail.jpg", "thumbnail.jpeg", "thumbnail.png"],
  
  // These are now handled server-side but kept here for UI default state if needed
  featuredVideoId: "sunflower_field",
  adCuePoints: [30, 90]
};
