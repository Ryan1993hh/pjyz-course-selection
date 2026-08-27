/**
 * 电子木鱼交互与音效（视觉参考 fish.leixf.cn）
 * 功德仅统计当天，跨日自动清零
 */
(function (global) {
  var MERIT_KEY = "pjyz_merit_daily";
  var AUDIO_SRC = "audio/muyu-tap.mp3?v=20260826b";
  var meritCount = 0;
  var meritDate = "";
  var tapAudio = null;
  var tapAnimTimer = null;
  var dayWatchTimer = null;
  var initialized = false;

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

  function preloadTapAudio() {
    if (tapAudio) return;
    try {
      tapAudio = new Audio(AUDIO_SRC);
      tapAudio.preload = "auto";
      tapAudio.load();
    } catch (_) {}
  }

  function playMuyuSound() {
    try {
      var audio = tapAudio ? tapAudio.cloneNode() : new Audio(AUDIO_SRC);
      audio.volume = 1;
      var p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {});
      }
    } catch (_) {}
  }

  function bumpMeritCount() {
    var el = document.getElementById("meritCount");
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    setTimeout(function () { el.classList.remove("bump"); }, 220);
  }

  function spawnMeritParticle() {
    var container = document.getElementById("meritParticles");
    var stage = document.getElementById("fishStage");
    if (!container || !stage) return;
    var node = document.createElement("div");
    node.className = "merit-particle";
    node.textContent = "功德 +1";
    var rect = stage.getBoundingClientRect();
    var x = rect.width * (0.35 + Math.random() * 0.3);
    var y = rect.height * (0.25 + Math.random() * 0.2);
    node.style.left = x + "px";
    node.style.top = y + "px";
    container.appendChild(node);
    setTimeout(function () { node.remove(); }, 1100);
  }

  function playTapAnim() {
    var stage = document.getElementById("fishStage");
    if (!stage) return;
    stage.classList.remove("tapping");
    void stage.offsetWidth;
    stage.classList.add("tapping");
    if (tapAnimTimer) clearTimeout(tapAnimTimer);
    tapAnimTimer = setTimeout(function () {
      stage.classList.remove("tapping");
      tapAnimTimer = null;
    }, 260);
  }

  function isClockOpen() {
    var overlay = document.getElementById("clockOverlay");
    return overlay && overlay.classList.contains("show");
  }

  function tap() {
    ensureTodayMerit();
    playTapAnim();
    playMuyuSound();
    meritCount += 1;
    saveMerit();
    updateMeritDisplay();
    bumpMeritCount();
    spawnMeritParticle();
  }

  function onKeyDown(e) {
    if (!isClockOpen()) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
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
    if (stage) {
      stage.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        tap();
      });
    }
    document.addEventListener("keydown", onKeyDown);
  }

  function init() {
    if (initialized) {
      bind();
      return;
    }
    initialized = true;
    loadMerit();
    updateMeritDisplay();
    preloadTapAudio();
    bind();
    startDayWatch();
  }

  global.MuyuFish = {
    init: init,
    tap: tap,
    getMerit: function () { return meritCount; }
  };
})(typeof window !== "undefined" ? window : globalThis);
