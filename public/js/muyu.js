/**
 * 电子木鱼交互与音效（视觉参考 fish.leixf.cn）
 * 功德仅统计当天，跨日自动清零
 * 音效：优先 HTMLAudio 池（兼容移动端手势解锁）+ Web Audio 低延迟叠加
 */
(function (global) {
  var MERIT_KEY = "pjyz_merit_daily";
  var AUDIO_SRC = "/audio/muyu-tap.mp3?v=20260905c";
  var AUDIO_POOL_SIZE = 12;
  var MAX_PARTICLES = 14;
  var ANIM_MS = 140;

  var meritCount = 0;
  var meritDate = "";
  var audioPool = [];
  var audioPoolIdx = 0;
  var audioCtx = null;
  var audioBuffer = null;
  var audioBufferLoading = null;
  var audioUnlocked = false;
  var dayWatchTimer = null;
  var initialized = false;
  var boundStage = null;
  var suppressClickUntil = 0;
  var activeAnims = [];
  var bumpTimer = null;

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function loadMerit() {
    try {
      var raw = localStorage.getItem(MERIT_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        meritDate = String((data && data.date) || "");
        meritCount = parseInt(data && data.count, 10);
        if (isNaN(meritCount) || meritCount < 0) meritCount = 0;
      } else {
        meritDate = "";
        meritCount = 0;
      }
    } catch (_) {
      meritDate = "";
      meritCount = 0;
    }
    ensureTodayMerit();
  }

  function ensureTodayMerit() {
    var today = todayKey();
    if (meritDate !== today) {
      meritDate = today;
      meritCount = 0;
      saveMerit();
      updateMeritDisplay();
    }
  }

  function saveMerit() {
    try {
      localStorage.setItem(MERIT_KEY, JSON.stringify({
        date: meritDate || todayKey(),
        count: meritCount
      }));
    } catch (_) {}
  }

  function updateMeritDisplay() {
    var el = document.getElementById("meritCount");
    if (el) el.textContent = String(meritCount);
  }

  function getAudioContext() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) {
      try { audioCtx = new AC(); } catch (_) { return null; }
    }
    return audioCtx;
  }

  function resumeAudioContext() {
    var ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      try {
        var p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (_) {}
    }
    return ctx;
  }

  function ensureAudioPool() {
    if (audioPool.length) return;
    for (var i = 0; i < AUDIO_POOL_SIZE; i++) {
      try {
        var audio = new Audio(AUDIO_SRC);
        audio.preload = "auto";
        audio.setAttribute("playsinline", "true");
        audio.load();
        audioPool.push(audio);
      } catch (_) {}
    }
  }

  function loadAudioBuffer() {
    if (audioBuffer || audioBufferLoading) return;
    var ctx = getAudioContext();
    if (!ctx || typeof fetch !== "function") return;
    audioBufferLoading = fetch(AUDIO_SRC)
      .then(function (r) {
        if (!r.ok) throw new Error("audio fetch failed");
        return r.arrayBuffer();
      })
      .then(function (ab) { return ctx.decodeAudioData(ab.slice(0)); })
      .then(function (buf) {
        audioBuffer = buf;
        audioBufferLoading = null;
      })
      .catch(function () {
        audioBufferLoading = null;
      });
  }

  function unlockAudio() {
    ensureAudioPool();
    resumeAudioContext();
    loadAudioBuffer();
    if (audioUnlocked) return;
    audioUnlocked = true;
    // 在用户手势内解锁 Audio 元素（iOS/Android 必需）
    for (var i = 0; i < audioPool.length; i++) {
      (function (audio) {
        try {
          audio.muted = true;
          audio.volume = 0;
          var p = audio.play();
          if (p && typeof p.then === "function") {
            p.then(function () {
              try {
                audio.pause();
                audio.currentTime = 0;
                audio.muted = false;
                audio.volume = 1;
              } catch (_) {}
            }).catch(function () {
              try {
                audio.muted = false;
                audio.volume = 1;
              } catch (_) {}
            });
          } else {
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
              audio.volume = 1;
            } catch (_) {}
          }
        } catch (_) {}
      })(audioPool[i]);
    }
  }

  function playHtmlAudio() {
    ensureAudioPool();
    if (!audioPool.length) {
      try {
        var once = new Audio(AUDIO_SRC);
        once.play().catch(function () {});
      } catch (_) {}
      return;
    }
    var audio = audioPool[audioPoolIdx % audioPool.length];
    audioPoolIdx += 1;
    try {
      audio.muted = false;
      audio.volume = 1;
      // 上一段未播完则换新实例，避免连击被卡住
      if (!audio.paused && audio.currentTime > 0.02) {
        audio = new Audio(AUDIO_SRC);
        audio.setAttribute("playsinline", "true");
      } else {
        try { audio.pause(); } catch (_) {}
        try { audio.currentTime = 0; } catch (_) {}
      }
      var p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          try {
            var retry = new Audio(AUDIO_SRC);
            retry.setAttribute("playsinline", "true");
            retry.play().catch(function () {});
          } catch (_) {}
        });
      }
    } catch (_) {
      try {
        var fallback = new Audio(AUDIO_SRC);
        fallback.play().catch(function () {});
      } catch (__) {}
    }
  }

  function playWebAudio() {
    var ctx = resumeAudioContext();
    if (!ctx || !audioBuffer) return false;
    try {
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      gain.gain.value = 1;
      src.buffer = audioBuffer;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
      return true;
    } catch (_) {
      return false;
    }
  }

  function playMuyuSound() {
    unlockAudio();
    // Web Audio 已就绪则用低延迟重叠播放；否则立刻用 HTMLAudio 池（原音效文件）
    if (audioBuffer && playWebAudio()) return;
    playHtmlAudio();
    if (!audioBuffer) loadAudioBuffer();
  }

  function bumpMeritCount() {
    var el = document.getElementById("meritCount");
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    if (bumpTimer) clearTimeout(bumpTimer);
    bumpTimer = setTimeout(function () {
      el.classList.remove("bump");
      bumpTimer = null;
    }, 140);
  }

  function spawnMeritParticle() {
    var container = document.getElementById("meritParticles");
    var stage = document.getElementById("fishStage");
    if (!container || !stage) return;
    while (container.childNodes.length >= MAX_PARTICLES) {
      container.removeChild(container.firstChild);
    }
    var node = document.createElement("div");
    node.className = "merit-particle";
    node.textContent = "功德 +1";
    var rect = stage.getBoundingClientRect();
    var x = rect.width * (0.32 + Math.random() * 0.36);
    var y = rect.height * (0.22 + Math.random() * 0.24);
    node.style.left = x + "px";
    node.style.top = y + "px";
    container.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 720);
  }

  function runElementAnim(el, keyframes, opts) {
    if (!el) return;
    if (typeof el.animate === "function") {
      try {
        var anim = el.animate(keyframes, opts);
        activeAnims.push(anim);
        if (activeAnims.length > 24) {
          var old = activeAnims.shift();
          try { if (old && old.cancel) old.cancel(); } catch (_) {}
        }
        anim.onfinish = function () {
          var i = activeAnims.indexOf(anim);
          if (i >= 0) activeAnims.splice(i, 1);
        };
        return;
      } catch (_) {}
    }
    el.classList.remove("strike");
    void el.offsetWidth;
    el.classList.add("strike");
    setTimeout(function () { el.classList.remove("strike"); }, ANIM_MS + 20);
  }

  function playTapAnim() {
    var stage = document.getElementById("fishStage");
    if (!stage) return;
    var hammer = stage.querySelector(".wooden-hammer");
    var fish = stage.querySelector(".wooden-fish");
    runElementAnim(hammer, [
      { transform: "rotate(16deg)" },
      { transform: "rotate(52deg)", offset: 0.4 },
      { transform: "rotate(16deg)" }
    ], { duration: ANIM_MS, easing: "ease-out" });
    runElementAnim(fish, [
      { transform: "translateX(-50%) scale(1)" },
      { transform: "translateX(-50%) scale(0.92)", offset: 0.4 },
      { transform: "translateX(-50%) scale(1)" }
    ], { duration: ANIM_MS, easing: "ease-out" });
  }

  function isClockOpen() {
    var overlay = document.getElementById("clockOverlay");
    return overlay && overlay.classList.contains("show");
  }

  function tap() {
    if (!isClockOpen()) return;
    ensureTodayMerit();
    playMuyuSound();
    playTapAnim();
    meritCount += 1;
    saveMerit();
    updateMeritDisplay();
    bumpMeritCount();
    spawnMeritParticle();
  }

  function onPointerDown(e) {
    if (!isClockOpen()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntil = Date.now() + 350;
    unlockAudio();
    tap();
  }

  function onClick(e) {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    unlockAudio();
    tap();
  }

  function onKeyDown(e) {
    if (!isClockOpen()) return;
    if (e.repeat) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      tap();
    }
  }

  function startDayWatch() {
    if (dayWatchTimer) return;
    dayWatchTimer = setInterval(function () {
      ensureTodayMerit();
    }, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") ensureTodayMerit();
    });
  }

  function bind() {
    var stage = document.getElementById("fishStage");
    if (!stage || stage === boundStage) return;
    boundStage = stage;
    stage.addEventListener("pointerdown", onPointerDown, { passive: false });
    stage.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
  }

  function init() {
    if (!initialized) {
      initialized = true;
      loadMerit();
      updateMeritDisplay();
      ensureAudioPool();
      startDayWatch();
    }
    bind();
  }

  global.MuyuFish = {
    init: init,
    unlock: unlockAudio,
    tap: tap,
    getMerit: function () { return meritCount; }
  };
})(typeof window !== "undefined" ? window : globalThis);
