/**
 * VigilSiddhi OTT - Mobile Optimization Engine
 * Handles device detection, conditional rendering, and mobile-specific gestures.
 */

(function () {
  const MOBILE_BREAKPOINT = 768;

  function updateViewMode() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    if (isMobile) {
      document.body.classList.remove("desktop-view");
      document.body.classList.add("mobile-view");
    } else {
      document.body.classList.remove("mobile-view");
      document.body.classList.add("desktop-view");
    }
    
    // Feature-based conditional rendering
    handleConditionalRendering(isMobile);
  }

  function handleConditionalRendering(isMobile) {
    // 1. Handle Sidebar/Heavy components in Player Overlay
    const watchPanel = document.querySelector('.watch-panel');
    if (watchPanel) {
      if (isMobile) {
        // We might want to move it or hide it depending on UX
        // For now, let's ensure it doesn't clutter the main view
      }
    }

    // 2. Hide heavy desktop-only banners if any
    const desktopOnlyElements = document.querySelectorAll('.desktop-only');
    desktopOnlyElements.forEach(el => {
      el.style.display = isMobile ? 'none' : '';
    });

    // 3. Handle mobile-only elements
    const mobileOnlyElements = document.querySelectorAll('.mobile-only');
    mobileOnlyElements.forEach(el => {
      el.style.display = isMobile ? '' : 'none';
    });
  }

  // --- MOBILE GESTURES ---
  let lastTap = 0;
  let tapTimeout = null;
  function initMobileGestures() {
    const videoContainer = document.getElementById('videoContainer');
    if (!videoContainer) return;

    videoContainer.addEventListener('touchstart', function (e) {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const now = Date.now();
      const DOUBLE_TAP_THRESHOLD = 300;
      
      if (now - lastTap < DOUBLE_TAP_THRESHOLD) {
        clearTimeout(tapTimeout);
        handleDoubleTap(e, videoContainer);
        lastTap = 0;
      } else {
        lastTap = now;
        tapTimeout = setTimeout(() => {
          handleSingleTap();
        }, DOUBLE_TAP_THRESHOLD);
      }
    });
  }

  function handleSingleTap() {
    const video = document.getElementById('videoElement');
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function handleDoubleTap(e, container) {
    const rect = container.getBoundingClientRect();
    const touchX = e.changedTouches[0].clientX - rect.left;
    const width = rect.width;
    const video = document.getElementById('videoElement');
    if (!video) return;

    if (touchX < width / 3) {
      // Seek back
      video.currentTime = Math.max(0, video.currentTime - 10);
      showGestureFeedback('rewind');
    } else if (touchX > (width * 2) / 3) {
      // Seek forward
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
      showGestureFeedback('fast-forward');
    }
  }

  function showGestureFeedback(type) {
    const feedback = document.createElement('div');
    feedback.className = `gesture-feedback ${type}`;
    feedback.innerHTML = type === 'rewind' ? '<span>-10s</span>' : '<span>+10s</span>';
    document.getElementById('videoContainer').appendChild(feedback);
    setTimeout(() => feedback.remove(), 500);
  }

  // Initialize
  window.addEventListener('resize', updateViewMode);
  document.addEventListener('DOMContentLoaded', () => {
    updateViewMode();
    initMobileGestures();
  });

})();
