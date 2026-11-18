// Forge TD — procedural Web Audio (100% original, no sample files).
// Identity: a cartoon forge — anvil clinks, hammer strikes, metallic rings,
// hot-metal sizzles, ember crackles, bellows whooshes, quench hiss, furnace roars.
// Safe to call at any time: never throws, no-ops until unlocked / if Web Audio is missing.
(function (root) {
  'use strict';

  var LS_VOL = 'forgetd.volume';
  var LS_MUTE = 'forgetd.muted';
  var LS_MVOL = 'forgetd.musicVolume';
  var LS_MMUTE = 'forgetd.musicMuted';
  var GLOBAL_CAP = 22;
  var AC = (typeof root !== 'undefined' && (root.AudioContext || root.webkitAudioContext)) ||
           (typeof AudioContext !== 'undefined' && AudioContext) ||
           (typeof webkitAudioContext !== 'undefined' && webkitAudioContext) ||
           null;

  var ctx = null, master = null, limiter = null;
  var musicGain = null, duckGain = null, fadeGain = null, pad = null;
  var unlocked = false, attaching = false;
  var volume = 0.7, muted = false;
  var musicVolume = 0.35, musicMuted = false;
  var musicOn = false, musicFading = false, musicScene = 'match', musicWanted = null;
  var musicLevel = 0, musicStep = 0, musicNext = 0, musicTimer = 0, musicHidden = false;
  var musicLive = 0, musicPeak = 0;
  var lastAt = Object.create(null);
  var counts = Object.create(null);
  var active = [];
  var noiseBufs = Object.create(null);
  var load = 0, cheapMode = false, thinN = 0, nodeCount = 0;
  var BUCKET_RATE = 28, BUCKET_BURST = 12, tokens = 12, tokenAt = 0;
  var emaMs = 16.7, lastRaf = 0, longStreak = 0, goodStreak = 0, lagging = false, lagUntil = 0;
  var frameGen = 0, rafOn = false, lastPlayFrame = -1, playsThisFrame = 0;
  // Refresh-rate-relative cheap mode: baseline is a rolling median of vsync-like frames, clamped to 6–21 ms
  // (144 Hz … 50 Hz). Absolute 14/16/20 ms thresholds wrongly treat 60 Hz as "never recovered" and 50 Hz as lag.
  var baseSamples = [], baseline = 16.7, haveBase = false;
  var BASE_MIN = 6, BASE_MAX = 21, BASE_NEED = 20, BASE_CAP = 45;
  // Slow devices (dt > 24 ms) never fill baseSamples. After ~2 s / 60 visible frames, adopt a clamped median anyway.
  var fallbackSamples = [], visFrames = 0, visMs = 0;

  // Inharmonic metal partials (not a harmonic series — sounds like struck iron, not a bell copy).
  var METAL = [1, 1.34, 1.77, 2.21, 2.92, 3.61, 4.45, 5.43];

  try {
    var sv = parseFloat(root.localStorage && root.localStorage.getItem(LS_VOL));
    if (isFinite(sv)) volume = clamp(sv, 0, 1);
    muted = !!(root.localStorage && root.localStorage.getItem(LS_MUTE) === '1');
    var mv = parseFloat(root.localStorage && root.localStorage.getItem(LS_MVOL));
    if (isFinite(mv)) musicVolume = clamp(mv, 0, 1);
    musicMuted = !!(root.localStorage && root.localStorage.getItem(LS_MMUTE) === '1');
  } catch (e) { /* private mode / no storage */ }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function persist() {
    try {
      if (!root.localStorage) return;
      root.localStorage.setItem(LS_VOL, String(volume));
      root.localStorage.setItem(LS_MUTE, muted ? '1' : '0');
      root.localStorage.setItem(LS_MVOL, String(musicVolume));
      root.localStorage.setItem(LS_MMUTE, musicMuted ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function applyMaster() {
    if (!master || !ctx) return;
    var v = muted ? 0 : volume;
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    applyMusicGain();
  }

  function later(fn, ms) {
    try { return ((root && root.setTimeout) || setTimeout)(fn, Math.max(0, ms || 0)); } catch (e) { return 0; }
  }
  function cancelLater(id) {
    try { if (id) ((root && root.clearTimeout) || clearTimeout)(id); } catch (e) {}
  }

  function supported() { return typeof AC === 'function'; }

  function createGraph() {
    if (ctx) return;
    ctx = new AC();
    ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createPanner'].forEach(function (fn) {
      if (!ctx[fn]) return;
      var orig = ctx[fn];
      ctx[fn] = function () { nodeCount++; return orig.apply(ctx, arguments); };
    });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // Build looping noise once on unlock so a play never allocates a long buffer mid-frame.
    noiseBuffer('white'); noiseBuffer('pink'); noiseBuffer('brown');
    ensureMusicGraph();
  }

  function unlock() {
    return safe(function () {
      if (!supported()) return;
      if (!ctx) createGraph();
      if (!ctx) return;
      var kickMusic = function () {
        if (ctx.state === 'running' && musicWanted && !musicOn) musicStart(musicWanted);
      };
      if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume().then(function () {
          unlocked = ctx.state === 'running';
          kickMusic();
        }).catch(function () {});
      }
      unlocked = ctx.state === 'running' || ctx.state === 'suspended';
      if (ctx.state === 'running') unlocked = true;
      kickMusic();
    });
  }

  function attachUnlock() {
    if (attaching) return;
    attaching = true;
    var target = root.document || root;
    if (!target || !target.addEventListener) return;
    var evs = ['pointerdown', 'keydown'];
    var once = function () {
      unlock();
      for (var i = 0; i < evs.length; i++) target.removeEventListener(evs[i], once, true);
    };
    for (var i = 0; i < evs.length; i++) target.addEventListener(evs[i], once, true);
  }
  safe(attachUnlock);
  safe(attachMusicVis);
  safe(startRafWatch);

  // Frame-time watch: EMA of rAF deltas, ignoring hidden tabs and tab-switch gaps.
  // Thresholds are relative to a measured vsync baseline so 50/60/75/144 Hz all recover after a hitch.
  function medianOf(a) {
    var b = a.slice(), n = b.length, m;
    b.sort(function (x, y) { return x - y; });
    m = n >> 1;
    return n % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function sampleBaseline(dt) {
    var hi = haveBase ? Math.min(24, baseline * 1.4 + 4) : 24;
    if (dt < 5.5 || dt > hi) return;
    if (baseSamples.length >= BASE_CAP) baseSamples.shift();
    baseSamples.push(dt);
    if (baseSamples.length >= BASE_NEED) {
      baseline = clamp(medianOf(baseSamples), BASE_MIN, BASE_MAX);
      haveBase = true;
    }
  }
  function adoptFallback(ts) {
    if (haveBase || fallbackSamples.length < 8) return;
    if (visFrames < 60 && visMs < 2000) return;
    var med = medianOf(fallbackSamples);
    baseline = clamp(med, BASE_MIN, BASE_MAX);
    haveBase = true;
    // Clamped baseline is 21 ms on a 28–40 ms device. Steady 28 ms stays out of cheap mode
    // (~36 Hz, playable). A truly slow steady 33–40 ms device enters cheap and stays there
    // until frames actually get faster, so it does not flap.
    if (med >= 32) {
      lagging = true;
      goodStreak = 0;
      lagUntil = (ts || 0) + 500;
      musicApplyCheap();
      smelterApplyCheap();
    }
  }
  function startRafWatch() {
    if (rafOn || !root.requestAnimationFrame) return;
    rafOn = true;
    var raf = root.requestAnimationFrame;
    var loop = function (ts) {
      try { raf(loop); } catch (e) { rafOn = false; return; }
      frameGen++;
      var hidden = false;
      try { hidden = !!(root.document && root.document.hidden); } catch (e2) { /* ignore */ }
      if (hidden || !lastRaf) { lastRaf = ts; return; }
      var dt = ts - lastRaf;
      lastRaf = ts;
      if (dt < 4 || dt > 250) return; // first tick after a tab hide/show, or nonsense
      emaMs += 0.22 * (dt - emaMs);
      sampleBaseline(dt);
      if (!haveBase) {
        if (dt >= 5.5) {
          if (fallbackSamples.length >= 90) fallbackSamples.shift();
          fallbackSamples.push(dt);
          visFrames++;
          visMs += dt;
          adoptFallback(ts);
        }
        if (!haveBase) return; // don't judge lag until we know the refresh rate
      }
      var longLim = Math.max(33, baseline * 2.5);
      var goodLim = baseline * 1.25 + 3;
      var emaExit = baseline * 1.25 + 2;
      var emaEnter = baseline * 1.6 + 4;
      if (dt > longLim) longStreak++; else longStreak = 0;
      if (dt < goodLim && emaMs < emaExit) goodStreak++; else goodStreak = 0;
      var now = ts;
      if (!lagging && (emaMs > emaEnter || longStreak >= 3)) {
        lagging = true; goodStreak = 0; lagUntil = now + 500;
        musicApplyCheap(); smelterApplyCheap();
      } else if (lagging && now > lagUntil && goodStreak >= 24 && emaMs < emaExit) {
        lagging = false;
        musicApplyCheap(); smelterApplyCheap();
      }
    };
    raf(loop);
  }

  function bucketRate() { return (lagging || load > 50) ? 12 : (load > 25 ? 18 : 28); }
  function bucketBurst() { return (lagging || load > 50) ? 6 : (load > 25 ? 8 : 12); }
  function stressed() { return lagging || load > 50; }

  // Group plays into one animation frame (rAF) or, without rAF (tests), ~16 ms of audio clock.
  function frameId() {
    if (rafOn) return frameGen;
    return ctx ? Math.floor(ctx.currentTime * 60) : 0;
  }

  // ---------- voice graph + throttling ----------
  function parsePan(opts) {
    if (!opts) return 0;
    if (opts.board === 'L' || opts.board === 'R') {
      var bx = opts.board === 'R' ? 410 : 20;
      var cellX = opts.x != null && isFinite(+opts.x) ? +opts.x : 5.5;
      return clamp(((bx + cellX * 30) / 760) * 2 - 1, -1, 1);
    }
    if (opts.x == null) return 0;
    var x = +opts.x;
    if (!isFinite(x)) return 0;
    if (x > 1 || x < -1) return clamp((x / 760) * 2 - 1, -1, 1);
    return clamp(x, -1, 1);
  }

  function voiceBus(t0, panX) {
    var bus = ctx.createGain();
    bus.gain.value = 1;
    var tail = bus;
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(panX || 0, -1, 1), t0);
      bus.connect(p);
      p.connect(master);
    } else if (ctx.createPanner) {
      var pn = ctx.createPanner();
      pn.panningModel = 'equalpower';
      var pan = clamp(panX || 0, -1, 1);
      if (pn.positionX) { pn.positionX.setValueAtTime(pan, t0); pn.positionY.setValueAtTime(0, t0); pn.positionZ.setValueAtTime(0.5, t0); }
      else if (pn.setPosition) pn.setPosition(pan, 0, 0.5);
      bus.connect(pn);
      pn.connect(master);
    } else {
      bus.connect(master);
    }
    var sources = [];
    var stopped = false;
    return {
      dest: bus,
      add: function (n) { sources.push(n); },
      stop: function () {
        if (stopped) return;
        stopped = true;
        try {
          bus.gain.cancelScheduledValues(ctx.currentTime);
          bus.gain.setValueAtTime(0, ctx.currentTime);
        } catch (e) { /* ignore */ }
        for (var i = 0; i < sources.length; i++) {
          try { if (sources[i].stop) sources[i].stop(); } catch (e1) { /* already stopped */ }
          try { if (sources[i].disconnect) sources[i].disconnect(); } catch (e2) { /* ignore */ }
        }
        try { bus.disconnect(); } catch (e3) { /* ignore */ }
      }
    };
  }

  function release(rec) {
    var i = active.indexOf(rec);
    if (i < 0) return;
    active.splice(i, 1);
    counts[rec.name] = Math.max(0, (counts[rec.name] || 1) - 1);
    if (rec.timer) { try { clearTimeout(rec.timer); } catch (e) { /* ignore */ } rec.timer = 0; }
    try { rec.stop(); } catch (e) { /* ignore */ }
  }

  function steal(belowPrio) {
    var best = -1, bestP = 1e9, bestT = 1e9;
    for (var i = 0; i < active.length; i++) {
      var v = active[i];
      if (v.prio >= belowPrio) continue;
      if (v.prio < bestP || (v.prio === bestP && v.start < bestT)) {
        best = i; bestP = v.prio; bestT = v.start;
      }
    }
    if (best < 0) return false;
    release(active[best]);
    return true;
  }

  function gate(name, meta, prio) {
    var t = ctx.currentTime;
    var minI = meta.minInterval || 0.04;
    if ((lastAt[name] || -99) + minI > t) return false;
    var maxV = meta.maxVoices || 6;
    if ((counts[name] || 0) >= maxV) {
      // steal the oldest voice of this same sound
      var oldest = -1, ot = 1e9;
      for (var i = 0; i < active.length; i++) {
        if (active[i].name === name && active[i].start < ot) { oldest = i; ot = active[i].start; }
      }
      if (oldest >= 0 && (prio >= 7 || active[oldest].prio <= prio)) release(active[oldest]);
      if ((counts[name] || 0) >= maxV) return false;
    }
    if (active.length >= GLOBAL_CAP) {
      if (!steal(prio >= 7 ? prio : prio)) return false;
    }
    lastAt[name] = t;
    return true;
  }

  function register(name, prio, v, dur) {
    var rec = { name: name, prio: prio, start: ctx.currentTime, stop: v.stop, timer: 0 };
    active.push(rec);
    counts[name] = (counts[name] || 0) + 1;
    rec.timer = setTimeout(function () { release(rec); }, Math.ceil((dur + 0.12) * 1000));
    return rec;
  }

  // ---------- synthesis primitives ----------
  function noiseBuffer(kind) {
    kind = kind || 'white';
    if (noiseBufs[kind]) return noiseBufs[kind];
    var len = Math.floor(ctx.sampleRate * 1.6);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var i, w;
    if (kind === 'pink') {
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (i = 0; i < len; i++) {
        w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (kind === 'brown') {
      var last = 0;
      for (i = 0; i < len; i++) {
        w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    noiseBufs[kind] = buf;
    return buf;
  }

  function startNoise(v, kind, t0, dur, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(kind);
    s.loop = true;
    s.connect(dest);
    s.start(t0);
    s.stop(t0 + dur);
    v.add(s);
    return s;
  }

  function startOsc(v, type, freq, dest, t0, dur) {
    var o = ctx.createOscillator();
    o.type = type;
    if (typeof freq === 'number') o.frequency.setValueAtTime(Math.max(20, freq), t0);
    o.connect(dest);
    o.start(t0);
    o.stop(t0 + dur);
    v.add(o);
    return o;
  }

  function envGain(dest, t0, peak, a, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.max(0.002, a));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(dest);
    return g;
  }

  // Struck iron: inharmonic partials + a brief noise transient + a low body thud.
  function anvil(v, dest, t0, base, dur, gain, opts) {
    opts = opts || {};
    var n = opts.partials != null ? opts.partials : (cheapMode ? 3 : 6);
    var noiseAmt = opts.noise != null ? opts.noise : (cheapMode ? 0 : 0.28);
    if (noiseAmt > 0) {
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 2.4;
      bp.Q.value = 1.1;
      var ng = envGain(dest, t0, gain * noiseAmt, 0.002, 0.03);
      startNoise(v, 'white', t0, 0.04, bp);
      bp.connect(ng);
    }
    for (var i = 0; i < n; i++) {
      var f = base * METAL[i] * (1 + (Math.random() - 0.5) * 0.012);
      var g = envGain(dest, t0, gain * (1 / Math.pow(i + 1, 0.82)) * (i === 0 ? 1.05 : 1), 0.003, dur * (1 - i * 0.07));
      startOsc(v, i < 2 ? 'triangle' : 'sine', f, g, t0, dur + 0.02);
    }
    if (!opts.noThud) {
      var tg = envGain(dest, t0, gain * 0.5, 0.002, 0.11);
      var thud = startOsc(v, 'sine', base * 0.48, tg, t0, 0.13);
      thud.frequency.exponentialRampToValueAtTime(Math.max(20, base * 0.28), t0 + 0.09);
    }
  }

  // Ember crackle: one cached noise source, gain stuttered into a few sparks (not N buffers).
  function crackle(v, dest, t0, dur, gain, density) {
    var n = Math.max(2, Math.min(cheapMode ? 2 : 4, Math.floor(dur * (density || 12) / 8)));
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2800;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    for (var i = 0; i < n; i++) {
      var st = t0 + (i + Math.random() * 0.5) * (dur / n);
      var w = 0.008 + Math.random() * 0.012;
      var pk = gain * (0.35 + Math.random() * 0.55);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, pk), st + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, st + w);
    }
    startNoise(v, 'white', t0, dur + 0.03, hp);
    hp.connect(g);
    g.connect(dest);
  }

  function sizzle(v, dest, t0, dur, gain, freq) {
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq || 5200, t0);
    bp.frequency.exponentialRampToValueAtTime((freq || 5200) * 0.55, t0 + dur);
    bp.Q.value = 0.9;
    var g = envGain(dest, t0, gain, 0.012, dur);
    startNoise(v, 'white', t0, dur + 0.02, bp);
    bp.connect(g);
  }

  function whoosh(v, dest, t0, dur, gain, fromF, toF, kind) {
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.35;
    bp.frequency.setValueAtTime(Math.max(40, fromF), t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, toF), t0 + dur * 0.42);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, fromF * 0.75), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + dur * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    startNoise(v, kind || 'pink', t0, dur + 0.02, bp);
    bp.connect(g);
    g.connect(dest);
  }

  function hiss(v, dest, t0, dur, gain) {
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1800, t0);
    hp.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.45), t0 + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    startNoise(v, 'pink', t0, dur + 0.02, hp);
    hp.connect(g);
    g.connect(dest);
  }

  function roar(v, dest, t0, dur, gain) {
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(280, t0);
    lp.frequency.linearRampToValueAtTime(520, t0 + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(220, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + dur * 0.28);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.7), t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    startNoise(v, 'brown', t0, dur + 0.02, lp);
    lp.connect(g);
    g.connect(dest);
    // fire flicker
    crackle(v, dest, t0 + dur * 0.15, dur * 0.7, gain * 0.22, 18);
  }

  function horn(v, dest, t0, freq, dur, gain) {
    for (var i = 0; i < 2; i++) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq * 5.5, t0);
      f.frequency.linearRampToValueAtTime(freq * 2.4, t0 + dur);
      var g = envGain(dest, t0, gain * (i ? 0.22 : 0.6), 0.035, dur);
      var o = startOsc(v, i ? 'square' : 'sawtooth', freq * (i ? 2 : 1), f, t0, dur + 0.02);
      o.frequency.setValueAtTime(freq * (i ? 2 : 1), t0);
      f.connect(g);
    }
  }

  function boomBody(v, dest, t0, freq, dur, gain) {
    var g = envGain(dest, t0, gain, 0.004, dur);
    var o = startOsc(v, 'sine', freq, g, t0, dur + 0.02);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.45), t0 + dur * 0.7);
    var g2 = envGain(dest, t0, gain * 0.45, 0.003, dur * 0.55);
    startOsc(v, 'triangle', freq * 1.7, g2, t0, dur * 0.55);
  }

  // ---------- sound recipes ----------
  // Each recipe returns duration (seconds). `p` is pitch, `vol` is a gain multiplier.

  function shotArrow(v, dest, t0, p, vol) {
    var click = envGain(dest, t0, 0.28 * vol, 0.001, 0.018);
    startNoise(v, 'white', t0, 0.025, click);
    var tw = envGain(dest, t0, 0.42 * vol, 0.003, 0.11);
    var o = startOsc(v, 'triangle', 980 * p, tw, t0, 0.13);
    o.frequency.exponentialRampToValueAtTime(620 * p, t0 + 0.1);
    var ping = envGain(dest, t0, 0.22 * vol, 0.002, 0.07);
    startOsc(v, 'sine', 2480 * p, ping, t0, 0.08);
    return 0.16;
  }

  function shotCannon(v, dest, t0, p, vol) {
    boomBody(v, dest, t0, 92 * p, 0.32, 0.7 * vol);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400 * p, t0);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.18);
    var ng = envGain(dest, t0, 0.5 * vol, 0.004, 0.2);
    startNoise(v, 'pink', t0, 0.22, lp);
    lp.connect(ng);
    if (!cheapMode) anvil(v, dest, t0 + 0.02, 220 * p, 0.22, 0.22 * vol, { partials: 3, noise: 0.15, noThud: true });
    return 0.38;
  }

  function shotFrost(v, dest, t0, p, vol) {
    if (!cheapMode) hiss(v, dest, t0, 0.16, 0.32 * vol);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(2400 * p, t0);
    bp.frequency.exponentialRampToValueAtTime(700 * p, t0 + 0.16);
    var wg = envGain(dest, t0, 0.28 * vol, 0.01, 0.18);
    startNoise(v, 'pink', t0, 0.2, bp);
    bp.connect(wg);
    var g1 = envGain(dest, t0, 0.2 * vol, 0.006, 0.22);
    startOsc(v, 'sine', 1760 * p, g1, t0, 0.24);
    if (!cheapMode) {
      var g2 = envGain(dest, t0, 0.14 * vol, 0.006, 0.2);
      startOsc(v, 'sine', 2640 * p, g2, t0, 0.22);
    }
    return 0.26;
  }

  function hitTick(v, dest, t0, p, vol) {
    var g = envGain(dest, t0, 0.2 * vol, 0.002, 0.045);
    var o = startOsc(v, 'triangle', 1680 * p, g, t0, 0.05);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, 880 * p), t0 + 0.04);
    return 0.06;
  }

  function killClank(v, dest, t0, p, vol, kind) {
    var heavy = kind === 'boss' || kind === 'brute' || kind === 'splitter';
    var tiny = kind === 'swarm';
    var base = (tiny ? 980 : kind === 'runner' ? 720 : kind === 'boss' ? 140 : kind === 'brute' ? 210 : kind === 'splitter' ? 195 : 420) * p;
    var dur = tiny ? 0.14 : heavy ? (kind === 'boss' ? 0.7 : kind === 'splitter' ? 0.4 : 0.42) : 0.28;
    var g = (tiny ? 0.28 : heavy ? 0.55 : 0.38) * vol;
    var parts = cheapMode ? (heavy ? 4 : 3) : (tiny ? 4 : heavy ? 8 : 6);
    anvil(v, dest, t0, base, dur, g, { partials: parts, noise: cheapMode ? 0 : (heavy ? 0.4 : 0.25), noThud: tiny || cheapMode });
    if (!cheapMode || heavy) crackle(v, dest, t0 + 0.01, dur * 0.7, g * (heavy ? 0.45 : 0.32), tiny ? 16 : heavy ? 14 : 16);
    if (!cheapMode) sizzle(v, dest, t0, dur * 0.65, g * (heavy ? 0.28 : 0.18), tiny ? 7000 : 4800);
    if (kind === 'boss') {
      boomBody(v, dest, t0, 70 * p, 0.45, 0.45 * vol);
      sizzle(v, dest, t0 + 0.05, 0.5, 0.22 * vol, 3200);
    } else if (kind === 'splitter') {
      crackle(v, dest, t0 + 0.02, 0.22, g * 0.4, 18);
      sizzle(v, dest, t0 + 0.03, 0.3, g * 0.26, 3400);
    }
    return dur + 0.06;
  }

  function killShard(v, dest, t0, p, vol) {
    var g = envGain(dest, t0, 0.15 * vol, 0.001, 0.05);
    var o = startOsc(v, 'sine', 2200 * p, g, t0, 0.06);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, 1400 * p), t0 + 0.05);
    if (!cheapMode) {
      var g2 = envGain(dest, t0, 0.07 * vol, 0.001, 0.04);
      startOsc(v, 'triangle', 3300 * p, g2, t0, 0.05);
    }
    return 0.07;
  }

  function splitBurst(v, dest, t0, p, vol, opts) {
    var n = 3;
    if (opts && isFinite(+opts.n)) n = Math.max(1, Math.min(4, Math.round(+opts.n)));
    if (cheapMode) n = Math.min(n, 2);
    anvil(v, dest, t0, 240 * p, 0.32, 0.5 * vol, { partials: cheapMode ? 3 : 6, noise: 0.35 });
    crackle(v, dest, t0, 0.22, 0.32 * vol, 18);
    sizzle(v, dest, t0 + 0.04, 0.3, 0.2 * vol, 4200);
    for (var i = 0; i < n; i++) {
      var t = t0 + 0.025 + i * 0.035 + Math.random() * 0.015;
      var f = (1650 + i * 280 + Math.random() * 180) * p;
      var tg = envGain(dest, t, 0.16 * vol, 0.002, 0.07);
      var to = startOsc(v, 'sine', f, tg, t, 0.08);
      to.frequency.exponentialRampToValueAtTime(Math.max(20, f * 0.7), t + 0.06);
      if (!cheapMode) {
        var tg2 = envGain(dest, t, 0.07 * vol, 0.002, 0.05);
        startOsc(v, 'triangle', f * 1.68, tg2, t, 0.06);
      }
    }
    return 0.42 + n * 0.02;
  }

  function leakSting(v, dest, t0, p, vol) {
    boomBody(v, dest, t0, 110 * p, 0.28, 0.5 * vol);
    anvil(v, dest, t0, 240 * p, 0.45, 0.4 * vol, { partials: 6, noise: 0.3 });
    var g = envGain(dest, t0 + 0.05, 0.28 * vol, 0.01, 0.4);
    var o = startOsc(v, 'triangle', 420 * p, g, t0 + 0.05, 0.42);
    o.frequency.exponentialRampToValueAtTime(140 * p, t0 + 0.42);
    return 0.55;
  }

  function lifeLoss(v, dest, t0, p, vol) {
    boomBody(v, dest, t0, 80 * p, 0.4, 0.6 * vol);
    anvil(v, dest, t0, 180 * p, 0.6, 0.48 * vol, { partials: 7, noise: 0.35 });
    var g = envGain(dest, t0 + 0.04, 0.32 * vol, 0.02, 0.5);
    var o = startOsc(v, 'sawtooth', 330 * p, g, t0 + 0.04, 0.52);
    o.frequency.exponentialRampToValueAtTime(90 * p, t0 + 0.5);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    o.disconnect(); o.connect(lp); lp.connect(g);
    return 0.7;
  }

  function bellows(v, dest, t0, p, vol, kind) {
    var dur = kind === 'brute' ? 0.5 : kind === 'splitter' ? 0.46 : kind === 'swarm' ? 0.36 : 0.4;
    var from = (kind === 'brute' ? 160 : kind === 'splitter' ? 200 : kind === 'runner' ? 380 : 240) * p;
    var to = (kind === 'brute' ? 700 : kind === 'splitter' ? 1050 : kind === 'runner' ? 2100 : kind === 'swarm' ? 1800 : 1300) * p;
    whoosh(v, dest, t0, dur, 0.42 * vol, from, to, 'pink');
    // leather pump thump
    boomBody(v, dest, t0, (kind === 'brute' ? 70 : kind === 'splitter' ? 85 : 100) * p, 0.12, 0.22 * vol);
    if (kind === 'swarm') {
      whoosh(v, dest, t0 + 0.07, 0.22, 0.22 * vol, 500 * p, 2000 * p, 'pink');
      whoosh(v, dest, t0 + 0.14, 0.2, 0.16 * vol, 600 * p, 1700 * p, 'white');
    } else if (kind === 'splitter') {
      anvil(v, dest, t0 + 0.06, 340 * p, 0.18, 0.2 * vol, { partials: cheapMode ? 2 : 4, noise: 0.22, noThud: true });
    }
    return dur + 0.04;
  }

  function placeClink(v, dest, t0, p, vol) {
    boomBody(v, dest, t0, 140 * p, 0.1, 0.28 * vol);
    anvil(v, dest, t0, 520 * p, 0.32, 0.42 * vol, { partials: 6, noise: 0.3 });
    return 0.36;
  }

  function upgradeChime(v, dest, t0, p, vol) {
    var notes = [392, 494, 659]; // G4 B4 E5 — rising anvil-strike chime
    for (var i = 0; i < notes.length; i++) {
      anvil(v, dest, t0 + i * 0.13, notes[i] * p, 0.28 + i * 0.1, (0.32 + i * 0.08) * vol, { partials: 6, noise: 0.18, noThud: i > 0 });
    }
    return 0.7;
  }

  function sellPack(v, dest, t0, p, vol) {
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(900 * p, t0);
    bp.frequency.exponentialRampToValueAtTime(280 * p, t0 + 0.16);
    var g = envGain(dest, t0, 0.28 * vol, 0.01, 0.18);
    startNoise(v, 'pink', t0, 0.2, bp);
    bp.connect(g);
    anvil(v, dest, t0 + 0.1, 880 * p, 0.14, 0.2 * vol, { partials: 4, noise: 0.15, noThud: true });
    anvil(v, dest, t0 + 0.18, 1180 * p, 0.16, 0.18 * vol, { partials: 4, noise: 0.12, noThud: true });
    return 0.42;
  }

  function sendUpgrade(v, dest, t0, p, vol) {
    whoosh(v, dest, t0, 0.22, 0.22 * vol, 300 * p, 1400 * p, 'pink');
    upgradeChime(v, dest, t0 + 0.04, p, vol * 0.9);
    return 0.74;
  }

  function waveCall(v, dest, t0, p, vol, boss) {
    var hits = boss ? [0, 0.16, 0.32] : [0, 0.18];
    var base = (boss ? 180 : 260) * p;
    for (var i = 0; i < hits.length; i++) {
      anvil(v, dest, t0 + hits[i], base * (1 + i * 0.08), boss ? 0.4 : 0.3, (0.48 + i * 0.06) * vol, { partials: 7, noise: 0.35 });
    }
    horn(v, dest, t0 + (boss ? 0.1 : 0.08), (boss ? 175 : 262) * p, boss ? 0.85 : 0.5, (boss ? 0.42 : 0.32) * vol);
    if (boss) horn(v, dest, t0 + 0.28, 131 * p, 0.7, 0.22 * vol);
    return boss ? 1.15 : 0.75;
  }

  function suddenRoar(v, dest, t0, p, vol) {
    roar(v, dest, t0, 1.8, 0.55 * vol);
    hiss(v, dest, t0 + 0.15, 1.2, 0.18 * vol);
    var tones = [0.28, 0.52, 0.76, 1.0];
    for (var i = 0; i < tones.length; i++) {
      var f = (i % 2 === 0 ? 494 : 330) * p;
      horn(v, dest, t0 + tones[i], f, 0.16, 0.28 * vol);
      anvil(v, dest, t0 + tones[i], 200 * p, 0.22, 0.22 * vol, { partials: 5, noise: 0.2 });
    }
    return 2.0;
  }

  function finishingToll(v, dest, t0, p, vol) {
    roar(v, dest, t0, 0.8, 0.22 * vol);
    anvil(v, dest, t0, 130 * p, 1.1, 0.55 * vol, { partials: 8, noise: 0.4 });
    horn(v, dest, t0 + 0.05, 110 * p, 0.7, 0.16 * vol);
    return 1.3;
  }

  function winFanfare(v, dest, t0, p, vol) {
    // Original rising anvil fanfare (not a licensed hook): G4 B4 D5 G5 D5 G5 B5
    var notes = [392, 494, 587, 784, 587, 784, 988];
    var times = [0, 0.15, 0.3, 0.45, 0.7, 0.88, 1.12];
    var durs = [0.35, 0.35, 0.4, 0.5, 0.3, 0.4, 0.7];
    for (var i = 0; i < notes.length; i++) {
      anvil(v, dest, t0 + times[i], notes[i] * p, durs[i], (0.36 + (i > 4 ? 0.12 : i * 0.03)) * vol, { partials: 7, noise: 0.16, noThud: i !== 0 && i !== 3 && i !== 6 });
    }
    boomBody(v, dest, t0 + 1.12, 98 * p, 0.5, 0.28 * vol);
    return 2.0;
  }

  function loseJingle(v, dest, t0, p, vol) {
    hiss(v, dest, t0, 1.7, 0.38 * vol);
    whoosh(v, dest, t0, 0.5, 0.18 * vol, 2000 * p, 300 * p, 'pink');
    var notes = [330, 262, 196];
    var times = [0.18, 0.5, 0.9];
    for (var i = 0; i < notes.length; i++) {
      anvil(v, dest, t0 + times[i], notes[i] * p, 0.45 + i * 0.2, (0.38 - i * 0.04) * vol, { partials: 6, noise: 0.22 });
    }
    boomBody(v, dest, t0 + 0.9, 70 * p, 0.6, 0.28 * vol);
    return 2.0;
  }

  function drawJingle(v, dest, t0, p, vol) {
    hiss(v, dest, t0, 0.7, 0.2 * vol);
    anvil(v, dest, t0, 330 * p, 0.4, 0.36 * vol, { partials: 6, noise: 0.22 });
    anvil(v, dest, t0 + 0.28, 294 * p, 0.55, 0.34 * vol, { partials: 6, noise: 0.2 });
    return 0.95;
  }

  function incomeChime(v, dest, t0, p, vol) {
    anvil(v, dest, t0, 1046 * p, 0.12, 0.12 * vol, { partials: 4, noise: 0.08, noThud: true });
    anvil(v, dest, t0 + 0.07, 1318 * p, 0.16, 0.1 * vol, { partials: 4, noise: 0.06, noThud: true });
    return 0.28;
  }

  function uiClick(v, dest, t0, p, vol) {
    anvil(v, dest, t0, 1400 * p, 0.05, 0.2 * vol, { partials: 3, noise: 0.15, noThud: true });
    return 0.07;
  }

  function uiHover(v, dest, t0, p, vol) {
    var g = envGain(dest, t0, 0.08 * vol, 0.002, 0.04);
    startOsc(v, 'sine', 2100 * p, g, t0, 0.05);
    return 0.06;
  }

  function uiError(v, dest, t0, p, vol) {
    for (var i = 0; i < 2; i++) {
      var t = t0 + i * 0.1;
      var g = envGain(dest, t, 0.32 * vol, 0.004, 0.09);
      startOsc(v, 'sawtooth', (180 - i * 28) * p, g, t, 0.1);
      startOsc(v, 'square', (190 - i * 26) * p, g, t, 0.1);
    }
    return 0.24;
  }

  var SOUNDS = {
    shot_arrow: shotArrow,
    shot_cannon: shotCannon,
    shot_frost: shotFrost,
    boom: shotCannon,
    chill: shotFrost,
    hit: hitTick,
    kill: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'neutral'); },
    kill_neutral: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'neutral'); },
    kill_runner: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'runner'); },
    kill_swarm: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'swarm'); },
    kill_brute: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'brute'); },
    kill_splitter: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'splitter'); },
    kill_shard: killShard,
    kill_boss: function (v, d, t, p, vol) { return killClank(v, d, t, p, vol, 'boss'); },
    split: splitBurst,
    shot_smelter: function () { return 0; },
    leak: leakSting,
    life_loss: lifeLoss,
    send: function (v, d, t, p, vol) { return bellows(v, d, t, p, vol, 'runner'); },
    send_runner: function (v, d, t, p, vol) { return bellows(v, d, t, p, vol, 'runner'); },
    send_brute: function (v, d, t, p, vol) { return bellows(v, d, t, p, vol, 'brute'); },
    send_swarm: function (v, d, t, p, vol) { return bellows(v, d, t, p, vol, 'swarm'); },
    send_splitter: function (v, d, t, p, vol) { return bellows(v, d, t, p, vol, 'splitter'); },
    sendup: sendUpgrade,
    place: placeClink,
    upgrade: upgradeChime,
    sell: sellPack,
    wave: function (v, d, t, p, vol) { return waveCall(v, d, t, p, vol, false); },
    wave_boss: function (v, d, t, p, vol) { return waveCall(v, d, t, p, vol, true); },
    sudden: suddenRoar,
    finishing: finishingToll,
    income: incomeChime,
    win: winFanfare,
    lose: loseJingle,
    draw: drawJingle,
    ui_click: uiClick,
    ui_hover: uiHover,
    ui_error: uiError
  };

  var ALIAS = {
    pop: 'kill',
    shot: 'shot_arrow',
    wave_start: 'wave',
    sudden_death: 'sudden',
    life: 'life_loss',
    lives: 'life_loss',
    buzz: 'ui_error',
    ui_buzz: 'ui_error',
    error: 'ui_error',
    gold: 'ui_error',
    build: 'place',
    tower_place: 'place',
    click: 'ui_click',
    hover: 'ui_hover',
    fanfare: 'win',
    send_up: 'sendup',
    send_upgrade: 'sendup'
  };

  var META = {
    shot_arrow:   { minInterval: 0.040, maxVoices: 6, prio: 2, vary: 0.07 },
    shot_cannon:  { minInterval: 0.080, maxVoices: 4, prio: 3, vary: 0.05 },
    shot_frost:   { minInterval: 0.055, maxVoices: 5, prio: 2, vary: 0.06 },
    boom:         { minInterval: 0.080, maxVoices: 4, prio: 3, vary: 0.05 },
    chill:        { minInterval: 0.080, maxVoices: 4, prio: 2, vary: 0.06 },
    hit:          { minInterval: 0.028, maxVoices: 8, prio: 1, vary: 0.10 },
    kill:         { minInterval: 0.022, maxVoices: 8, prio: 4, vary: 0.10 },
    kill_neutral: { minInterval: 0.022, maxVoices: 8, prio: 4, vary: 0.10 },
    kill_runner:  { minInterval: 0.022, maxVoices: 6, prio: 4, vary: 0.10 },
    kill_swarm:   { minInterval: 0.016, maxVoices: 10, prio: 3, vary: 0.12 },
    kill_brute:    { minInterval: 0.040, maxVoices: 5, prio: 5, vary: 0.07 },
    kill_splitter: { minInterval: 0.040, maxVoices: 5, prio: 5, vary: 0.07 },
    kill_shard:    { minInterval: 0.055, maxVoices: 3, prio: 2, vary: 0.14 },
    kill_boss:     { minInterval: 0.100, maxVoices: 3, prio: 7, vary: 0.04 },
    split:         { minInterval: 0.060, maxVoices: 4, prio: 5, vary: 0.05 },
    shot_smelter:  { minInterval: 0, maxVoices: 1, prio: 3, vary: 0 },
    leak:         { minInterval: 0.060, maxVoices: 4, prio: 9, vary: 0.03 },
    life_loss:    { minInterval: 0.080, maxVoices: 3, prio: 9, vary: 0.03 },
    send:         { minInterval: 0.080, maxVoices: 4, prio: 5, vary: 0.06 },
    send_runner:  { minInterval: 0.080, maxVoices: 4, prio: 5, vary: 0.06 },
    send_brute:   { minInterval: 0.100, maxVoices: 3, prio: 5, vary: 0.05 },
    send_swarm:    { minInterval: 0.080, maxVoices: 4, prio: 5, vary: 0.08 },
    send_splitter: { minInterval: 0.090, maxVoices: 3, prio: 5, vary: 0.06 },
    sendup:       { minInterval: 0.120, maxVoices: 3, prio: 6, vary: 0.03 },
    place:        { minInterval: 0.060, maxVoices: 4, prio: 6, vary: 0.04 },
    upgrade:      { minInterval: 0.100, maxVoices: 3, prio: 6, vary: 0.02 },
    sell:         { minInterval: 0.080, maxVoices: 3, prio: 6, vary: 0.04 },
    wave:         { minInterval: 0.400, maxVoices: 2, prio: 8, vary: 0.01 },
    wave_boss:    { minInterval: 0.400, maxVoices: 2, prio: 8, vary: 0.01 },
    sudden:       { minInterval: 0.800, maxVoices: 1, prio: 10, vary: 0 },
    finishing:    { minInterval: 0.800, maxVoices: 1, prio: 9, vary: 0 },
    income:       { minInterval: 0.400, maxVoices: 2, prio: 3, vary: 0.04 },
    win:          { minInterval: 1.000, maxVoices: 1, prio: 10, vary: 0 },
    lose:         { minInterval: 1.000, maxVoices: 1, prio: 10, vary: 0 },
    draw:         { minInterval: 1.000, maxVoices: 1, prio: 10, vary: 0 },
    ui_click:     { minInterval: 0.030, maxVoices: 3, prio: 4, vary: 0.05 },
    ui_hover:     { minInterval: 0.040, maxVoices: 2, prio: 1, vary: 0.08 },
    ui_error:     { minInterval: 0.120, maxVoices: 2, prio: 6, vary: 0.02 }
  };

  function resolveName(name, opts) {
    name = ALIAS[name] || name;
    if (name === 'kill' && opts && opts.kind) {
      var kk = 'kill_' + opts.kind;
      if (SOUNDS[kk]) return kk;
    }
    if (name === 'send' && opts && opts.kind) {
      var sk = 'send_' + opts.kind;
      if (SOUNDS[sk]) return sk;
    }
    if (name === 'wave' && opts && opts.boss) return 'wave_boss';
    if (name === 'shot' && opts && opts.tt && SOUNDS['shot_' + opts.tt]) return 'shot_' + opts.tt;
    return name;
  }


  // Procedural forge BGM: 108 BPM workshop groove, lookahead scheduler (~25/100 ms).
  var BASS_PAT = [43,0,43,50,0,43,41,38,43,0,41,38,43,0,50,0];
  var TUNE_A = [67,69,71,74,71,69,67,62,67,69,71,69,67,0,62,0];
  var TUNE_B = [67,71,74,76,74,71,69,67,64,67,69,71,67,0,62,64];
  function midiHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function musicCheap() { return stressed(); }
  function musicBpm() {
    var b = musicScene === 'lobby' ? 96 : 108;
    if (musicLevel >= 1) b *= 1.12;
    if (musicLevel >= 2) b *= 1.05;
    return b;
  }
  function stepDur() { return 30 / musicBpm(); }
  function musicAudible() { return (muted || musicMuted) ? 0 : musicVolume; }
  function applyMusicGain() {
    if (musicGain && ctx) try { musicGain.gain.setTargetAtTime(musicAudible(), ctx.currentTime, 0.03); } catch (e) {}
  }
  function musicStats() {
    return {
      playing: !!musicOn, fading: !!musicFading, scene: musicOn ? musicScene : null,
      level: musicLevel, bpm: +musicBpm().toFixed(2), cheap: !!musicCheap(),
      layers: !musicOn ? 'off' : (musicScene === 'lobby' ? 'lobby' : (musicCheap() ? 'min' : 'full')),
      live: musicLive, peak: musicPeak, volume: musicVolume, muted: !!musicMuted
    };
  }
  function isHidden() { try { return !!(root.document && root.document.hidden); } catch (e) { return false; } }
  function attachMusicVis() {
    var d = root.document;
    if (!d || !d.addEventListener) return;
    d.addEventListener('visibilitychange', function () {
      safe(function () {
        if (isHidden()) {
          musicHidden = true;
          if (musicTimer) { cancelLater(musicTimer); musicTimer = 0; }
        } else {
          musicHidden = false;
          if (musicOn && ctx) { musicNext = ctx.currentTime + 0.05; musicPump(); }
        }
      });
    });
  }
  function ensureMusicGraph() {
    if (!ctx || musicGain) return;
    fadeGain = ctx.createGain(); fadeGain.gain.value = 0;
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    musicGain = ctx.createGain(); musicGain.gain.value = musicAudible();
    fadeGain.connect(duckGain); duckGain.connect(musicGain); musicGain.connect(limiter);
  }
  function trackLive(n, tEnd) {
    musicLive += n;
    if (musicLive > musicPeak) musicPeak = musicLive;
    later(function () { musicLive = Math.max(0, musicLive - n); }, Math.max(0, (tEnd - (ctx ? ctx.currentTime : 0)) * 1000 + 8));
  }
  function mOsc(type, freq, dest, t0, dur, peak, endHz) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (endHz) try { o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(endHz, t0 + dur * 0.85); } catch (e) {}
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.01);
    trackLive(1, t0 + dur + 0.02);
  }
  function ensurePad() {
    if (pad || !ctx || !fadeGain) return;
    var g = ctx.createGain(); g.gain.value = 0; g.connect(fadeGain);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280; lp.Q.value = 0.5; lp.connect(g);
    var o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = midiHz(43);
    var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = midiHz(50);
    var g1 = ctx.createGain(); g1.gain.value = 0.45;
    var g2 = ctx.createGain(); g2.gain.value = 0.3;
    o1.connect(g1); g1.connect(lp); o2.connect(g2); g2.connect(lp);
    var ns = ctx.createBufferSource(); ns.buffer = noiseBuffer('brown'); ns.loop = true;
    var ng = ctx.createGain(); ng.gain.value = 0.16;
    var nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 200;
    ns.connect(ng); ng.connect(nlp); nlp.connect(g);
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
    var lg = ctx.createGain(); lg.gain.value = 36;
    lfo.connect(lg); lg.connect(lp.frequency);
    var t = ctx.currentTime;
    o1.start(t); o2.start(t); ns.start(t); lfo.start(t);
    musicLive += 4; if (musicLive > musicPeak) musicPeak = musicLive;
    pad = { g: g, o1: o1, o2: o2, ns: ns, lfo: lfo };
    musicApplyCheap();
  }
  function stopPad() {
    if (!pad) return;
    try { pad.o1.stop(); } catch (e1) {}
    try { pad.o2.stop(); } catch (e2) {}
    try { pad.ns.stop(); } catch (e3) {}
    try { pad.lfo.stop(); } catch (e4) {}
    try { pad.g.disconnect(); } catch (e5) {}
    pad = null; musicLive = Math.max(0, musicLive - 4);
  }
  function padLevel() { return (!musicOn || musicCheap()) ? 0 : (musicScene === 'lobby' ? 0.07 : 0.11); }
  function musicApplyCheap() {
    if (pad && ctx) try { pad.g.gain.setTargetAtTime(padLevel(), ctx.currentTime, 0.08); } catch (e) {}
  }
  function pingAnvil(t0, amt) {
    var n = musicCheap() ? 1 : 2, f0 = 820 * (0.85 + 0.3 * amt);
    for (var i = 0; i < n; i++) mOsc('triangle', f0 * METAL[i] * (0.985 + Math.random() * 0.03), fadeGain, t0, 0.09 + i * 0.04, 0.11 * amt / n);
  }
  function pingBass(t0, n) { var f = midiHz(n); mOsc('triangle', f, fadeGain, t0, 0.18, 0.15, f * 0.5); }
  function pingTune(t0, n) { mOsc('triangle', midiHz(n), fadeGain, t0, 0.16, 0.05); }
  function pingAlarm(t0) { mOsc('square', 640, fadeGain, t0, 0.055, 0.028, 520); }
  function darken(n) {
    if (musicLevel < 1) return n;
    var pc = n % 12;
    return (pc === 4 || pc === 11) ? n - 1 : n;
  }
  function musicEmit(step, t0) {
    var s = step & 15, strong = s === 0 || s === 8, mid = s === 4 || s === 12, beat = !(s & 1);
    if (musicScene === 'lobby') { if (strong) pingAnvil(t0, 0.42); return; }
    if (musicLevel >= 1 && beat) pingAnvil(t0, strong ? 1.15 : (mid ? 0.9 : 0.65));
    else if (strong || mid) pingAnvil(t0, strong ? 1 : 0.68);
    if (BASS_PAT[s]) pingBass(t0, darken(BASS_PAT[s]));
    if (musicCheap()) return;
    var m = ((step & 16) ? TUNE_B : TUNE_A)[s];
    if (m) pingTune(t0, darken(m));
    if (musicLevel >= 1 && !beat) pingAlarm(t0);
  }
  function musicSchedule() {
    if (!ctx) return;
    var now = ctx.currentTime, ahead = now + 0.1, guard = 0;
    if (musicNext < now - 0.05) musicNext = now + 0.02;
    while (musicNext < ahead && guard++ < 16) {
      musicEmit(musicStep, musicNext);
      musicStep++;
      musicNext += stepDur();
    }
  }
  function musicPump() {
    if (musicTimer) { cancelLater(musicTimer); musicTimer = 0; }
    if (!musicOn || musicHidden || !ctx) return;
    try { musicSchedule(); } catch (e) {}
    musicTimer = later(musicPump, 25);
  }
  function musicTeardown() {
    musicOn = false; musicFading = false; musicLevel = 0;
    if (musicTimer) { cancelLater(musicTimer); musicTimer = 0; }
    stopPad();
    if (fadeGain && ctx) try { fadeGain.gain.cancelScheduledValues(ctx.currentTime); fadeGain.gain.setValueAtTime(0, ctx.currentTime); } catch (e) {}
  }
  function musicStart(scene) {
    return safe(function () {
      scene = scene === 'lobby' ? 'lobby' : 'match';
      musicWanted = scene;
      if (!unlocked || !ctx) return false;
      ensureMusicGraph();
      if (!musicGain || !fadeGain) return false;
      if (musicOn && musicScene === scene && !musicFading) return true;
      try { fadeGain.gain.cancelScheduledValues(ctx.currentTime); fadeGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05); } catch (e) {}
      musicFading = false; musicScene = scene;
      if (!musicOn) { musicLevel = 0; musicStep = 0; }
      musicOn = true; musicHidden = isHidden();
      ensurePad(); musicApplyCheap();
      if (!musicHidden) { musicNext = ctx.currentTime + 0.06; musicPump(); }
      return true;
    });
  }
  function musicStop(fade) {
    return safe(function () {
      musicWanted = null;
      if (!musicOn) return;
      var sec = (fade === false || fade === 0) ? 0 : (typeof fade === 'number' ? fade : 0.4);
      if (!ctx || !fadeGain || sec <= 0) { musicTeardown(); return; }
      musicFading = true;
      try {
        var t = ctx.currentTime, cur = fadeGain.gain.value;
        fadeGain.gain.cancelScheduledValues(t);
        fadeGain.gain.setValueAtTime(Math.max(cur, 0.001), t);
        fadeGain.gain.linearRampToValueAtTime(0.0001, t + sec);
      } catch (e) {}
      later(function () { if (musicFading) musicTeardown(); }, sec * 1000 + 40);
    });
  }
  function musicIntensify(lvl) { if (musicOn && lvl > musicLevel) musicLevel = lvl; }
  function musicDuck() {
    if (!duckGain || !ctx || !musicOn) return;
    try {
      var t = ctx.currentTime;
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(0.5, t);
      duckGain.gain.setTargetAtTime(1, t + 0.3, 0.08);
    } catch (e) {}
  }
  function musicOnCue(name) {
    if (name === 'wave' || name === 'wave_boss') {
      if (!musicOn || musicScene !== 'match') musicStart('match');
      musicDuck();
    } else if (name === 'sudden') {
      if (!musicOn || musicScene !== 'match') musicStart('match');
      musicIntensify(1); musicDuck();
    } else if (name === 'finishing') { if (musicOn) musicIntensify(2); }
    else if (name === 'win' || name === 'lose' || name === 'draw') musicStop(1.5);
    else if (name === 'leak' || name === 'life_loss') musicDuck();
  }
  function setMusicVolume(v) {
    return safe(function () { musicVolume = clamp(Number(v) || 0, 0, 1); persist(); applyMusicGain(); return musicVolume; });
  }
  function getMusicVolume() { return musicVolume; }
  function setMusicMuted(b) {
    return safe(function () { musicMuted = !!b; persist(); applyMusicGain(); return musicMuted; });
  }
  function toggleMusicMute() { return setMusicMuted(!musicMuted); }
  function isMusicMuted() { return !!musicMuted; }


  // Smelter beam hiss: one sustained voice per board, refreshed by shot_smelter, released 250 ms after the last call.
  var smelterV = Object.create(null), smelterHits = [];
  function smelterKey(opts) {
    var b = opts && opts.board;
    return (b === 'L' || b === 'R') ? b : '*';
  }
  function smelterHeat(opts) {
    var h = opts && (opts.h != null ? opts.h : (opts.heat != null ? opts.heat : opts.tier));
    h = Number(h);
    return isFinite(h) ? clamp(h, 0, 3) : 0;
  }
  function smelterCount() {
    var n = 0, k;
    for (k in smelterV) if (smelterV[k]) n++;
    return n;
  }
  function smelterStats() {
    var t = ctx ? ctx.currentTime : 0, maxH = 0, k, v, rate = 0;
    for (k in smelterV) {
      v = smelterV[k];
      if (v && v.heat > maxH) maxH = v.heat;
    }
    if (ctx) {
      while (smelterHits.length && smelterHits[0] < t - 1) smelterHits.shift();
      rate = smelterHits.length;
    }
    return { voices: smelterCount(), heat: maxH, rate: rate };
  }
  function smelterActivity() {
    var t = ctx.currentTime;
    while (smelterHits.length && smelterHits[0] < t - 1) smelterHits.shift();
    return { rate: smelterHits.length, boards: Math.max(1, smelterCount()) };
  }
  function smelterOpen(key, opts, t) {
    if (!ctx || !master) return null;
    var bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    var pan = null, tail = bus;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(parsePan(opts), t);
      bus.connect(pan); pan.connect(master);
    } else { bus.connect(master); }
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.85; bp.frequency.value = 800;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    var ns = ctx.createBufferSource();
    ns.buffer = noiseBuffer('pink'); ns.loop = true;
    var hissG = ctx.createGain(); hissG.gain.value = 0.7;
    ns.connect(bp); bp.connect(hissG); hissG.connect(bus);
    var roar = ctx.createOscillator();
    roar.type = 'sine'; roar.frequency.value = 52;
    var roarG = ctx.createGain(); roarG.gain.value = 0.45;
    roar.connect(lp); lp.connect(roarG); roarG.connect(bus);
    var hi = ctx.createBufferSource();
    hi.buffer = noiseBuffer('white'); hi.loop = true;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    var hiG = ctx.createGain(); hiG.gain.value = 0;
    hi.connect(hp); hp.connect(hiG); hiG.connect(bus);
    try { ns.start(t); roar.start(t); hi.start(t); } catch (e) {}
    var voice = { bus: bus, pan: pan, ns: ns, roar: roar, hi: hi, bp: bp, lp: lp, hiG: hiG, hissG: hissG, roarG: roarG, timer: 0, dying: false, heat: 0, panX: 0 };
    smelterV[key] = voice;
    return voice;
  }
  function smelterRetarget(voice, t) {
    if (!voice || !ctx) return;
    var cheap = stressed();
    var hn = voice.heat / 3;
    var act = smelterActivity();
    var busy = clamp(act.rate / 24, 0, 1);
    var g = (cheap ? 0.045 : 0.08) * (1 + 0.75 * hn) * (1 + 0.22 * busy + (act.boards > 1 ? 0.08 : 0));
    try {
      voice.bus.gain.setTargetAtTime(Math.max(0.0002, g), t, 0.06);
      voice.bp.frequency.setTargetAtTime(700 + hn * 1400 + busy * 200, t, 0.08);
      voice.lp.frequency.setTargetAtTime(380 + hn * 420, t, 0.08);
      voice.roar.frequency.setTargetAtTime(48 + hn * 30 + busy * 6, t, 0.1);
      voice.hiG.gain.setTargetAtTime(cheap ? 0 : (0.035 + hn * 0.055), t, 0.08);
      if (voice.pan && voice.pan.pan) voice.pan.pan.setTargetAtTime(clamp(voice.panX, -1, 1), t, 0.08);
    } catch (e) {}
  }
  function smelterApplyCheap() {
    if (!ctx) return;
    var t = ctx.currentTime, k;
    for (k in smelterV) if (smelterV[k]) smelterRetarget(smelterV[k], t);
  }
  function smelterStop(key, voice) {
    try { voice.ns.stop(); } catch (e1) {}
    try { voice.roar.stop(); } catch (e2) {}
    try { voice.hi.stop(); } catch (e3) {}
    try { voice.bus.disconnect(); } catch (e4) {}
    if (smelterV[key] === voice) delete smelterV[key];
  }
  function smelterRelease(key) {
    var voice = smelterV[key], t;
    if (!voice || !ctx) return;
    voice.dying = true;
    t = ctx.currentTime;
    try { voice.bus.gain.setTargetAtTime(0.0001, t, 0.05); } catch (e) {}
    voice.timer = later(function () {
      if (smelterV[key] !== voice || !voice.dying) return;
      smelterStop(key, voice);
    }, 120);
  }
  function smelterTouch(opts) {
    if (!ctx || !master) return;
    var t = ctx.currentTime, key = smelterKey(opts), voice = smelterV[key];
    smelterHits.push(t);
    if (smelterHits.length > 80) smelterHits.splice(0, smelterHits.length - 48);
    if (!voice) voice = smelterOpen(key, opts || {}, t);
    if (!voice) return;
    voice.dying = false;
    voice.heat = smelterHeat(opts);
    voice.panX = parsePan(opts);
    smelterRetarget(voice, t);
    if (voice.timer) cancelLater(voice.timer);
    voice.timer = later(function () { smelterRelease(key); }, 250);
  }

  function play(name, opts) {
    return safe(function () {
      opts = opts || {};
      if (!supported()) return;
      if (!ctx || !unlocked) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      if (ctx.state !== 'running' && ctx.state !== 'suspended') return;
      name = resolveName(String(name || ''), opts);
      musicOnCue(name);
      if (muted || volume <= 0) return;
      if (name === 'shot_smelter') { smelterTouch(opts); return; }
      var fn = SOUNDS[name];
      if (!fn) return;
      var meta = META[name] || { minInterval: 0.05, maxVoices: 4, prio: 3, vary: 0.05 };
      var prio = meta.prio || 3;
      var important = prio >= 7;
      var hard = stressed();
      var mild = !hard && load > 25;
      if (name === 'kill_shard' && (hard || mild)) return;
      if (name === 'hit' && hard) return;
      if (name === 'hit' && mild) { thinN++; if (thinN % 2 !== 0) return; }
      if (!important && (name.indexOf('shot_') === 0 || name.indexOf('kill') === 0)) {
        if (hard) { thinN++; if (thinN % (load > 120 ? 3 : 2) !== 0) return; }
        else if (mild) { thinN++; if (thinN % 3 === 0) return; }
      }
      if (!important) {
        var fid = frameId();
        if (fid !== lastPlayFrame) { lastPlayFrame = fid; playsThisFrame = 0; }
        if (playsThisFrame >= (hard ? 2 : 3)) return;
        playsThisFrame++;
      }
      if (!takeToken(important)) return;
      if (!gate(name, meta, prio)) return;
      // Minimal voices when the thread is late, the board is heavy, or the sound is spammy.
      cheapMode = hard || name === 'hit' || name.indexOf('shot_') === 0 || (name.indexOf('kill') === 0 && name !== 'kill_boss');
      var vary = meta.vary || 0;
      var pitch = (opts.pitch != null && isFinite(+opts.pitch) ? +opts.pitch : 1);
      if (opts.tier && isFinite(+opts.tier) && +opts.tier > 0) pitch *= 1 + Math.min(3, +opts.tier) * 0.06;
      pitch *= 1 + (Math.random() * 2 - 1) * vary;
      pitch = clamp(pitch, 0.4, 2.4);
      var vol = opts.volume != null && isFinite(+opts.volume) ? clamp(+opts.volume, 0, 2) : 1;
      var t0 = ctx.currentTime + 0.005;
      var v = voiceBus(t0, parsePan(opts));
      var dur = 0.3;
      try { dur = fn(v, v.dest, t0, pitch, vol, opts) || 0.3; } catch (err) { try { v.stop(); } catch (e2) { /* ignore */ } return; }
      register(name, prio, v, dur);
    });
  }

  function setVolume(v) {
    return safe(function () {
      volume = clamp(Number(v) || 0, 0, 1);
      persist();
      applyMaster();
      return volume;
    });
  }

  function getVolume() { return volume; }

  function setMuted(b) {
    return safe(function () {
      muted = !!b;
      persist();
      applyMaster();
      return muted;
    });
  }

  function toggleMute() { return setMuted(!muted); }
  function isMuted() { return !!muted; }
  function isUnlocked() { return !!(unlocked && ctx && ctx.state === 'running'); }
  function names() { return Object.keys(SOUNDS); }

  function setLoad(n) {
    return safe(function () {
      load = Math.max(0, Number(n) || 0);
      musicApplyCheap();
      smelterApplyCheap();
      return load;
    });
  }
  function takeToken(always) {
    var t = ctx ? ctx.currentTime : 0;
    if (tokenAt === 0) tokenAt = t;
    var rate = bucketRate(), burst = bucketBurst();
    tokens = Math.min(burst, tokens + Math.max(0, t - tokenAt) * rate);
    tokenAt = t;
    if (always) { if (tokens >= 1) tokens -= 1; return true; }
    if (tokens >= 1) { tokens -= 1; return true; }
    return false;
  }
  function stats() {
    return {
      load: load, tokens: +tokens.toFixed(2), nodes: nodeCount, rate: bucketRate(),
      emaMs: +emaMs.toFixed(1), lagging: lagging, cheap: stressed(),
      baseline: +baseline.toFixed(2), haveBase: haveBase,
      music: musicStats(),
      smelter: smelterStats()
    };
  }
  function resetStats() { nodeCount = 0; }

  var audio = {
    play: play,
    unlock: unlock,
    setVolume: setVolume,
    getVolume: getVolume,
    setMuted: setMuted,
    toggleMute: toggleMute,
    isMuted: isMuted,
    isUnlocked: isUnlocked,
    names: names,
    setLoad: setLoad,
    stats: stats,
    resetStats: resetStats,
    music: {
      start: musicStart,
      stop: musicStop,
      setVolume: setMusicVolume,
      getVolume: getMusicVolume,
      setMuted: setMusicMuted,
      toggleMute: toggleMusicMute,
      isMuted: isMusicMuted,
      isPlaying: function () { return !!musicOn; },
      stats: musicStats
    },
    startMusic: musicStart,
    stopMusic: musicStop,
    setMusicVolume: setMusicVolume,
    getMusicVolume: getMusicVolume,
    setMusicMuted: setMusicMuted,
    toggleMusicMute: toggleMusicMute,
    isMusicMuted: isMusicMuted
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = audio;
  if (typeof root !== 'undefined') {
    root.forgeAudio = audio;
    if (typeof root.audio === 'undefined') root.audio = audio;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
