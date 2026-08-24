/**
 * 电子木鱼交互与音效（视觉参考 fish.leixf.cn）
 */
(function (global) {
  var MERIT_KEY = "pjyz_merit_count";
  var meritCount = 0;
  var audioCtx = null;
  var tapLock = false;
  var initialized = false;

  function loadMerit() {
    try {
      var n = parseInt(localStorage.getItem(MERIT_KEY), 10);
      meritCount = isNaN(n) ? 0 : Math.max(0, n);
    } catch (_) {
      meritCount = 0;
    }
  }

  function saveMerit() {
    try {
      localStorage.setItem(MERIT_KEY, String(meritCount));
    } catch (_) {}
  }

  function updateMeritDisplay() {
    var el = document.getElementById("meritCount");
    if (el) el.textContent = String(meritCount);
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /** 木鱼敲击音：短促空心木声 + 衰减 */
  function playMuyuSound() {
    try {
      var ctx = ensureAudio();
      var t = ctx.currentTime;

      var len = Math.floor(ctx.sampleRate * 0.18);
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var env = Math.pow(1 - i / len, 2.2);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(920, t);
      bp.Q.setValueAtTime(0.9, t);
      var bp2 = ctx.createBiquadFilter();
      bp2.type = "lowpass";
      bp2.frequency.setValueAtTime(1400, t);
      var nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.55, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      noise.connect(bp);
      bp.connect(bp2);
      bp2.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.16);

      var osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(520, t);
      osc1.frequency.exponentialRampToValueAtTime(220, t + 0.06);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.42, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc1.connect(g1);
      g1.connect(ctx.destination);
      osc1.start(t);
      osc1.stop(t + 0.24);

      var osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(780, t);
      osc2.frequency.exponentialRampToValueAtTime(340, t + 0.04);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.18, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc2.connect(g2);
      g2.connect(ctx.destination);
      osc2.start(t);
      osc2.stop(t + 0.12);
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
    var cRect = container.getBoundingClientRect();
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
    stage.classList.add("tapping");
    setTimeout(function () { stage.classList.remove("tapping"); }, 120);
  }

  function isClockOpen() {
    var overlay = document.getElementById("clockOverlay");
    return overlay && overlay.classList.contains("show");
  }

  function tap() {
    if (tapLock) return;
    tapLock = true;
    setTimeout(function () { tapLock = false; }, 80);

    playMuyuSound();
    playTapAnim();
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

  function bind() {
    var stage = document.getElementById("fishStage");
    if (stage) {
      stage.addEventListener("click", function (e) {
        e.stopPropagation();
        tap();
      });
    }
    document.addEventListener("keydown", onKeyDown);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    loadMerit();
    updateMeritDisplay();
    bind();
  }

  global.MuyuFish = {
    init: init,
    tap: tap,
    getMerit: function () { return meritCount; }
  };
})(typeof window !== "undefined" ? window : globalThis);
