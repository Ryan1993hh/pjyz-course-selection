/**
 * 电子木鱼交互与音效
 * 移动端策略：在用户手势同步栈内直接 new Audio().play()，避免静音解锁竞态
 */
(function (global) {
  var MERIT_KEY = "pjyz_merit_daily";
  var AUDIO_FILE = "audio/muyu-tap.mp3?v=20260905d";
  var MAX_PARTICLES = 12;
  var ANIM_MS = 140;
  var MAX_LIVE_SOUNDS = 8;

  var meritCount = 0;
  var meritDate = "";
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
  var liveSounds = [];
  var sharedAudio = null;
  var audioSrc = "";
  var lastGestureTapAt = 0;

  function resolveAudioSrc() {
    if (audioSrc) return audioSrc;
    // 1) 内嵌 data URI（不依赖网络/路径，移动端最稳）
    if (global.MUYU_TAP_DATA_URI) {
      audioSrc = String(global.MUYU_TAP_DATA_URI);
      return audioSrc;
    }
    // 2) 页面预置 audio 节点
    var preset = document.getElementById("muyuTapAudio");
    if (preset && preset.getAttribute("src")) {
      audioSrc = preset.src || preset.getAttribute("src");
      return audioSrc;
    }
    // 3) 静态文件兜底
    try {
      audioSrc = new URL("/" + AUDIO_FILE.replace(/^\//, ""), global.location.origin).href;
    } catch (_) {
      audioSrc = "/" + AUDIO_FILE.replace(/^\//, "");
    }
    return audioSrc;
  }

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

  function ensureSharedAudio() {
    if (sharedAudio) return sharedAudio;
    try {
      // 优先使用页面预置节点
      sharedAudio = document.getElementById("muyuTapAudio");
      if (!sharedAudio) {
        sharedAudio = document.createElement("audio");
        sharedAudio.id = "muyuTapAudioRuntime";
        sharedAudio.controls = false;
        sharedAudio.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-9999px;";
        (document.body || document.documentElement).appendChild(sharedAudio);
      }
      sharedAudio.src = resolveAudioSrc();
      sharedAudio.preload = "auto";
      sharedAudio.setAttribute("playsinline", "true");
      sharedAudio.setAttribute("webkit-playsinline", "true");
      sharedAudio.muted = false;
      sharedAudio.volume = 1;
      try { sharedAudio.load(); } catch (_) {}
    } catch (_) {
      sharedAudio = null;
    }
    return sharedAudio;
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
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      try {
        var p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (_) {}
    }
    return ctx;
  }

  function loadAudioBuffer() {
    if (audioBuffer || audioBufferLoading) return;
    var ctx = getAudioContext();
    if (!ctx) return;

    function decodeAb(ab) {
      return new Promise(function (resolve, reject) {
        var ret = ctx.decodeAudioData(ab, resolve, reject);
        if (ret && typeof ret.then === "function") ret.then(resolve, reject);
      });
    }

    // data URI 优先本地解码
    var src = resolveAudioSrc();
    if (src.indexOf("data:audio") === 0) {
      audioBufferLoading = fetch(src)
        .then(function (r) { return r.arrayBuffer(); })
        .then(decodeAb)
        .then(function (buf) {
          audioBuffer = buf;
          audioBufferLoading = null;
        })
        .catch(function () { audioBufferLoading = null; });
      return;
    }

    if (typeof fetch !== "function") return;
    audioBufferLoading = fetch(src)
      .then(function (r) {
        if (!r.ok) throw new Error("audio missing");
        return r.arrayBuffer();
      })
      .then(decodeAb)
      .then(function (buf) {
        audioBuffer = buf;
        audioBufferLoading = null;
      })
      .catch(function () {
        audioBufferLoading = null;
      });
  }

  function pruneLiveSounds() {
    while (liveSounds.length > MAX_LIVE_SOUNDS) {
      var old = liveSounds.shift();
      try {
        old.pause();
        old.src = "";
        if (old.parentNode) old.parentNode.removeChild(old);
      } catch (_) {}
    }
  }

  /** 在用户手势同步调用栈内播放，兼容 iOS / Android / 微信 */
  function playHtmlAudioNow() {
    var src = resolveAudioSrc();
    ensureSharedAudio();

    // 优先：克隆已挂载的 audio（对 iOS 最稳）
    if (sharedAudio) {
      try {
        var cloned = sharedAudio.cloneNode(true);
        cloned.muted = false;
        cloned.volume = 1;
        try { cloned.currentTime = 0; } catch (_) {}
        (document.body || document.documentElement).appendChild(cloned);
        liveSounds.push(cloned);
        pruneLiveSounds();
        var p1 = cloned.play();
        if (p1 && typeof p1.then === "function") {
          p1.then(function () {
            setTimeout(function () {
              try {
                if (cloned.parentNode) cloned.parentNode.removeChild(cloned);
              } catch (_) {}
            }, 1500);
          }).catch(function () {
            playFreshAudio(src);
          });
          return true;
        }
        return true;
      } catch (_) {}
    }

    playFreshAudio(src);
    return true;
  }

  function playFreshAudio(src) {
    try {
      var a = new Audio(src || resolveAudioSrc());
      a.preload = "auto";
      a.setAttribute("playsinline", "true");
      a.setAttribute("webkit-playsinline", "true");
      a.muted = false;
      a.volume = 1;
      liveSounds.push(a);
      pruneLiveSounds();
      var p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          if (sharedAudio) {
            try {
              sharedAudio.muted = false;
              sharedAudio.volume = 1;
              sharedAudio.currentTime = 0;
              sharedAudio.play().catch(function () {});
            } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  function playWebAudioNow() {
    var ctx = resumeAudioContext();
    if (!ctx || !audioBuffer || ctx.state === "suspended") return false;
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

  function unlockAudio() {
    ensureSharedAudio();
    var ctx = resumeAudioContext();
    loadAudioBuffer();
    if (audioUnlocked) {
      resumeAudioContext();
      return;
    }
    audioUnlocked = true;

    // 静音级解锁（几乎听不见），避免打开弹窗就响一声，同时满足移动端手势策略
    if (sharedAudio) {
      try {
        sharedAudio.muted = false;
        sharedAudio.volume = 0.001;
        sharedAudio.currentTime = 0;
        var p = sharedAudio.play();
        if (p && typeof p.then === "function") {
          p.then(function () {
            try {
              sharedAudio.pause();
              sharedAudio.currentTime = 0;
              sharedAudio.volume = 1;
            } catch (_) {}
          }).catch(function () {
            try { sharedAudio.volume = 1; } catch (_) {}
          });
        } else {
          try { sharedAudio.volume = 1; } catch (_) {}
        }
      } catch (_) {}
    }
    if (ctx) {
      try {
        var buf = ctx.createBuffer(1, 1, 22050);
        var node = ctx.createBufferSource();
        node.buffer = buf;
        node.connect(ctx.destination);
        node.start(0);
      } catch (_) {}
    }
  }

  function playMuyuSound() {
    // 移动端始终走 HTMLAudio（最稳）；桌面优先 WebAudio
    var touchLike = ("ontouchstart" in global) || (global.navigator && global.navigator.maxTouchPoints > 0);
    if (touchLike) playHtmlAudioNow();
    else if (!playWebAudioNow()) playHtmlAudioNow();
    if (!audioUnlocked) unlockAudio();
    else resumeAudioContext();
    loadAudioBuffer();
  }

  function gestureTap() {
    if (!isClockOpen()) return false;
    var now = Date.now();
    if (now - lastGestureTapAt < 90) return false;
    lastGestureTapAt = now;
    suppressClickUntil = now + 450;
    playMuyuSound();
    ensureTodayMerit();
    playTapAnim();
    meritCount += 1;
    saveMerit();
    updateMeritDisplay();
    bumpMeritCount();
    spawnMeritParticle();
    return true;
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
    node.style.left = (rect.width * (0.32 + Math.random() * 0.36)) + "px";
    node.style.top = (rect.height * (0.22 + Math.random() * 0.24)) + "px";
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
        if (activeAnims.length > 20) {
          var old = activeAnims.shift();
          try { if (old && old.cancel) old.cancel(); } catch (_) {}
        }
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
    gestureTap();
  }

  function onPointerDown(e) {
    if (!isClockOpen()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gestureTap();
  }

  function onClick(e) {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    gestureTap();
  }

  function onKeyDown(e) {
    if (!isClockOpen()) return;
    if (e.repeat) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      gestureTap();
    }
  }

  function startDayWatch() {
    if (dayWatchTimer) return;
    dayWatchTimer = setInterval(ensureTodayMerit, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") ensureTodayMerit();
    });
  }

  function bind() {
    var stage = document.getElementById("fishStage");
    if (!stage || stage === boundStage) return;
    boundStage = stage;
    stage.addEventListener("pointerdown", onPointerDown, { passive: false });
    stage.addEventListener("touchstart", function (e) {
      if (!isClockOpen()) return;
      if (e.touches && e.touches.length > 1) return;
      e.preventDefault();
      gestureTap();
    }, { passive: false });
    stage.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
  }

  function init() {
    if (!initialized) {
      initialized = true;
      loadMerit();
      updateMeritDisplay();
      resolveAudioSrc();
      ensureSharedAudio();
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
