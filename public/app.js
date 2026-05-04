(() => {
  "use strict";

  const config = window.OTT_CONFIG || {};
  const SESSION_KEY = "ott-glass-session-v1";
  const MY_LIST_KEY = "ott-glass-my-list-v1";
  const DEVICE_KEY = "ott-glass-device-credential-v1";
  const WATCH_PROGRESS_KEY = "ott-glass-progress-v1";

  const state = {
    currentUser: null,
    catalog: [],
    catalogById: new Map(),
    featuredVideo: null,
    searchQuery: "",
    keyStore: null,
    player: null,
    ui: null,
    shakaReady: false,
    currentVideo: null,
    currentManifestUrl: "",
    manifestBlobUrl: "",
    firedAds: new Set(),
    adCuePoints: [],
    adTimer: null,
    adPlaying: false,
    imaReady: false,
    adsLoader: null,
    adsManager: null,
    installPrompt: null,
    assistantVisible: false,
    lastProgressSavedAt: 0,
    useDetachedMode: false
  };

  const els = {};

  window.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    bindElements();
    bindEvents();
    drawIcons();
    updateShellChrome();
    registerServiceWorker();
    await detectPlaybackDevice();

    const session = readJson(SESSION_KEY);
    if (session && (session.email || session.userId)) {
      state.currentUser = session;
      await enterApp();
    } else {
      setAuthMessage("Sign in to continue.");
    }

    // Auto-refresh library every 60 seconds to scan for new mpd_mapping additions
    setInterval(async () => {
      if (state.currentUser && !state.playerOverlay.hidden === false) {
         console.log("[AUTO-REFRESH] Scanning for new videos...");
         await loadCatalog();
         state.keyStore = null; // Clear key cache to pick up new DRM keys for new videos
         renderApp();
      }
    }, 60000);
  }

  function bindElements() {
    const ids = [
      "authScreen",
      "appShell",
      "topbar",
      "loginForm",
      "loginButton",
      "identifierInput",
      "passwordInput",
      "deviceUnlockButton",
      "installButton",
      "authMessage",
      "profileName",
      "logoutButton",
      "searchInput",
      "voiceSearchButton",
      "searchSuggestionPanel",
      "heroImage",
      "heroCategory",
      "heroTitle",
      "heroDescription",
      "heroMeta",
      "heroStatusPill",
      "heroSupportText",
      "heroPlayButton",
      "heroListButton",
      "heroResumeButton",
      "heroMoodChips",
      "heroFeatureCards",
      "notificationButton",
      "registerDeviceButton",
      "refreshDataButton",
      "deviceStatus",
      "curatedStrip",
      "rails",
      "my-list",
      "assistantButton",
      "assistantBackdrop",
      "assistantPanel",
      "assistantCloseButton",
      "assistantSuggestionList",
      "assistantPrimaryAction",
      "playerOverlay",
      "closePlayerButton",
      "pipButton",
      "fullscreenButton",
      "videoContainer",
      "videoElement",
      "adContainer",
      "adOverlay",
      "adCountdown",
      "playerError",
      "playerTitle",
      "playerMeta",
      "watchTitle",
      "watchDescription",
      "watchStats",
      "sceneMarkers",
      "upNextTitle",
      "upNextMeta",
      "upNextButton",
      "playbackState",
      "protectionState",
      "adStatus",
      "toastStack"
    ];

    for (const id of ids) {
      els[id] = document.getElementById(id);
    }
  }

  function bindEvents() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.logoutButton.addEventListener("click", logout);
    els.searchInput.addEventListener("input", () => {
      state.searchQuery = els.searchInput.value.trim().toLowerCase();
      renderSearchSuggestions();
      renderRails();
    });
    els.searchInput.addEventListener("focus", renderSearchSuggestions);
    els.voiceSearchButton?.addEventListener("click", () => {
      setToast("Voice search UI is ready. Hook a speech service to enable it.");
    });

    els.heroPlayButton.addEventListener("click", () => {
      if (state.featuredVideo) {
        playVideo(state.featuredVideo);
      }
    });

    els.heroListButton.addEventListener("click", () => {
      if (state.featuredVideo) {
        toggleMyList(state.featuredVideo.id);
      }
    });
    els.heroResumeButton?.addEventListener("click", () => {
      if (state.featuredVideo) {
        playVideo(state.featuredVideo, { resume: true });
      }
    });

    els.closePlayerButton.addEventListener("click", closePlayer);
    els.notificationButton.addEventListener("click", requestNotifications);
    els.registerDeviceButton.addEventListener("click", registerDeviceUnlock);
    els.deviceUnlockButton.addEventListener("click", unlockWithDevice);
    els.refreshDataButton.addEventListener("click", refreshData);
    els.pipButton.addEventListener("click", togglePictureInPicture);
    els.fullscreenButton.addEventListener("click", toggleFullscreen);
    els.installButton.addEventListener("click", installPwa);
    els.assistantButton?.addEventListener("click", () => setAssistantOpen(true));
    els.assistantBackdrop?.addEventListener("click", () => setAssistantOpen(false));
    els.assistantCloseButton?.addEventListener("click", () => setAssistantOpen(false));
    els.assistantPrimaryAction?.addEventListener("click", handleAssistantPrimaryAction);
    els.upNextButton?.addEventListener("click", () => {
      const nextId = els.upNextButton.dataset.videoId;
      const nextVideo = nextId ? state.catalogById.get(nextId) : getSuggestedNextVideo(state.currentVideo);
      if (nextVideo) {
        playVideo(nextVideo);
      }
    });
    document.querySelectorAll("[data-assistant-open='true']").forEach((button) => {
      button.addEventListener("click", () => setAssistantOpen(true));
    });

    document.querySelectorAll(".mobile-dock a").forEach((a) => {
      a.addEventListener("click", () => setAssistantOpen(false));
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      els.installButton.hidden = false;
    });
    window.addEventListener("scroll", updateShellChrome, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.player) {
        setToast("Playback can continue in the background when your browser allows it.");
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search-cluster")) {
        hideSearchSuggestions();
      }
      if (event.target.closest("[data-scroll-target]")) {
        const selector = event.target.closest("[data-scroll-target]").dataset.scrollTarget;
        const target = selector ? document.querySelector(selector) : null;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideSearchSuggestions();
        setAssistantOpen(false);
      }
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const identifier = els.identifierInput.value.trim();
    const password = els.passwordInput.value.trim();

    if (!identifier || !password) {
      setAuthMessage("Enter your email/user ID and password.", true);
      return;
    }

    setBusy(els.loginButton, true);
    setAuthMessage("Checking credentials...");

    try {
      const response = await fetch(config.api.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password })
      });

      if (!response.ok) {
        const result = await response.json();
        setAuthMessage(result.error || "Unable to sign in.", true);
        return;
      }

      // After successful login, fetch the session to get user details
      const sessionRes = await fetch("/api/auth/session");
      const { user } = await sessionRes.json();
      
      state.currentUser = user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.currentUser));
      await enterApp();
      setToast("Signed in.", "success");
    } catch (error) {
      console.error(error);
      setAuthMessage("Connection error. Try again later.", true);
    } finally {
      setBusy(els.loginButton, false);
    }
  }

  async function enterApp() {
    els.authScreen.hidden = true;
    els.appShell.hidden = false;
    
    // Display name + Tier
    const tier = state.currentUser.subscription_tier || "basic";
    els.profileName.innerHTML = `${state.currentUser.display_name || state.currentUser.email || "Member"} <span class="tier-pill tier-${tier.toLowerCase()}">${tier}</span>`;
    
    await loadCatalog();
    renderApp();
    drawIcons();
  }

  async function refreshData() {
    setToast("Refreshing...");
    state.keyStore = null;
    await loadCatalog();
    renderApp();
    drawIcons();
  }

  function logout() {
    closePlayer();
    setAssistantOpen(false);
    localStorage.removeItem(SESSION_KEY);
    state.currentUser = null;
    els.appShell.hidden = true;
    els.authScreen.hidden = false;
    setAuthMessage("Signed out.");
  }

  async function loadCatalog() {
    try {
      const response = await fetch(config.api.catalog);
      if (!response.ok) throw new Error("Catalog fetch failed");
      
      const videos = await response.json();
      const byId = new Map();
      
      for (const video of videos) {
        byId.set(video.slug, normalizeVideo(video));
      }

      state.catalog = videos;
      state.catalogById = byId;
      state.featuredVideo = byId.get(config.featuredVideoId) || state.catalog[0] || null;
      
      console.log(`[CATALOG] Loaded ${state.catalog.length} titles from Vercel API.`);
    } catch (error) {
      console.error("[CATALOG ERROR]", error);
      setToast("Failed to load catalog.", "error");
    }
  }

  function normalizeVideo(video) {
    return {
      ...video,
      id: video.slug,
      mpdUrl: video.video_streams?.[0]?.manifest_url || "",
      adCuePoints: video.adCuePoints || config.adCuePoints || [],
      playable: true
    };
  }

  function renderApp() {
    safeRender("Hero", renderHero);
    safeRender("Curated Strip", renderCuratedStrip);
    safeRender("Filter Strip", renderFilterStrip);
    safeRender("Assistant Suggestions", renderAssistantSuggestions);
    safeRender("Rails", renderRails);
  }

  function safeRender(name, fn) {
    try {
      fn();
    } catch (err) {
      console.error(`[RENDER ERROR] ${name}:`, err);
    }
  }

  function renderFilterStrip() {
    const filterStrip = document.getElementById("filterStrip");
    if (!filterStrip) return;
    filterStrip.innerHTML = "";
    
    const tags = new Set();
    for (const video of state.catalog) {
      if (video.category && video.category !== "Browse") tags.add(video.category);
      if (video.genre) tags.add(video.genre);
      if (video.language) tags.add(video.language);
    }

    const uniqueTags = Array.from(tags).sort();
    const filters = uniqueTags.map(tag => ({
      label: tag,
      action: () => applySearchQuery(tag)
    }));

    filters.unshift({ label: "All", action: () => applySearchQuery("") });

    for (const filter of filters) {
      const btn = document.createElement("button");
      btn.className = "ghost-btn curation-chip";
      btn.type = "button";
      btn.textContent = filter.label;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".curation-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        filter.action();
      });
      if (state.searchQuery === filter.label.toLowerCase() || (filter.label === "All" && !state.searchQuery)) {
        btn.classList.add("active");
      }
      filterStrip.appendChild(btn);
    }
  }

  function applySearchQuery(query) {
    if (!els.searchInput) return;
    els.searchInput.value = query;
    state.searchQuery = query.toLowerCase();
    renderRails();
    els.rails?.scrollIntoView({ behavior: "smooth" });
  }

  function renderHero() {
    const video = state.featuredVideo;
    if (!video) {
      return;
    }

    els.heroCategory.textContent = video.category || "Featured";
    els.heroTitle.textContent = video.title;
    els.heroDescription.textContent = video.description;
    els.heroStatusPill.textContent = buildHeroStatus(video);
    els.heroSupportText.textContent = buildHeroSupportCopy(video);
    els.heroMeta.innerHTML = "";

    for (const value of [video.year, video.duration, video.maturity]) {
      if (!value) {
        continue;
      }
      const span = document.createElement("span");
      span.textContent = value;
      els.heroMeta.appendChild(span);
    }

    setSmartImage(els.heroImage, thumbnailCandidates(video));
    renderHeroFeatureCards(video);
    renderMoodChips(video);
    updateHeroResumeButton(video);
    updateHeroListButton();
  }

  function renderRails() {
    els.rails.innerHTML = "";
    const rails = buildRails();
    let visibleCount = 0;

    for (const rail of rails) {
      const videos = rail.items
        .map((id) => state.catalogById.get(id) || normalizeVideo({ id, title: titleFromId(id), category: rail.title }))
        .filter(matchesSearch);

      if (videos.length === 0) {
        continue;
      }

      visibleCount += videos.length;
      els.rails.appendChild(createRail(rail.title, videos));
    }

    if (!visibleCount) {
      els.rails.appendChild(createEmptyState("No titles match this search."));
    }

    renderMyList();
    drawIcons();
  }

  function buildRails() {
    const configured = [];
    const seenTitles = new Set();

    try {

    const allIds = Array.from(state.catalogById.keys());
    const staticIds = (config.staticVideos || []).map(v => String(v.id).toLowerCase());
    
    const smartRails = [
      {
        title: "Just Added",
        items: allIds.filter(id => !staticIds.includes(id))
      },
      {
        title: "Continue Watching",
        items: getContinueWatchingVideos().map((video) => video.id)
      },
      {
        title: "Recommended for You",
        items: allIds.filter(id => !staticIds.includes(id)).reverse().slice(0, 10)
      },
      {
        title: `Because You Watched ${getAffinityCategory()}`,
        items: getBecauseYouWatchedVideos().map((video) => video.id)
      },
      {
        title: `Trending in ${getRegionLabel()}`,
        items: getTrendingVideos().map((video) => video.id)
      },
      {
        title: "Quick Watch",
        items: getQuickWatchVideos().map((video) => video.id)
      }
    ];

    console.log("[DEBUG] Smart Rails check:", smartRails.map(r => `${r.title}: ${r.items.length}`));

    for (const rail of smartRails) {
      const title = prettifyRailTitle(rail.title);
      if (!rail.items.length || seenTitles.has(title.toLowerCase())) {
        continue;
      }
      configured.push({ title, items: mergeUnique(rail.items) });
      seenTitles.add(title.toLowerCase());
    }

    for (const rail of config.rails || []) {
      const title = prettifyRailTitle(rail.title);
      if (seenTitles.has(title.toLowerCase())) {
        continue;
      }
      configured.push({
        title,
        items: mergeUnique(rail.items || [])
      });
      seenTitles.add(title.toLowerCase());
    }

    const titles = new Set(configured.map((rail) => rail.title.toLowerCase()));

    // Group by Genre for dynamic rails
    const genres = new Map();
    for (const video of state.catalog) {
      if (video.genre) {
        if (!genres.has(video.genre)) genres.set(video.genre, []);
        genres.get(video.genre).push(video.id);
      }
    }
    for (const [genre, ids] of genres) {
      if (!titles.has(genre.toLowerCase()) && ids.length > 0) {
        configured.push({ title: genre, items: mergeUnique(ids) });
        titles.add(genre.toLowerCase());
      }
    }

    const categories = new Map();
    for (const video of state.catalog) {
      const key = video.category || "Browse";
      if (!categories.has(key)) {
        categories.set(key, []);
      }
      categories.get(key).push(video.id);
    }

    for (const [title, ids] of categories) {
      if (!titles.has(title.toLowerCase())) {
        configured.push({ title, items: mergeUnique(ids) });
      }
    }

    } catch (err) {
      console.error("[BUILD RAILS ERROR]", err);
    }

    return configured;
  }

  function renderMyList() {
    if (!els["my-list"]) {
      return;
    }

    els["my-list"].innerHTML = "";
    const ids = readJson(MY_LIST_KEY) || [];
    const videos = ids
      .map((id) => state.catalogById.get(id))
      .filter(Boolean)
      .filter(matchesSearch);

    if (videos.length) {
      els["my-list"].appendChild(createRail("My List", videos));
    } else {
      const wrapper = document.createElement("section");
      wrapper.className = "rail";
      wrapper.innerHTML =
        '<div class="rail-header"><div class="rail-header-copy"><p class="eyebrow">Saved for later</p><h2>My List</h2></div><span>Saved titles appear here</span></div>';
      wrapper.appendChild(createEmptyState("Add a title from the hero or rail."));
      els["my-list"].appendChild(wrapper);
    }
  }

  function createRail(title, videos) {
    const section = document.createElement("section");
    section.className = "rail";
    const header = document.createElement("div");
    header.className = "rail-header";
    header.innerHTML = `
      <div class="rail-header-copy">
        <p class="eyebrow">${escapeHtml(buildRailEyebrow(title))}</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <span>${videos.length} picks</span>
    `;

    const track = document.createElement("div");
    track.className = "rail-track";
    track.setAttribute("aria-label", title);
    for (const video of videos) {
      track.appendChild(createTile(video));
    }

    section.append(header, track);
    return section;
  }

  function createTile(video) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";
    tile.title = `Play ${video.title}`;
    tile.addEventListener("click", () => playVideo(video));
    tile.setAttribute("aria-label", `Play ${video.title}`);

    const inList = isVideoInMyList(video.id);
    const progress = readProgressMap()[video.id];

    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    setSmartImage(img, thumbnailCandidates(video));

    const body = document.createElement("span");
    body.className = "tile-body";
    body.innerHTML = `
      <span class="tile-badge-row">
        <span class="tile-badges">
          <span class="badge">${escapeHtml(video.category || "OTT")}</span>
          ${progress ? '<span class="badge is-warm">Resume</span>' : ""}
        </span>
      </span>
      <span class="tile-title">${escapeHtml(video.title)}</span>
      <span class="tile-description">${escapeHtml(trimDescription(video.description))}</span>
      <span class="tile-meta">
        ${video.year ? `<span>${escapeHtml(video.year)}</span>` : ""}
        ${video.duration ? `<span>${escapeHtml(video.duration)}</span>` : ""}
        ${video.maturity ? `<span>${escapeHtml(video.maturity)}</span>` : ""}
      </span>
    `;

    const actions = document.createElement("span");
    actions.className = "tile-actions";
    actions.append(
      createTileAction("play", "Play now", () => playVideo(video)),
      createTileAction(progress ? "history" : "plus", progress ? "Resume" : "Save", () => {
        if (progress) {
          playVideo(video, { resume: true });
        } else {
          toggleMyList(video.id);
        }
      }, Boolean(progress || inList)),
      createTileAction("share-2", "Share", () => shareVideo(video))
    );
    body.append(actions);

    tile.append(img, body);

    if (progress) {
      const progressBar = document.createElement("span");
      progressBar.className = "tile-progress";
      const progressFill = document.createElement("span");
      const ratio = progress.duration ? Math.min(100, Math.max(4, (progress.position / progress.duration) * 100)) : 8;
      progressFill.style.setProperty("--progress", `${ratio}%`);
      progressFill.style.width = `${ratio}%`;
      progressBar.append(progressFill);
      tile.append(progressBar);
    }

    return tile;
  }

  function createEmptyState(message) {
    const box = document.createElement("div");
    box.className = "empty-state";
    box.textContent = message;
    return box;
  }

  async function playVideo(video, options = {}) {
    state.currentVideo = video;
    
    if (state.useDetachedMode && document.pictureInPictureElement === els.videoElement) {
      els.playerOverlay.hidden = true;
    } else {
      els.playerOverlay.hidden = false;
    }
    els.playerError.hidden = true;
    els.playerTitle.textContent = video.title;
    els.playerMeta.textContent = [video.year, video.duration, video.category].filter(Boolean).join("  ");
    els.watchTitle.textContent = video.title;
    els.watchDescription.textContent = video.description;
    els.playbackState.textContent = "";
    els.protectionState.textContent = "";
    els.adStatus.textContent = "Waiting";
    els.videoElement.poster = firstThumbnail(video);
    state.firedAds = new Set();
    state.adCuePoints = (video.adCuePoints || config.adCuePoints || []).map(Number).filter(Number.isFinite);
    state.lastProgressSavedAt = 0;
    renderPlayerIntel(video);

    // ── Observability: start session ────────────────────────
    if (window.OTT_OBS) window.OTT_OBS.onPlayIntent();

    try {
      await ensureShaka();
      await state.player.unload();
      revokeManifestBlob();

      const key = await getClearKey(video.id);
      if (key) {
        const kidHex = cleanHex(key.key_id);
        const keyHex = cleanHex(key.key);
        const kidB64 = bufferToBase64Url(hexToBytes(kidHex));
        const keyB64 = bufferToBase64Url(hexToBytes(keyHex));
        
        console.log(`[DRM] Configuring ClearKey for ${video.id}`, { 
          kid_hex: kidHex, 
          key_hex: keyHex,
          kid_b64: kidB64,
          key_b64: keyB64
        });

        state.player.configure({
          drm: {
            clearKeys: {
              [kidHex]: keyHex,
              [kidB64]: keyB64
            }
          }
        });
        els.protectionState.textContent = "DRM: ClearKey (AES-CENC)";
        els.playbackState.textContent = "Ready";
      } else {
        console.log(`[DRM] No key found for ${video.id}, proceeding without DRM`);
        state.player.configure({ drm: { clearKeys: {} } });
        els.protectionState.textContent = "DRM: None (Clear)";
        els.playbackState.textContent = "Ready";
      }

      const loadedUrl = await loadManifestWithFallback(video);
      state.currentManifestUrl = loadedUrl;
      prepareMediaSession(video);
      prepareIma();
      if (options.resume) {
        seekToStoredProgress(video);
      }
      await els.videoElement.play().catch(() => undefined);
      setToast(`Playing ${video.title}`, "success");
    } catch (error) {
      console.error("[Player] Playback Error:", error);
      if (window.OTT_OBS) window.OTT_OBS.onError();
      
      const errorDetail = error.code ? `Shaka Error ${error.code} (${error.severity})` : error.message || "Unknown error";
      showPlayerError(errorDetail);
      setToast(`Error: ${errorDetail}`, "error");
    }
  }

  async function ensureShaka() {
    if (!window.shaka) {
      throw new Error("Shaka Player script is not loaded.");
    }

    if (!state.shakaReady) {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        throw new Error("Browser does not support Shaka Player.");
      }

      state.player = new shaka.Player(els.videoElement);
      state.ui = new shaka.ui.Overlay(state.player, els.videoContainer, els.videoElement);
      state.ui.configure({
        controlPanelElements: [
          "play_pause",
          "time_and_duration",
          "spacer",
          "mute",
          "volume",
          "fullscreen",
          "overflow_menu"
        ],
        overflowMenuButtons: ["captions", "quality", "language", "picture_in_picture", "playback_rate"]
      });

      state.player.configure({
        abr: { enabled: true },
        streaming: {
          bufferingGoal: 20,
          rebufferingGoal: 3,
          retryParameters: {
            maxAttempts: 2,
            baseDelay: 700,
            backoffFactor: 1.6,
            fuzzFactor: 0.4,
            timeout: 12000
          }
        }
      });

      state.player.addEventListener("error", (event) => {
        const error = event.detail;
        console.error("Shaka error", error);
        if (window.OTT_OBS) window.OTT_OBS.onError();
        const errorDetail = error.code ? `Shaka Error ${error.code} (${error.severity})` : "Asynchronous playback error";
        showPlayerError(errorDetail);
      });

      state.player.addEventListener("timelineregionenter", onTimelineRegionEnter);
      state.player.addEventListener("timelineregionadded", onTimelineRegionAdded);

      // ── Observability: Shaka ABR / buffering / bandwidth ───
      state.player.addEventListener("adaptation", (event) => {
        if (window.OTT_OBS) {
          const track = state.player.getVariantTracks().find(t => t.active);
          if (track) window.OTT_OBS.onBitrateChange(track.bandwidth || 0);
        }
      });

      state.player.addEventListener("buffering", (event) => {
        if (window.OTT_OBS) {
          if (event.buffering) {
            window.OTT_OBS.onBufferingStart();
          } else {
            window.OTT_OBS.onBufferingEnd();
          }
        }
      });

      els.videoElement.addEventListener("error", showPlayerError);
      els.videoElement.addEventListener("canplay", () => {
        if (window.OTT_OBS) window.OTT_OBS.onFirstFrame();
      });
      els.videoElement.addEventListener("play", () => {
        if (window.OTT_OBS) window.OTT_OBS.onPlayResume();
      });
      els.videoElement.addEventListener("pause", () => {
        if (window.OTT_OBS) window.OTT_OBS.onPlayPause();
      });
      els.videoElement.addEventListener("timeupdate", (event) => {
        handleCuePoints();
        savePlaybackProgress();
        updateSceneMarkerState();
        // Sample bandwidth estimate + dropped frames
        if (window.OTT_OBS) {
          const stats = state.player.getStats ? state.player.getStats() : null;
          if (stats && stats.estimatedBandwidth) {
            window.OTT_OBS.onBandwidthEstimate(stats.estimatedBandwidth);
          }
          window.OTT_OBS.onTimeUpdate(els.videoElement);
        }
      });
      els.videoElement.addEventListener("ended", () => {
        els.adStatus.textContent = "Complete";
        clearPlaybackProgress(state.currentVideo?.id);
        updateHeroResumeButton(state.featuredVideo);
        if (window.OTT_OBS) window.OTT_OBS.onVideoEnd();
      });

      state.shakaReady = true;
    }
  }

  async function loadManifestWithFallback(video) {
    const urls = manifestCandidates(video);
    let lastError = null;

    for (const url of urls) {
      try {
        await state.player.load(url);
        return url;
      } catch (error) {
        lastError = error;
        console.error(`[Player] Failed to load ${url}`, error);
        await state.player.unload().catch(() => undefined);
        
        // Only use the static MPD blob hack for our local dynamic outputs.
        // Doing this for external URLs (like DASH-IF) breaks all relative segments!
        if (url.includes(config.cdnBaseUrl || "missing") || url.includes(config.r2BaseUrl || "missing")) {
          const patchedUrl = await createStaticMpdBlobUrl(url).catch(() => "");
          if (patchedUrl) {
             try {
               await state.player.load(patchedUrl);
               return url;
             } catch (patchedError) {
               lastError = patchedError;
               await state.player.unload().catch(() => undefined);
             }
          }
        }
      }
    }

    throw lastError || new Error("Playback could not start.");
  }

  function manifestCandidates(video) {
    const urls = [];
    if (video.mpdUrl) {
      urls.push(video.mpdUrl);
    }
    
    // Fallback to slug-based folder on CDN
    if (config.cdnBaseUrl) {
      urls.push(`${trimSlash(config.cdnBaseUrl)}/${encodeURIComponent(video.slug)}/manifest.mpd`);
    }
    
    return mergeUnique(urls);
  }

  async function createStaticMpdBlobUrl(url) {
    const response = await fetch(withCacheBust(url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`MPD fetch failed: ${response.status}`);
    }

    const text = await response.text();
    if (!/type=["']dynamic["']/.test(text) && /<BaseURL>/i.test(text)) {
      return "";
    }

    const base = url.slice(0, url.lastIndexOf("/") + 1);
    const patched = staticizeMpd(text, base);
    revokeManifestBlob();
    state.manifestBlobUrl = URL.createObjectURL(new Blob([patched], { type: "application/dash+xml" }));
    return state.manifestBlobUrl;
  }

  function staticizeMpd(text, baseUrl) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      return stringStaticizeMpd(text, baseUrl);
    }

    const mpd = doc.documentElement;
    mpd.setAttribute("type", "static");
    mpd.removeAttribute("publishTime");
    mpd.removeAttribute("availabilityStartTime");
    mpd.removeAttribute("minimumUpdatePeriod");
    mpd.removeAttribute("timeShiftBufferDepth");

    if (!mpd.getElementsByTagName("BaseURL")[0]) {
      const base = doc.createElementNS(mpd.namespaceURI, "BaseURL");
      base.textContent = baseUrl;
      mpd.insertBefore(base, mpd.firstElementChild);
    }

    if (!mpd.getAttribute("mediaPresentationDuration")) {
      const seconds = estimateMpdDuration(doc);
      if (seconds > 0) {
        mpd.setAttribute("mediaPresentationDuration", secondsToIsoDuration(seconds));
      }
    }

    return new XMLSerializer().serializeToString(doc);
  }

  function stringStaticizeMpd(text, baseUrl) {
    let patched = text
      .replace(/\s+type=["']dynamic["']/, ' type="static"')
      .replace(/\s+publishTime=["'][^"']*["']/g, "")
      .replace(/\s+availabilityStartTime=["'][^"']*["']/g, "")
      .replace(/\s+minimumUpdatePeriod=["'][^"']*["']/g, "")
      .replace(/\s+timeShiftBufferDepth=["'][^"']*["']/g, "");

    if (!/<BaseURL>/i.test(patched)) {
      patched = patched.replace(/(<MPD\b[^>]*>)/, `$1\n  <BaseURL>${escapeXml(baseUrl)}</BaseURL>`);
    }

    return patched;
  }

  function estimateMpdDuration(doc) {
    let maxSeconds = 0;
    const templates = Array.from(doc.getElementsByTagName("SegmentTemplate"));
    for (const template of templates) {
      const timescale = Number(template.getAttribute("timescale")) || 1;
      let total = 0;
      const timeline = template.getElementsByTagName("SegmentTimeline")[0];
      if (!timeline) {
        continue;
      }

      for (const s of Array.from(timeline.getElementsByTagName("S"))) {
        const duration = Number(s.getAttribute("d")) || 0;
        const repeat = Number(s.getAttribute("r")) || 0;
        total += duration * (repeat >= 0 ? repeat + 1 : 1);
      }

      maxSeconds = Math.max(maxSeconds, total / timescale);
    }
    return maxSeconds;
  }

  async function getClearKey(videoId) {
    try {
      const response = await fetch(`${config.api.license}/${videoId}`);
      if (response.status === 204) return null;
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data.keys && data.keys[0]) {
        return {
          key_id: data.keys[0].kid,
          key: data.keys[0].k
        };
      }
    } catch (err) {
      console.error("[DRM] License fetch error", err);
    }
    return null;
  }

  // Client-side decryption removed. Decryption is now handled server-side in API routes.

  function onTimelineRegionAdded(event) {
    if (isScteRegion(event.detail)) {
      els.adStatus.textContent = "Ad break";
    }
  }

  function onTimelineRegionEnter(event) {
    if (isScteRegion(event.detail)) {
      requestAdBreak("Ad break");
    }
  }

  function isScteRegion(detail) {
    if (!detail) {
      return false;
    }
    const scheme = String(detail.schemeIdUri || detail.schemeIdURI || detail.id || "").toLowerCase();
    if (scheme.includes("scte") || scheme.includes("splice")) {
      return true;
    }
    try {
      const text = JSON.stringify(detail).toLowerCase();
      return text.includes("scte") || text.includes("splice_insert") || text.includes("spliceinsert");
    } catch {
      return false;
    }
  }

  function handleCuePoints() {
    if (!state.currentVideo || state.adPlaying) {
      return;
    }

    const time = els.videoElement.currentTime || 0;
    for (const cue of state.adCuePoints) {
      if (time >= cue && !state.firedAds.has(cue)) {
        state.firedAds.add(cue);
        requestAdBreak("Ad break");
        break;
      }
    }
  }

  function prepareIma() {
    if (state.imaReady || !window.google || !google.ima || !config.googleImaAdTag) {
      return;
    }

    els.videoElement.addEventListener("enterpictureinpicture", () => {
      state.useDetachedMode = true;
    });

    els.videoElement.addEventListener("leavepictureinpicture", () => {
      state.useDetachedMode = false;
      if (state.currentVideo) {
        els.playerOverlay.hidden = false;
      }
    });

    const displayContainer = new google.ima.AdDisplayContainer(els.adContainer, els.videoElement);
    displayContainer.initialize();
    state.adsLoader = new google.ima.AdsLoader(displayContainer);
    state.adsLoader.addEventListener(
      google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      onAdsManagerLoaded,
      false
    );
    state.adsLoader.addEventListener(
      google.ima.AdErrorEvent.Type.AD_ERROR,
      (event) => {
        console.warn("IMA error", event.getError());
        showDemoAdBreak("ad error fallback");
      },
      false
    );
    state.imaReady = true;
  }

  function requestAdBreak(reason) {
    els.adStatus.textContent = "Ad break";

    if (!config.googleImaAdTag || !window.google || !google.ima || !state.adsLoader) {
      showAdBreak(reason);
      return;
    }

    try {
      const request = new google.ima.AdsRequest();
      request.adTagUrl = config.googleImaAdTag;
      request.linearAdSlotWidth = Math.max(320, els.videoContainer.clientWidth);
      request.linearAdSlotHeight = Math.max(180, els.videoContainer.clientHeight);
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = 120;
      state.adsLoader.requestAds(request);
    } catch (error) {
      console.warn(error);
      showAdBreak(reason);
    }
  }

  function onAdsManagerLoaded(event) {
    state.adsManager = event.getAdsManager(els.videoElement);
    state.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {
      state.adPlaying = true;
      els.videoElement.pause();
    });
    state.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
      state.adPlaying = false;
      els.videoElement.play().catch(() => undefined);
    });
    state.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => {
      els.adStatus.textContent = "Ad complete";
    });
    state.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, () => {
      state.adPlaying = false;
      els.videoElement.play().catch(() => undefined);
    });

    const width = Math.max(320, els.videoContainer.clientWidth);
    const height = Math.max(180, els.videoContainer.clientHeight);
    state.adsManager.init(width, height, google.ima.ViewMode.NORMAL);
    state.adsManager.start();
  }

  function showAdBreak(reason) {
    if (state.adPlaying) {
      return;
    }

    state.adPlaying = true;
    els.videoElement.pause();
    els.adOverlay.hidden = false;
    els.adStatus.textContent = "Ad break";

    let seconds = 5;
    els.adCountdown.textContent = String(seconds);
    clearInterval(state.adTimer);
    state.adTimer = setInterval(() => {
      seconds -= 1;
      els.adCountdown.textContent = String(Math.max(0, seconds));
      if (seconds <= 0) {
        clearInterval(state.adTimer);
        state.adPlaying = false;
        els.adOverlay.hidden = true;
        els.adStatus.textContent = "Ad complete";
        els.videoElement.play().catch(() => undefined);
      }
    }, 1000);
  }

  function showPlayerError(detail = "") {
    els.playerError.hidden = false;
    const errorMsg = document.getElementById("playerErrorMessage");
    if (errorMsg) {
      errorMsg.textContent = detail || "This title is unavailable right now.";
    }
  }

  async function closePlayer() {
    els.playerOverlay.hidden = true;
    els.playerError.hidden = true;
    
    if (document.pictureInPictureElement === els.videoElement) {
      state.useDetachedMode = true;
      return;
    }

    clearInterval(state.adTimer);
    state.adPlaying = false;
    els.adOverlay.hidden = true;
    savePlaybackProgress(true);

    // ── Observability: flush session on close ───────────────
    if (window.OTT_OBS) await window.OTT_OBS.onVideoEnd().catch(() => undefined);

    if (state.player) {
      await state.player.unload().catch(() => undefined);
    }
    revokeManifestBlob();
  }

  async function togglePictureInPicture() {
    const video = els.videoElement;
    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) {
      setToast("Picture in picture is not available in this browser.", "error");
      return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.warn(error);
      setToast("Picture in picture could not start.", "error");
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await els.videoContainer.requestFullscreen();
      }
    } catch (error) {
      console.warn(error);
      setToast("Fullscreen could not start.", "error");
    }
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      setToast("Notifications are not available in this browser.", "error");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification(config.appName || "OTT Glass", {
        body: "Notifications are enabled.",
        icon: config.logoUrl || "./assets/logo.png"
      });
      setToast("Notifications enabled.", "success");
    } else {
      setToast("Notifications were not enabled.", "error");
    }
  }

  async function registerDeviceUnlock() {
    if (!state.currentUser) {
      setToast("Sign in before registering device unlock.", "error");
      return;
    }

    if (!window.PublicKeyCredential || !navigator.credentials) {
      setToast("Device unlock is not available in this browser.", "error");
      return;
    }

    try {
      const displayName = state.currentUser.displayName || state.currentUser.email || state.currentUser.userId || "OTT User";
      const userBytes = new TextEncoder().encode(displayName).slice(0, 64);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: config.appName || "OTT Glass" },
          user: {
            id: userBytes,
            name: displayName,
            displayName
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 }
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "preferred"
          },
          timeout: 60000,
          attestation: "none"
        }
      });

      localStorage.setItem(DEVICE_KEY, JSON.stringify({
        credentialId: bufferToBase64Url(credential.rawId),
        user: state.currentUser
      }));
      setToast("Device unlock registered.", "success");
    } catch (error) {
      console.warn(error);
      setToast("Device unlock registration was not completed.", "error");
    }
  }

  async function unlockWithDevice() {
    const saved = readJson(DEVICE_KEY);
    if (!saved || !saved.credentialId) {
      setAuthMessage("No device unlock is registered yet.", true);
      return;
    }

    if (!window.PublicKeyCredential || !navigator.credentials) {
      setAuthMessage("Device unlock is not available here.", true);
      return;
    }

    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [
            {
              type: "public-key",
              id: base64UrlToBuffer(saved.credentialId)
            }
          ],
          userVerification: "preferred",
          timeout: 60000
        }
      });

      state.currentUser = saved.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(saved.user));
      await enterApp();
      setToast("Unlocked with this device.", "success");
    } catch (error) {
      console.warn(error);
      setAuthMessage("Device unlock was cancelled or rejected.", true);
    }
  }

  async function installPwa() {
    if (!state.installPrompt) {
      setToast("Install is available from the browser menu on this device.");
      return;
    }

    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => undefined);
    state.installPrompt = null;
    els.installButton.hidden = true;
  }

  async function detectPlaybackDevice() {
    const parts = [];
    if (window.shaka) {
      parts.push("Shaka");
    }

    if (navigator.requestMediaKeySystemAccess) {
      const clearKey = await supportsKeySystem("org.w3.clearkey");
      const widevine = await supportsKeySystem("com.widevine.alpha");
      if (clearKey) {
        parts.push("ClearKey");
      }
      if (widevine) {
        parts.push("Widevine");
      }
      if (widevine && /Android/i.test(navigator.userAgent)) {
        parts.push("Mobile DRM");
      }
    }

    if (!parts.length) {
      parts.push("Playback ready");
    }

    if (els.deviceStatus) {
      // els.deviceStatus.textContent = mergeUnique(parts).join(" | ");
    }
  }

  async function supportsKeySystem(keySystem) {
    try {
      await navigator.requestMediaKeySystemAccess(keySystem, [
        {
          initDataTypes: ["cenc"],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }]
        }
      ]);
      return true;
    } catch {
      return false;
    }
  }

  function prepareMediaSession(video) {
    if (!("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title,
      artist: config.appName || "OTT Glass",
      album: video.category || "OTT",
      artwork: [
        { src: firstThumbnail(video), sizes: "512x512", type: "image/png" }
      ]
    });

    const actions = {
      play: () => els.videoElement.play(),
      pause: () => els.videoElement.pause(),
      seekbackward: () => seekBy(-10),
      seekforward: () => seekBy(10),
      previoustrack: () => playNeighbor(-1),
      nexttrack: () => playNeighbor(1)
    };

    for (const [name, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {
        // Some Android/browser combinations do not support every action.
      }
    }
  }

  function seekBy(seconds) {
    const video = els.videoElement;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + seconds));
  }

  function playNeighbor(direction) {
    if (!state.currentVideo || !state.catalog.length) {
      return;
    }
    const next = getSuggestedNextVideo(state.currentVideo, direction);
    if (next) {
      playVideo(next);
    }
  }

  function toggleMyList(videoId) {
    const ids = readJson(MY_LIST_KEY) || [];
    const exists = ids.includes(videoId);
    const next = exists ? ids.filter((id) => id !== videoId) : [videoId, ...ids];
    localStorage.setItem(MY_LIST_KEY, JSON.stringify(next));
    renderApp();
    setToast(exists ? "Removed from My List." : "Added to My List.", exists ? "" : "success");
  }

  function updateHeroListButton() {
    if (!state.featuredVideo) {
      return;
    }
    const ids = readJson(MY_LIST_KEY) || [];
    const inList = ids.includes(state.featuredVideo.id);
    els.heroListButton.innerHTML = inList
      ? '<i data-lucide="check" aria-hidden="true"></i> In My List'
      : '<i data-lucide="plus" aria-hidden="true"></i> My List';
    drawIcons();
  }

  function renderHeroFeatureCards(video) {
    if (!els.heroFeatureCards) {
      return;
    }

    const continueVideo = getContinueWatchingVideos()[0];
    const becauseVideo = getBecauseYouWatchedVideos(video).find((item) => item.id !== video.id);
    const continueProgress = continueVideo ? readProgressMap()[continueVideo.id] : null;

    const cards = [
      continueVideo
        ? {
            variant: "accent",
            tag: "Continue",
            title: continueVideo.title,
            copy: `Resume from ${formatClock(continueProgress?.position || 0)} with your last position saved locally.`,
            action: { label: "Resume", icon: "history", handler: () => playVideo(continueVideo, { resume: true }) }
          }
        : {
            variant: "accent",
            tag: "Start fast",
            title: "Quick night mode",
            copy: "Jump straight into a short watch rail built from the existing library.",
            action: { label: "Open Quick Watch", icon: "zap", handler: () => scrollToRail("Quick Watch") }
          },
      becauseVideo
        ? {
            variant: "warm",
            tag: "Because you watched",
            title: becauseVideo.title,
            copy: `A nearby ${becauseVideo.category.toLowerCase()} pick that fits your recent viewing lane.`,
            action: { label: "Play next", icon: "sparkles", handler: () => playVideo(becauseVideo) }
          }
        : {
            variant: "",
            tag: "Discovery",
            title: `Trending in ${getRegionLabel()}`,
            copy: "Region-aware presentation on top of the current catalog and rail structure.",
            action: { label: "Browse trending", icon: "globe-2", handler: () => scrollToRail(`Trending in ${getRegionLabel()}`) }
          }
    ];

    els.heroFeatureCards.innerHTML = "";
    for (const card of cards) {
      const article = document.createElement("article");
      article.className = `feature-card ${card.variant ? `hero-card--${card.variant}` : ""}`.trim();
      article.innerHTML = `
        <div class="feature-card-top">
          <span>${escapeHtml(card.tag)}</span>
          <i data-lucide="sparkles" aria-hidden="true"></i>
        </div>
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.copy)}</p>
      `;

      if (card.action) {
        const button = document.createElement("button");
        button.className = "ghost-btn";
        button.type = "button";
        button.innerHTML = `<i data-lucide="${card.action.icon}" aria-hidden="true"></i>${escapeHtml(card.action.label)}`;
        button.addEventListener("click", card.action.handler);
        article.append(button);
      }

      els.heroFeatureCards.append(article);
    }
    drawIcons();
  }

  function renderMoodChips(video) {
    if (!els.heroMoodChips) {
      return;
    }

    const chipDefs = [
      { label: "Quick watch", action: () => scrollToRail("Quick Watch") },
      { label: video.category || "Featured", action: () => applySearchQuery(video.category || "") },
      { label: "Animation", action: () => applySearchQuery("animation") },
      { label: "Documentary", action: () => applySearchQuery("documentary") },
      { label: "Sci-Fi", action: () => applySearchQuery("sci-fi") }
    ];

    els.heroMoodChips.innerHTML = "";
    for (const chip of chipDefs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mood-chip";
      button.textContent = chip.label;
      button.addEventListener("click", chip.action);
      els.heroMoodChips.append(button);
    }
  }

  function renderCuratedStrip() {
    if (!els.curatedStrip) {
      return;
    }

    const chips = [
      { label: "Continue Watching", action: () => scrollToRail("Continue Watching") },
      { label: `Because You Watched ${getAffinityCategory()}`, action: () => scrollToRail(`Because You Watched ${getAffinityCategory()}`) },
      { label: "Short on time", action: () => scrollToRail("Quick Watch") },
      { label: `Trending in ${getRegionLabel()}`, action: () => scrollToRail(`Trending in ${getRegionLabel()}`) },
      { label: "Open My List", action: () => document.getElementById("my-list")?.scrollIntoView({ behavior: "smooth", block: "start" }) }
    ];

    els.curatedStrip.innerHTML = "";
    for (const chip of chips) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "curation-chip";
      button.textContent = chip.label;
      button.addEventListener("click", chip.action);
      els.curatedStrip.append(button);
    }
  }

  function renderSearchSuggestions() {
    if (!els.searchSuggestionPanel) {
      return;
    }

    const query = state.searchQuery;
    const suggestions = [];

    if (query) {
      for (const video of state.catalog.filter(matchesSearch).slice(0, 5)) {
        suggestions.push({
          title: video.title,
          meta: [video.category, video.year, video.duration].filter(Boolean).join(" • "),
          handler: () => playVideo(video, { resume: Boolean(readProgressMap()[video.id]) })
        });
      }
    } else {
      const resumeVideo = getContinueWatchingVideos()[0];
      if (resumeVideo) {
        suggestions.push({
          title: `Resume ${resumeVideo.title}`,
          meta: `Saved at ${formatClock(readProgressMap()[resumeVideo.id]?.position || 0)}`,
          handler: () => playVideo(resumeVideo, { resume: true })
        });
      }

      suggestions.push(
        {
          title: `Browse ${getAffinityCategory()}`,
          meta: "Use your strongest viewing lane as a shortcut.",
          handler: () => applySearchQuery(getAffinityCategory())
        },
        {
          title: "Short picks under 15 minutes",
          meta: "Instant-watch rail for low-friction starts.",
          handler: () => scrollToRail("Quick Watch")
        },
        {
          title: `Trending in ${getRegionLabel()}`,
          meta: "Localized presentation layer built from the current catalog.",
          handler: () => scrollToRail(`Trending in ${getRegionLabel()}`)
        }
      );
    }

    els.searchSuggestionPanel.innerHTML = "";
    if (!suggestions.length) {
      hideSearchSuggestions();
      return;
    }

    const list = document.createElement("div");
    list.className = "search-suggestion-list";

    for (const suggestion of suggestions.slice(0, 5)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-suggestion-item";
      button.innerHTML = `<strong>${escapeHtml(suggestion.title)}</strong><span>${escapeHtml(suggestion.meta)}</span>`;
      button.addEventListener("click", () => {
        hideSearchSuggestions();
        suggestion.handler();
      });
      list.append(button);
    }

    els.searchSuggestionPanel.append(list);
    els.searchSuggestionPanel.hidden = false;
  }

  function hideSearchSuggestions() {
    if (els.searchSuggestionPanel) {
      els.searchSuggestionPanel.hidden = true;
      els.searchSuggestionPanel.innerHTML = "";
    }
  }

  function renderAssistantSuggestions() {
    if (!els.assistantSuggestionList) {
      return;
    }

    const continueVideo = getContinueWatchingVideos()[0];
    const becauseVideo = getBecauseYouWatchedVideos()[0];
    const quickVideo = getQuickWatchVideos()[0];
    const myListVideo = (readJson(MY_LIST_KEY) || []).map((id) => state.catalogById.get(id)).find(Boolean);

    const suggestions = [
      continueVideo && {
        title: `Resume ${continueVideo.title}`,
        meta: `Jump back in at ${formatClock(readProgressMap()[continueVideo.id]?.position || 0)}.`,
        handler: () => playVideo(continueVideo, { resume: true })
      },
      becauseVideo && {
        title: `Stay in ${becauseVideo.category}`,
        meta: `Play ${becauseVideo.title} as the next likely fit.`,
        handler: () => playVideo(becauseVideo)
      },
      quickVideo && {
        title: "Find something short",
        meta: `${quickVideo.title} anchors the quick-watch lane.`,
        handler: () => scrollToRail("Quick Watch")
      },
      myListVideo && {
        title: "Open your saved list",
        meta: `${myListVideo.title} and your other picks are ready.`,
        handler: () => document.getElementById("my-list")?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    ].filter(Boolean);

    els.assistantSuggestionList.innerHTML = "";

    for (const suggestion of suggestions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-suggestion-item";
      button.innerHTML = `<strong>${escapeHtml(suggestion.title)}</strong><span>${escapeHtml(suggestion.meta)}</span>`;
      button.addEventListener("click", () => {
        setAssistantOpen(false);
        suggestion.handler();
      });
      els.assistantSuggestionList.append(button);
    }
  }

  function handleAssistantPrimaryAction() {
    const options = [
      getBecauseYouWatchedVideos()[0],
      getTrendingVideos()[0],
      getQuickWatchVideos()[0],
      state.featuredVideo
    ].filter(Boolean);

    if (!options.length) {
      setToast("No surprise pick is ready yet.");
      return;
    }

    const surprise = options[Math.floor(Math.random() * options.length)];
    setAssistantOpen(false);
    playVideo(surprise, { resume: Boolean(readProgressMap()[surprise.id]) });
  }

  function setAssistantOpen(open) {
    if (!els.assistantPanel || !els.assistantBackdrop) {
      return;
    }

    state.assistantVisible = open;

    if (open) {
      els.assistantBackdrop.hidden = false;
      els.assistantPanel.hidden = false;
      document.body.classList.add("assistant-open");
      requestAnimationFrame(() => {
        els.assistantPanel.classList.add("is-open");
      });
      return;
    }

    els.assistantPanel.classList.remove("is-open");
    document.body.classList.remove("assistant-open");
    els.assistantBackdrop.hidden = true;
    window.setTimeout(() => {
      if (!state.assistantVisible) {
        els.assistantPanel.hidden = true;
      }
    }, 220);
  }

  function renderPlayerIntel(video) {
    if (!video) {
      return;
    }

    const progress = readProgressMap()[video.id];
    const nextVideo = getSuggestedNextVideo(video);
    const stats = [
      ["Category", video.category || "Featured"],
      ["Runtime", video.duration || "Adaptive"],
      ["Resume", progress ? formatClock(progress.position) : "Fresh start"],
      ["Playback", els.deviceStatus?.textContent || "Ready"]
    ];

    if (els.watchStats) {
      els.watchStats.innerHTML = "";
      for (const [label, value] of stats) {
        const row = document.createElement("div");
        row.innerHTML = `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
        els.watchStats.append(row);
      }
    }

    if (els.sceneMarkers) {
      els.sceneMarkers.innerHTML = "";
      for (const marker of getSceneMarkers(video)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scene-marker";
        button.dataset.time = String(marker.time);
        button.textContent = marker.label;
        button.addEventListener("click", () => seekBy(marker.time - (els.videoElement.currentTime || 0)));
        els.sceneMarkers.append(button);
      }
    }

    if (els.upNextTitle && els.upNextMeta && els.upNextButton) {
      els.upNextTitle.textContent = nextVideo?.title || "No next title ready";
      els.upNextMeta.textContent = nextVideo
        ? [nextVideo.category, nextVideo.duration, nextVideo.year].filter(Boolean).join(" • ")
        : "Your next recommendation will appear here.";
      els.upNextButton.dataset.videoId = nextVideo?.id || "";
      els.upNextButton.hidden = !nextVideo;
    }
  }

  function updateSceneMarkerState() {
    if (!els.sceneMarkers) {
      return;
    }
    const current = els.videoElement.currentTime || 0;
    els.sceneMarkers.querySelectorAll(".scene-marker").forEach((marker) => {
      const time = Number(marker.dataset.time || 0);
      marker.classList.toggle("is-active", current >= time && current < time + 60);
    });
  }

  function createTileAction(icon, label, onClick, isActive = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tile-action ${isActive ? "is-active" : ""}`.trim();
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function shareVideo(video) {
    const shareData = {
      title: video.title,
      text: `${video.title} on ${config.appName || "VigilSiddhi OTT"}`,
      url: `${location.origin}${location.pathname}#home`
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => undefined);
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`).catch(() => undefined);
      setToast("Link copied for sharing.", "success");
      return;
    }

    setToast("Sharing is not available in this browser.");
  }

  function applySearchQuery(query) {
    const value = String(query || "");
    els.searchInput.value = value;
    state.searchQuery = value.trim().toLowerCase();
    hideSearchSuggestions();
    renderRails();
    document.getElementById("rails")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToRail(title) {
    const normalized = prettifyRailTitle(title).toLowerCase();
    const rail = Array.from(document.querySelectorAll(".rail")).find((element) => {
      const heading = element.querySelector("h2");
      return heading && heading.textContent.trim().toLowerCase() === normalized;
    });
    rail?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildHeroStatus(video) {
    if (readProgressMap()[video.id]) {
      return "Resume ready";
    }
    if (isVideoInMyList(video.id)) {
      return "Saved by you";
    }
    return getContinueWatchingVideos().length ? "Tailored for tonight" : "Featured now";
  }

  function buildHeroSupportCopy(video) {
    return `${state.catalog.length} titles are available right now, with discovery grouped around ${getAffinityCategory().toLowerCase()} viewing and regional momentum in ${getRegionLabel()}.`;
  }

  function updateHeroResumeButton(video) {
    if (!els.heroResumeButton || !video) {
      return;
    }

    const progress = readProgressMap()[video.id];
    if (!progress || progress.position < 25) {
      els.heroResumeButton.hidden = true;
      return;
    }

    els.heroResumeButton.hidden = false;
    els.heroResumeButton.innerHTML = `<i data-lucide="history" aria-hidden="true"></i>Resume ${formatClock(progress.position)}`;
    drawIcons();
  }

  function savePlaybackProgress(force = false) {
    if (!state.currentVideo || !els.videoElement) {
      return;
    }

    if (!force && Date.now() - state.lastProgressSavedAt < 5000) {
      return;
    }

    const duration = Number.isFinite(els.videoElement.duration) ? els.videoElement.duration : 0;
    const position = els.videoElement.currentTime || 0;
    if (!duration || position < 5) {
      return;
    }

    const progressMap = readProgressMap();
    if (position >= duration - 10) {
      delete progressMap[state.currentVideo.id];
    } else if (position > 25 || force) {
      progressMap[state.currentVideo.id] = {
        position,
        duration,
        updatedAt: Date.now()
      };
    }

    localStorage.setItem(WATCH_PROGRESS_KEY, JSON.stringify(progressMap));
    state.lastProgressSavedAt = Date.now();
    if (state.featuredVideo) {
      updateHeroResumeButton(state.featuredVideo);
    }
  }

  function clearPlaybackProgress(videoId) {
    if (!videoId) {
      return;
    }
    const progressMap = readProgressMap();
    delete progressMap[videoId];
    localStorage.setItem(WATCH_PROGRESS_KEY, JSON.stringify(progressMap));
  }

  function readProgressMap() {
    return readJson(WATCH_PROGRESS_KEY) || {};
  }

  function seekToStoredProgress(video) {
    const saved = readProgressMap()[video.id];
    if (!saved?.position) {
      return;
    }
    const upperBound = Number(saved.duration) > 12 ? saved.duration - 6 : saved.position;
    const safeTarget = Math.max(0, Math.min(saved.position, upperBound));
    els.videoElement.currentTime = safeTarget;
  }

  function getContinueWatchingVideos() {
    const progressMap = readProgressMap();
    return Object.entries(progressMap)
      .map(([id, progress]) => ({ video: state.catalogById.get(id), updatedAt: progress.updatedAt || 0 }))
      .filter((item) => item.video)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => item.video);
  }

  function getQuickWatchVideos() {
    return state.catalog
      .filter((video) => {
        const minutes = durationToMinutes(video.duration);
        return minutes > 0 && minutes <= 15;
      })
      .slice(0, 8);
  }

  function getAffinityCategory() {
    const affinityVideo =
      getContinueWatchingVideos()[0] ||
      (readJson(MY_LIST_KEY) || []).map((id) => state.catalogById.get(id)).find(Boolean) ||
      state.featuredVideo ||
      state.catalog[0];
    return affinityVideo?.category || "Featured";
  }

  function getBecauseYouWatchedVideos(seedVideo = null) {
    const category = seedVideo?.category || getAffinityCategory();
    return state.catalog
      .filter((video) => video.category === category && video.id !== seedVideo?.id)
      .slice(0, 8);
  }

  function getTrendingVideos() {
    const configuredTrending = (config.rails || []).find((rail) => /trending/i.test(prettifyRailTitle(rail.title)));
    if (configuredTrending?.items?.length) {
      return configuredTrending.items
        .map((id) => state.catalogById.get(id))
        .filter(Boolean)
        .slice(0, 8);
    }
    return state.catalog.slice(0, 8);
  }

  function getSuggestedNextVideo(currentVideo, direction = 1) {
    if (!currentVideo || !state.catalog.length) {
      return null;
    }

    if (direction === 1) {
      const sibling = state.catalog.find((video) => video.id !== currentVideo.id && video.category === currentVideo.category);
      if (sibling) {
        return sibling;
      }
    }

    const index = state.catalog.findIndex((video) => video.id === currentVideo.id);
    if (index === -1) {
      return state.catalog[0] || null;
    }

    return state.catalog[(index + direction + state.catalog.length) % state.catalog.length] || null;
  }

  function getSceneMarkers(video) {
    const duration = Number.isFinite(els.videoElement.duration) && els.videoElement.duration > 0
      ? els.videoElement.duration
      : durationToSeconds(video.duration) || 600;
    return [
      { label: "Intro", time: Math.max(0, duration * 0.06) },
      { label: "Highlight", time: Math.max(10, duration * 0.38) },
      { label: "Finale", time: Math.max(20, duration * 0.78) }
    ];
  }

  function getRegionLabel() {
    const region = String(navigator.language || "en-US").split("-")[1] || "US";
    const labels = {
      IN: "India",
      US: "the US",
      GB: "the UK",
      CA: "Canada",
      AU: "Australia"
    };
    return labels[region.toUpperCase()] || "your region";
  }

  function prettifyRailTitle(title) {
    const raw = String(title || "").trim();
    if (/continue/i.test(raw)) return "Continue Watching";
    if (/quick/i.test(raw)) return "Quick Watch";
    if (/trending/i.test(raw)) return raw.includes("in ") ? raw : "Trending Now";
    if (/new/i.test(raw) && /hot/i.test(raw)) return "New & Hot";
    return raw
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/\s+/g, " ")
      .trim() || "Browse";
  }

  function buildRailEyebrow(title) {
    const safeTitle = String(title || "");
    if (/continue/i.test(safeTitle)) return "Resume ready";
    if (/because/i.test(safeTitle)) return "Personalized";
    if (/trending/i.test(safeTitle)) return "Regional momentum";
    if (/quick/i.test(safeTitle)) return "Fast starts";
    if (/list/i.test(safeTitle)) return "Saved by you";
    return "Curated rail";
  }

  function updateShellChrome() {
    els.topbar?.classList.toggle("is-scrolled", window.scrollY > 16);
  }

  function isVideoInMyList(videoId) {
    return (readJson(MY_LIST_KEY) || []).includes(videoId);
  }

  function trimDescription(text) {
    const safe = String(text || "").trim();
    if (safe.length <= 88) {
      return safe;
    }
    return `${safe.slice(0, 85).trimEnd()}...`;
  }

  function durationToMinutes(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return 0;
    let minutes = 0;
    const hoursMatch = text.match(/(\d+)\s*h/);
    const minutesMatch = text.match(/(\d+)\s*m/);
    const secondsMatch = text.match(/(\d+)\s*s/);
    if (hoursMatch) minutes += Number(hoursMatch[1]) * 60;
    if (minutesMatch) minutes += Number(minutesMatch[1]);
    if (!hoursMatch && !minutesMatch && /^\d+$/.test(text)) minutes = Number(text);
    if (!minutes && secondsMatch) minutes = Math.max(1, Math.round(Number(secondsMatch[1]) / 60));
    return minutes;
  }

  function durationToSeconds(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return 0;
    let seconds = 0;
    const hoursMatch = text.match(/(\d+)\s*h/);
    const minutesMatch = text.match(/(\d+)\s*m/);
    const secondsMatch = text.match(/(\d+)\s*s/);
    if (hoursMatch) seconds += Number(hoursMatch[1]) * 3600;
    if (minutesMatch) seconds += Number(minutesMatch[1]) * 60;
    if (secondsMatch) seconds += Number(secondsMatch[1]);
    return seconds;
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function thumbnailCandidates(video) {
    const candidates = [];
    if (video.thumbnail) {
      candidates.push(video.thumbnail);
    }
    for (const fileName of config.thumbnailFileNames || []) {
      if (config.cdnBaseUrl) {
        candidates.push(`${trimSlash(config.cdnBaseUrl)}/${encodeURIComponent(video.id)}/${fileName}`);
      }
      if (config.r2BaseUrl) {
        candidates.push(`${trimSlash(config.r2BaseUrl)}/${encodeURIComponent(video.id)}/${fileName}`);
      }
      if (config.localOutputBaseUrl) {
        candidates.push(`${trimSlash(config.localOutputBaseUrl)}/${encodeURIComponent(video.id)}/${fileName}`);
      }
    }
    candidates.push(config.logoUrl || "./assets/logo.png");
    return mergeUnique(candidates);
  }

  function firstThumbnail(video) {
    return thumbnailCandidates(video)[0] || config.logoUrl || "./assets/logo.png";
  }

  function setSmartImage(img, candidates) {
    const safeCandidates = mergeUnique(candidates.filter(Boolean));
    let index = 0;
    img.onerror = () => {
      index += 1;
      if (index < safeCandidates.length) {
        img.src = safeCandidates[index];
      } else {
        img.onerror = null;
        img.src = config.logoUrl || "./assets/logo.png";
      }
    };
    img.src = safeCandidates[0] || config.logoUrl || "./assets/logo.png";
  }


  function matchesSearch(video) {
    if (!video) return false;
    const term = (state.searchQuery || "").toLowerCase().trim();
    const filter = (state.activeFilter || "").toLowerCase().trim();

    if (filter && video.category?.toLowerCase() !== filter && video.genre?.toLowerCase() !== filter) {
      return false;
    }

    if (!term) return true;

    const haystack = `${video.title} ${video.description} ${video.category} ${video.genre} ${video.id}`.toLowerCase();
    return haystack.includes(term);
  }

  async function fetchJson(url) {
    if (!url) {
      return null;
    }
    const response = await fetch(withCacheBust(url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${url}`);
    }
    return maybeDecryptJson(await response.json());
  }

  async function fetchFirstJson(urls) {
    let lastError = null;
    for (const url of mergeUnique(urls || [])) {
      try {
        const data = await fetchJson(url);
        console.log(`[FETCH] Success for ${url}`);
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No JSON URL configured.");
  }

  function withCacheBust(url) {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}_=${Date.now()}`;
  }

  function normalizeList(source, keys) {
    if (!source) {
      return [];
    }
    if (Array.isArray(source)) {
      return source;
    }
    for (const key of keys) {
      if (Array.isArray(source[key])) {
        return source[key];
      }
    }
    return [];
  }

  function withCacheBust(url) {
    if (!url || typeof url !== "string") return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}cb=${Date.now()}`;
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeUserId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function setAuthMessage(message, isError = false) {
    els.authMessage.textContent = message;
    els.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    if (busy) {
      button.textContent = "Please wait";
    } else {
      button.innerHTML = '<i data-lucide="log-in" aria-hidden="true"></i> Sign in';
      drawIcons();
    }
  }

  function setToast(message, type = "") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      return;
    }
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }

  function drawIcons() {
    if (window.lucide) {
      lucide.createIcons();
    }
  }

  function mergeUnique(values) {
    return Array.from(new Set(values.filter((value) => value !== undefined && value !== null && String(value).length)));
  }

  function titleFromId(id) {
    return String(id || "video")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function trimSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function cleanHex(value) {
    return String(value || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  }

  function secondsToIsoDuration(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    return `PT${safe.toFixed(3).replace(/\.?0+$/, "")}S`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeXml(value) {
    return escapeHtml(value);
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function decodeFlexibleBytes(value) {
    const text = String(value || "").trim();
    if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
      return hexToBytes(text);
    }
    return new Uint8Array(base64UrlToBuffer(text));
  }

  function hexToBytes(hex) {
    const clean = cleanHex(hex);
    const bytes = new Uint8Array(clean.length / 2);
    for (let index = 0; index < clean.length; index += 2) {
      bytes[index / 2] = parseInt(clean.slice(index, index + 2), 16);
    }
    return bytes;
  }

  function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBuffer(value) {
    const text = String(value || "");
    const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  function revokeManifestBlob() {
    if (state.manifestBlobUrl) {
      URL.revokeObjectURL(state.manifestBlobUrl);
      state.manifestBlobUrl = "";
    }
  }

  // Expose decryption globally for other modules (observability)
  window.maybeDecryptJson = maybeDecryptJson;
})();
