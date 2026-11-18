/* Forge TD art — original forge / smithing theme.
   Procedural, cached canvas sprites. Public API stays backward-compatible with client.js. */
(function (root) {
  const A = {};
  const SS = 3;                    // supersample so thin outlines stay sharp when scaled
  const OUT = '#1a1512';           // charcoal / iron outline

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const k = (v) => Math.max(0, Math.min(255, v + Math.round(255 * amt)));
    return '#' + ((k(r) << 16) | (k(g) << 8) | k(b)).toString(16).padStart(6, '0');
  }
  A.shade = shade;

  const SPR = new Map();           // key -> {c: canvas, w, h}
  function sprite(key, w, h, draw) {
    let s = SPR.get(key);
    if (s) return s;
    const W = Math.max(1, Math.ceil(Number(w) || 1)), H = Math.max(1, Math.ceil(Number(h) || 1));
    const cw = Math.max(1, Math.ceil(W * SS)), ch = Math.max(1, Math.ceil(H * SS));
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const g = c.getContext('2d');
    g.scale(SS, SS);
    g.translate(W / 2, H / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    draw(g);
    s = { c, w: W, h: H };
    SPR.set(key, s);
    return s;
  }
  A.sprite = sprite;

  function circ(g, x, y, r, fill, lw) {
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = fill; g.fill();
    if (lw) { g.lineWidth = lw; g.strokeStyle = OUT; g.stroke(); }
  }
  function rrect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + rr, y); g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr); g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath();
  }
  function glossy(g, x, y, r, col) {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, shade(col, 0.38));
    gr.addColorStop(0.45, col);
    gr.addColorStop(1, shade(col, -0.38));
    return gr;
  }
  function shine(g, x, y, r) {
    g.beginPath(); g.ellipse(x - r * 0.32, y - r * 0.38, r * 0.4, r * 0.22, -0.6, 0, 7);
    g.fillStyle = 'rgba(255,250,230,0.82)'; g.fill();
  }
  /* Cached 5-point star vertices, keyed by points × inner ratio. */
  const STAR_PTS = new Map();
  function starPts(n, inner) {
    const key = n + ':' + inner, hit = STAR_PTS.get(key);
    if (hit) return hit;
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2, rad = i & 1 ? inner : 1;
      pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    STAR_PTS.set(key, pts);
    return pts;
  }
  function star(g, x, y, r, n, inner) {
    const pts = starPts(n || 5, inner == null ? 0.45 : inner);
    g.beginPath();
    g.moveTo(x + pts[0] * r, y + pts[1] * r);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(x + pts[i] * r, y + pts[i + 1] * r);
    g.closePath();
  }
  A.star = star;
  A.starSpr = function (n, inner, fill, stroke, r) {
    const R = Math.round((r || 12) * 10) / 10;
    return sprite(`star|${n}|${inner}|${fill}|${stroke}|${R}`, R * 2 + 6, R * 2 + 6, (g) => {
      star(g, 0, 0, R, n, inner);
      g.fillStyle = fill; g.fill();
      if (stroke) { g.lineWidth = 1.6; g.strokeStyle = stroke; g.stroke(); }
    });
  };
  A.rrect = rrect;

  function rivet(g, x, y, r) {
    r = r || 1.55;
    circ(g, x, y, r, '#6a6258', 0.8);
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 7);
    g.fillStyle = 'rgba(255,230,180,0.55)'; g.fill();
  }
  function rune(g, x, y, s, col) {
    g.save();
    g.strokeStyle = col || '#ffc44a';
    g.lineWidth = Math.max(1.15, s * 0.38);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y - s); g.lineTo(x, y + s);
    g.moveTo(x - s * 0.65, y - s * 0.15); g.lineTo(x + s * 0.65, y + s * 0.2);
    g.stroke();
    g.restore();
  }
  function lumpPath(g, R, sx, sy, seed) {
    sx = sx || 1; sy = sy || 1;
    g.beginPath();
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const j = 0.84 + 0.16 * Math.sin(i * 2.7 + seed * 1.7);
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * sx * j, Math.sin(a) * R * sy * j);
    }
    g.closePath();
  }
  function fillLump(g, R, col, lw, sx, sy, seed) {
    lumpPath(g, R, sx, sy, seed);
    g.fillStyle = glossy(g, -R * 0.2, -R * 0.28, R, col);
    g.fill();
    g.save();
    lumpPath(g, R, sx, sy, seed);
    g.clip();
    g.strokeStyle = 'rgba(255,236,200,0.42)';
    g.lineWidth = Math.max(1.5, lw * 0.65);
    lumpPath(g, R * 0.86, sx, sy, seed);
    g.stroke();
    g.restore();
    lumpPath(g, R, sx, sy, seed);
    g.lineJoin = 'round';
    g.lineWidth = lw;
    g.strokeStyle = OUT;
    g.stroke();
    shine(g, 0, 0, R * 0.9);
  }
  function cracks(g, R, n, col) {
    g.save();
    g.strokeStyle = col || '#ff6a1a';
    g.lineWidth = Math.max(1.15, R * 0.08);
    g.lineCap = 'round';
    const rg = rng(17 + ((R * 10) | 0));
    for (let i = 0; i < n; i++) {
      const a = rg() * 6.28, r0 = R * (0.12 + rg() * 0.18), r1 = R * (0.65 + rg() * 0.22), mid = (r0 + r1) / 2, wob = (rg() - 0.5) * R * 0.22;
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * mid + Math.cos(a + 1.5) * wob, Math.sin(a) * mid + Math.sin(a + 1.5) * wob);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.stroke();
    }
    g.restore();
  }
  function emberEye(g, x, y, r, angry) {
    g.beginPath();
    if (angry) g.ellipse(x, y, r, r * 0.52, -0.45 * Math.sign(x || 1), 0, 7);
    else g.arc(x, y, r, 0, 7);
    g.fillStyle = '#1a1512'; g.fill();
    g.beginPath(); g.arc(x + r * 0.08, y - r * 0.08, r * 0.55, 0, 7);
    g.fillStyle = '#ffb020'; g.fill();
    g.beginPath(); g.arc(x + r * 0.15, y - r * 0.2, r * 0.22, 0, 7);
    g.fillStyle = '#fff6d0'; g.fill();
  }
  function flame(g, x, y, s, a) {
    g.save(); g.translate(x, y); g.rotate(a || 0.45);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(s * 0.5, s * 0.2, s * 0.38, s * 0.95, 0, s * 1.4);
    g.bezierCurveTo(-s * 0.42, s * 0.85, -s * 0.48, s * 0.2, 0, 0);
    g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, s * 1.4);
    gr.addColorStop(0, '#fff0a0');
    gr.addColorStop(0.35, '#ff9a20');
    gr.addColorStop(1, 'rgba(200,30,10,0.15)');
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = OUT; g.stroke();
    g.beginPath();
    g.moveTo(0, s * 0.12);
    g.bezierCurveTo(s * 0.2, s * 0.3, s * 0.14, s * 0.65, 0, s * 0.9);
    g.bezierCurveTo(-s * 0.16, s * 0.55, -s * 0.2, s * 0.3, 0, s * 0.12);
    g.fillStyle = 'rgba(255,255,230,0.85)'; g.fill();
    g.restore();
  }
  function plate(g, x, y, w, h, rot, tier, col) {
    g.save(); g.translate(x, y); g.rotate(rot || 0);
    const rad = tier >= 2 ? 1.6 : 0.7;
    rrect(g, -w / 2, -h / 2, w, h, rad);
    g.fillStyle = glossy(g, 0, 0, w * 0.7, col || '#8a8070'); g.fill();
    g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke();
    if (tier >= 2) { rivet(g, -w * 0.28, 0, Math.max(1.15, w * 0.08)); rivet(g, w * 0.28, 0, Math.max(1.15, w * 0.08)); }
    if (tier >= 3) rune(g, 0, 0, Math.min(w, h) * 0.28, '#ffc44a');
    g.restore();
  }
  function heat(g, R, a) {
    const k = a == null ? 1 : a / 0.16;
    g.beginPath(); g.ellipse(0, R * 0.55, R * 1.05, R * 0.45, 0, 0, 7);
    g.fillStyle = 'rgba(255,210,90,' + (0.38 * k).toFixed(3) + ')'; g.fill();
    g.beginPath(); g.ellipse(0, R * 0.1, R * 0.85, R * 0.6, 0, 0, 7);
    g.fillStyle = 'rgba(255,110,25,' + (0.24 * k).toFixed(3) + ')'; g.fill();
  }
  function forgeTeam(col) {
    const c = String(col || '').toLowerCase();
    if (c === '#4fa3ff') return { metal: '#c4923a', hot: '#ffb020' }; // Left: warm brass
    if (c === '#ff5d5d' || c === '#ff5a4f') return { metal: '#7a96aa', hot: '#9ab4c8' }; // Right: cold steel
    return { metal: col || '#c4923a', hot: shade(col || '#c4923a', 0.28) };
  }

  /* Living-ore colours for neutrals (public name BALLOON kept for API compatibility). */
  const BALLOON = ['#8a3a28', '#4a6a88', '#3a7a48', '#c4923a', '#6a3a68', '#c46828', '#4a3a78', '#2a7a6a'];
  /* Luminance-separated rings: T1 dark, T2 mid, T3 bright — shape pips carry the rest. */
  const TIER_RING = [null, '#3a2416', '#8a96aa', '#fff6a8'];
  const KIND = {
    runner: ['#f0c060', '#ff9a28', '#fff6c4'],
    swarm:  ['#5c2248', '#6a2030', '#141c28'],
    brute:  ['#6a2a18', '#8a3a20', '#4a2014'],
    boss:   ['#3a1830'],
    // v0.6: kill-confetti colours (bodies are drawn with their own palette below)
    splitter: ['#ffb030'],
    shard:    ['#e8501a']
  };
  A.creepColor = function (kind, v) {
    if (kind === 'neutral') return BALLOON[((v || 1) - 1) % BALLOON.length];
    const arr = KIND[kind] || BALLOON;
    return arr[Math.max(0, Math.min(arr.length - 1, (v || 1) - 1))];
  };
  // Guard against bad wire data (e.g. a string radius): never let NaN reach a gradient or canvas size.
  function finR(R) { R = +R; return R > 0 && R < 1e4 ? R : 8; }
  A.creepR = function (kind, r, cell) { const v = (+r) * (+cell) * (kind === 'swarm' ? 1.7 : kind === 'boss' ? 1.25 : kind === 'shard' ? 1.5 : 1.4); return Math.max(kind === 'swarm' ? 7 : kind === 'shard' ? 6 : 5.5, v === v && v < 1e4 ? v : 0); };

  function tierRing(g, R, tier) {
    if (!tier) return;
    const col = TIER_RING[tier];
    g.save();
    g.strokeStyle = col;
    if (tier === 1) {
      g.lineWidth = Math.max(3.2, R * 0.2);
      g.beginPath(); g.arc(0, 0, R + 2.2, 0, 7); g.stroke();
    } else if (tier === 2) {
      g.lineWidth = Math.max(2.0, R * 0.12);
      g.beginPath(); g.arc(0, 0, R + 1.5, 0, 7); g.stroke();
      g.beginPath(); g.arc(0, 0, R + 4.0, 0, 7); g.stroke();
    } else {
      g.lineWidth = Math.max(3.4, R * 0.22);
      g.beginPath(); g.arc(0, 0, R + 2.8, 0, 7); g.stroke();
      g.strokeStyle = OUT; g.lineWidth = 1.4;
      g.beginPath(); g.arc(0, 0, R + 4.6, 0, 7); g.stroke();
      g.fillStyle = col;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * (R + 3.2), Math.sin(a) * (R + 3.2));
        g.lineTo(Math.cos(a) * (R + 7.2), Math.sin(a) * (R + 7.2));
        g.lineTo(Math.cos(a + 0.18) * (R + 3.2), Math.sin(a + 0.18) * (R + 3.2));
        g.closePath(); g.fill();
        g.lineWidth = 1; g.strokeStyle = OUT; g.stroke();
      }
    }
    g.restore();
  }
  function tierBadge(g, R, tier) {
    if (!tier) return;
    const col = TIER_RING[tier], bx = R * 0.88, by = R * 0.92, br = Math.max(4.4, R * 0.5);
    circ(g, bx, by, br, col, 1.6);
    g.fillStyle = tier === 3 ? '#1a1512' : (tier === 1 ? '#f0e6d4' : OUT);
    g.save(); g.translate(bx, by);
    if (tier === 1) {
      g.beginPath(); g.moveTo(0, -br * 0.62); g.lineTo(br * 0.55, br * 0.42); g.lineTo(-br * 0.55, br * 0.42); g.closePath(); g.fill();
    } else if (tier === 2) {
      g.beginPath(); g.moveTo(0, -br * 0.6); g.lineTo(br * 0.55, 0); g.lineTo(0, br * 0.6); g.lineTo(-br * 0.55, 0); g.closePath(); g.fill();
    } else {
      star(g, 0, 0, br * 0.62, 5, 0.45); g.fill();
    }
    g.restore();
  }

  function drawCreep(g, kind, v, R) {
    const col = A.creepColor(kind, v);
    const lw = Math.max(2.7, R * 0.22);
    const tier = (kind === 'runner' || kind === 'brute' || kind === 'swarm') ? Math.max(0, Math.min(3, v || 0))
      : (kind === 'splitter' || kind === 'shard') && v >= 0 && v <= 3 ? (v | 0) : 0; // neutral Splitters carry the wave number (>= 8): no tier

    if (kind === 'splitter') { drawSplitter(g, R, tier, lw, v > 3); tierBadge(g, R, tier); return; }
    if (kind === 'shard') { drawShard(g, R, tier, lw); return; }

    if (kind === 'runner') {
      heat(g, R, 0.2);
      flame(g, R * 0.15, R * 0.55, R * 1.05, 0.55);
      if (tier >= 2) flame(g, -R * 0.2, R * 0.45, R * 0.7, 0.85);
      tierRing(g, R, tier);
      // pointed ears
      g.beginPath(); g.moveTo(-R * 0.35, -R * 0.45); g.lineTo(-R * 0.72, -R * 1.15); g.lineTo(-R * 0.08, -R * 0.62); g.closePath();
      g.fillStyle = glossy(g, -R * 0.4, -R * 0.7, R * 0.5, col); g.fill(); g.lineWidth = lw * 0.75; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(R * 0.35, -R * 0.45); g.lineTo(R * 0.72, -R * 1.15); g.lineTo(R * 0.08, -R * 0.62); g.closePath();
      g.fillStyle = glossy(g, R * 0.4, -R * 0.7, R * 0.5, col); g.fill(); g.lineWidth = lw * 0.75; g.strokeStyle = OUT; g.stroke();
      fillLump(g, R, col, lw, 0.72, 1.12, 3);
      emberEye(g, -R * 0.2, -R * 0.15, R * 0.18, false);
      emberEye(g, R * 0.22, -R * 0.15, R * 0.18, false);
      // small grin
      g.beginPath(); g.arc(0, R * 0.18, R * 0.28, 0.15, Math.PI - 0.15);
      g.strokeStyle = OUT; g.lineWidth = Math.max(1.3, lw * 0.45); g.stroke();
      if (tier >= 1) plate(g, 0, R * 0.28, R * 0.95, R * 0.42, 0, tier, shade(col, -0.22));
      tierBadge(g, R, tier);
      return;
    }

    if (kind === 'brute') {
      heat(g, R, 0.14);
      tierRing(g, R * 1.05, tier);
      // hulking shoulders
      fillLump(g, R * 0.62, shade(col, -0.12), lw, 1.05, 0.75, 8);
      g.save(); g.translate(-R * 0.7, -R * 0.05); fillLump(g, R * 0.48, shade(col, -0.08), lw * 0.85, 1.1, 0.85, 4); g.restore();
      g.save(); g.translate(R * 0.7, -R * 0.05); fillLump(g, R * 0.48, shade(col, -0.08), lw * 0.85, 1.1, 0.85, 6); g.restore();
      fillLump(g, R, col, lw, 1.18, 0.95, 2);
      g.save();
      lumpPath(g, R, 1.18, 0.95, 2); g.clip();
      cracks(g, R, 5, '#ff6a1a');
      g.restore();
      // blocky head
      g.save(); g.translate(0, -R * 0.55);
      fillLump(g, R * 0.62, shade(col, 0.08), lw, 1.15, 0.82, 5);
      emberEye(g, -R * 0.22, 0, R * 0.14, true);
      emberEye(g, R * 0.22, 0, R * 0.14, true);
      g.beginPath(); g.moveTo(-R * 0.18, R * 0.22); g.lineTo(R * 0.18, R * 0.22);
      g.strokeStyle = OUT; g.lineWidth = Math.max(1.4, lw * 0.5); g.stroke();
      g.restore();
      if (tier >= 1) {
        plate(g, -R * 0.7, -R * 0.05, R * 0.7, R * 0.5, -0.2, tier, '#6a6258');
        plate(g, R * 0.7, -R * 0.05, R * 0.7, R * 0.5, 0.2, tier, '#6a6258');
      }
      if (tier >= 2) plate(g, 0, R * 0.2, R * 0.95, R * 0.45, 0, tier, '#7a7068');
      tierBadge(g, R, tier);
      return;
    }

    if (kind === 'swarm') {
      // cool teal underglow (not gold) so T3 swarm stays dark under tritanopia vs the pale runner
      g.beginPath(); g.ellipse(0, R * 0.55, R * 1.05, R * 0.42, 0, 0, 7);
      g.fillStyle = 'rgba(60,200,210,0.32)'; g.fill();
      tierRing(g, R * 1.05, tier);
      const mite = (x, y, r, seed) => {
        g.save(); g.translate(x, y);
        fillLump(g, r, col, Math.max(2.2, lw * 0.75), 1, 0.9, seed);
        g.save(); lumpPath(g, r, 1, 0.9, seed); g.clip(); cracks(g, r, 2, '#7ee0e8'); g.restore();
        emberEye(g, 0, -r * 0.08, r * 0.22, false);
        // spark whisker — wide top silhouette, distinct from the runner's ears
        g.beginPath();
        g.moveTo(-r * 0.12, -r * 0.65);
        g.quadraticCurveTo(-r * 0.45, -r * 1.25, -r * 0.05, -r * 1.5);
        g.strokeStyle = OUT; g.lineWidth = Math.max(1.7, lw * 0.65); g.stroke();
        g.strokeStyle = '#8af0f4'; g.lineWidth = Math.max(1, lw * 0.35); g.stroke();
        circ(g, -r * 0.05, -r * 1.5, Math.max(1.7, r * 0.18), '#c8ffff', 1);
        if (tier >= 1) plate(g, 0, r * 0.28, r * 0.95, r * 0.4, 0, tier, shade(col, 0.18));
        g.restore();
      };
      mite(-R * 0.52, R * 0.2, R * 0.58, 3);
      mite(R * 0.52, R * 0.24, R * 0.56, 7);
      mite(0, -R * 0.3, R * 0.64, 5);
      tierBadge(g, R, tier);
      return;
    }

    if (kind === 'boss') {
      heat(g, R, 0.22);
      g.lineWidth = 3.4; g.strokeStyle = '#ffc44a';
      g.beginPath(); g.arc(0, 0, R + 3.2, 0, 7); g.stroke();
      // slag horns
      g.beginPath(); g.moveTo(-R * 0.35, -R * 0.5); g.lineTo(-R * 0.95, -R * 1.2); g.lineTo(-R * 0.05, -R * 0.55); g.closePath();
      g.fillStyle = glossy(g, -R * 0.4, -R * 0.8, R * 0.5, col); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(R * 0.35, -R * 0.5); g.lineTo(R * 0.95, -R * 1.2); g.lineTo(R * 0.05, -R * 0.55); g.closePath();
      g.fillStyle = glossy(g, R * 0.4, -R * 0.8, R * 0.5, col); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      fillLump(g, R, col, lw, 1.1, 1.0, 9);
      g.save(); lumpPath(g, R, 1.1, 1.0, 9); g.clip(); cracks(g, R, 6, '#ffb020'); g.restore();
      emberEye(g, -R * 0.28, -R * 0.1, R * 0.2, true);
      emberEye(g, R * 0.28, -R * 0.1, R * 0.2, true);
      rune(g, 0, R * 0.25, R * 0.28, '#ffc44a');
      return;
    }

    // neutral living slag
    heat(g, R, 0.12);
    fillLump(g, R, col, lw, 1, 0.95, (v || 1) * 3);
    g.save(); lumpPath(g, R, 1, 0.95, (v || 1) * 3); g.clip(); cracks(g, R, 3, shade(col, 0.35)); g.restore();
    emberEye(g, -R * 0.22, -R * 0.08, R * 0.16, false);
    emberEye(g, R * 0.22, -R * 0.08, R * 0.16, false);
  }

  /* v0.6 Slag Splitter: a cracked slag geode, molten seam splitting it open, glowing crystal shards poking out. */
  const GEODE = '#5c5868', GEODE_N = '#6a5848';
  function seam(g, R) {
    // one bold zigzag split down the middle, like an egg cracking open: dark under-stroke, hot body, white-hot core
    const pts = [0.05, -1.05, -0.12, -0.55, 0.14, -0.2, -0.1, 0.18, 0.12, 0.55, -0.04, 1.05];
    const path = () => { g.beginPath(); g.moveTo(pts[0] * R, pts[1] * R); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * R, pts[i + 1] * R); };
    g.save(); g.lineJoin = 'miter'; g.lineCap = 'round';
    path(); g.strokeStyle = 'rgba(255,140,30,0.45)'; g.lineWidth = Math.max(5, R * 0.62); g.stroke();
    path(); g.strokeStyle = OUT; g.lineWidth = Math.max(3.4, R * 0.38); g.stroke();
    path(); g.strokeStyle = '#ff8a1a'; g.lineWidth = Math.max(2.2, R * 0.25); g.stroke();
    path(); g.strokeStyle = '#fff0a0'; g.lineWidth = Math.max(1.1, R * 0.1); g.stroke();
    g.restore();
  }
  function crystal(g, a, r0, r1, wid, col) {
    const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
    g.beginPath();
    g.moveTo(ca * r0 + px * wid, sa * r0 + py * wid);
    g.lineTo(ca * (r1 - wid * 0.5) + px * wid * 0.75, sa * (r1 - wid * 0.5) + py * wid * 0.75);
    g.lineTo(ca * r1, sa * r1);
    g.lineTo(ca * (r1 - wid * 0.5) - px * wid * 0.75, sa * (r1 - wid * 0.5) - py * wid * 0.75);
    g.lineTo(ca * r0 - px * wid, sa * r0 - py * wid);
    g.closePath();
    g.fillStyle = glossy(g, ca * r1 * 0.8, sa * r1 * 0.8, wid * 2.2, col); g.fill();
    g.lineWidth = Math.max(1.6, wid * 0.32); g.strokeStyle = OUT; g.stroke();
    g.beginPath(); g.moveTo(ca * r0 + px * wid * 0.2, sa * r0 + py * wid * 0.2); g.lineTo(ca * (r1 - wid * 0.3), sa * (r1 - wid * 0.3));
    g.strokeStyle = 'rgba(255,250,220,0.9)'; g.lineWidth = Math.max(0.9, wid * 0.2); g.stroke();
  }
  function drawSplitter(g, R, tier, lw, neutral) {
    heat(g, R, 0.16);
    tierRing(g, R * 1.04, tier);
    // a crown of glowing crystal shards breaking out of the top; 4 at T3, like the 4 shards it drops
    const n = tier >= 3 ? 4 : 3, cc = '#ffb040', span = n === 4 ? 0.62 : 0.8;
    for (let i = 0; i < n; i++) crystal(g, -Math.PI / 2 + (i - (n - 1) / 2) * span, R * 0.45, R * (i === 0 || i === n - 1 ? 1.28 : 1.48), R * 0.3, cc);
    fillLump(g, R, neutral ? GEODE_N : GEODE, lw, 1.06, 0.96, 1);
    g.save(); lumpPath(g, R, 1.06, 0.96, 1); g.clip();
    cracks(g, R, 3, '#ffb030');
    seam(g, R);
    g.restore();
    // re-stroke the rim so the seam glow stays inside the outline
    lumpPath(g, R, 1.06, 0.96, 1); g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
    // eyes either side of the split
    emberEye(g, -R * 0.42, -R * 0.05, R * 0.19, false);
    emberEye(g, R * 0.44, -R * 0.12, R * 0.19, false);
  }
  /* v0.6 Shard: a small, fast, faceted molten chip with one ember eye. */
  function drawShard(g, R, tier, lw) {
    // short ember trail baked behind it (low cost: part of the cached sprite)
    g.beginPath(); g.ellipse(-R * 0.05, R * 0.9, R * 0.5, R * 0.28, 0, 0, 7); g.fillStyle = 'rgba(255,150,40,0.35)'; g.fill();
    if (tier) tierRing(g, R * 1.02, tier);
    const P = [0, -1.18, 0.86, -0.18, 0.4, 0.96, -0.58, 0.8, -0.92, -0.16];
    const path = () => { g.beginPath(); g.moveTo(P[0] * R, P[1] * R); for (let i = 2; i < P.length; i += 2) g.lineTo(P[i] * R, P[i + 1] * R); g.closePath(); };
    path(); g.fillStyle = glossy(g, -R * 0.15, -R * 0.3, R * 1.1, '#d8481a'); g.fill();
    g.lineJoin = 'round'; g.lineWidth = Math.max(2, lw * 0.85); g.strokeStyle = OUT; g.stroke();
    // facets: one hot top face, bright edges
    g.beginPath(); g.moveTo(0, -1.18 * R); g.lineTo(0.86 * R, -0.18 * R); g.lineTo(0.05 * R, 0.05 * R); g.lineTo(-0.92 * R, -0.16 * R); g.closePath();
    g.fillStyle = 'rgba(255,214,90,0.9)'; g.fill();
    g.beginPath(); g.moveTo(0.05 * R, 0.05 * R); g.lineTo(0.4 * R, 0.96 * R);
    g.strokeStyle = 'rgba(255,240,180,0.8)'; g.lineWidth = Math.max(0.9, R * 0.1); g.stroke();
    emberEye(g, -R * 0.08, -R * 0.1, Math.max(1.6, R * 0.26), false);
  }

  A.hasCreep = function (kind) { return kind === 'neutral' || kind === 'runner' || kind === 'brute' || kind === 'swarm' || kind === 'boss' || kind === 'splitter' || kind === 'shard'; };
  A.creep = function (kind, v, R) {
    R = finR(R);
    const Rq = Math.round(R * 2) / 2, vk = kind === 'neutral' ? ((v || 1) - 1) % BALLOON.length : kind === 'boss' ? 0
      : (kind === 'splitter' || kind === 'shard') ? (v >= 0 && v <= 3 ? (v | 0) : 'n') : Math.min(3, v || 0);
    // Tight canvas: T3 ring spikes reach ~R+8; keep a 2 px pad. Smaller than 5.2R+16 to cut overdraw.
    const size = Math.ceil(Math.max(Rq * 3.8 + 8, (Rq + 8) * 2 + 4));
    return sprite(`cr|${kind}|${vk}|${Rq}`, size, size, (g) => drawCreep(g, kind, kind === 'neutral' ? vk + 1 : vk === 'n' ? 99 : vk, Rq));
  };
  A.creepFlash = function (R) {
    R = finR(R);
    const Rq = Math.round(R * 2) / 2, size = Math.ceil(Rq * 2.8 + 6);
    return sprite(`cf|${Rq}`, size, size, (g) => {
      g.beginPath(); g.arc(0, 0, Rq * 1.05, 0, 7);
      const gr = g.createRadialGradient(0, 0, Rq * 0.2, 0, 0, Rq * 1.05);
      gr.addColorStop(0, 'rgba(255,245,200,0.95)');
      gr.addColorStop(0.55, 'rgba(255,140,40,0.55)');
      gr.addColorStop(1, 'rgba(255,40,0,0)');
      g.fillStyle = gr; g.fill();
    });
  };
  A.creepIce = function (R) {
    R = finR(R);
    const Rq = Math.round(R * 2) / 2, size = Math.ceil(Rq * 2.6 + 8);
    return sprite(`ci|${Rq}`, size, size, (g) => {
      // Tight crystal rim — avoid a large translucent fill (overdraw on crowded boards)
      g.beginPath();
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, j = (i % 2 ? 1.12 : 0.96);
        g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * Rq * j, Math.sin(a) * Rq * j);
      }
      g.closePath();
      g.fillStyle = 'rgba(150,225,255,0.22)'; g.fill();
      g.lineWidth = Math.max(1.2, Rq * 0.12); g.strokeStyle = 'rgba(200,240,255,0.9)'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      star(g, Rq * 0.5, -Rq * 0.55, Math.max(1.5, Rq * 0.28), 4, 0.35); g.fill();
    });
  };
  // Tight cyan ring for low-detail mode (no big translucent fill)
  A.creepIceLite = function (R) {
    R = finR(R);
    const Rq = Math.round(R * 2) / 2, size = Math.ceil(Rq * 2.2 + 4);
    return sprite(`cil|${Rq}`, size, size, (g) => {
      g.strokeStyle = 'rgba(140,230,255,0.95)';
      g.lineWidth = Math.max(1.8, Rq * 0.16);
      g.beginPath(); g.arc(0, 0, Rq * 0.95, 0, 7); g.stroke();
    });
  };
  A.shadow = function (R) {
    R = finR(R);
    const Rq = Math.round(R * 2) / 2, w = Rq * 2.4, h = Rq * 1.1;
    return sprite(`sh|${Rq}`, w, h, (g) => {
      // Simple ellipse, no shadowBlur (that only bloated the baked bitmap)
      g.fillStyle = 'rgba(10,8,6,0.32)';
      g.beginPath(); g.ellipse(0, 0, Rq * 1.05, Rq * 0.42, 0, 0, 7); g.fill();
    });
  };

  function ironFill(g, x, y, r, col) { return glossy(g, x, y, r, col || '#6a6258'); }

  function ballista(g, lvl) {
    const iron = lvl >= 2 ? '#8a7a58' : '#6a6258', wood = '#5a3a22';
    // stock (faces up, so client rotation aims the bolt)
    rrect(g, -5.2, -16, 10.4, 28, 2);
    g.fillStyle = ironFill(g, 0, 0, 16, wood); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    // prod arms
    g.beginPath();
    g.moveTo(-16 - lvl * 2, -12);
    g.lineTo(-5, -8);
    g.lineTo(-5, -4);
    g.lineTo(-16 - lvl * 2, -6);
    g.closePath();
    g.fillStyle = ironFill(g, -10, -8, 10, iron); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    g.beginPath();
    g.moveTo(16 + lvl * 2, -12);
    g.lineTo(5, -8);
    g.lineTo(5, -4);
    g.lineTo(16 + lvl * 2, -6);
    g.closePath();
    g.fillStyle = ironFill(g, 10, -8, 10, iron); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    // string
    g.beginPath(); g.moveTo(-16 - lvl * 2, -9); g.quadraticCurveTo(0, 2, 16 + lvl * 2, -9);
    g.strokeStyle = OUT; g.lineWidth = 1.6; g.stroke();
    // bolt
    g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -20);
    g.strokeStyle = OUT; g.lineWidth = 3.2; g.stroke();
    g.strokeStyle = lvl >= 2 ? '#ffc44a' : '#c8d0d8'; g.lineWidth = 1.6; g.stroke();
    g.beginPath(); g.moveTo(-3.2, -17); g.lineTo(0, -22); g.lineTo(3.2, -17); g.closePath();
    g.fillStyle = lvl >= 2 ? '#ffc44a' : '#e8eef4'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = OUT; g.stroke();
    // mount block
    rrect(g, -7.5, 2, 15, 11, 2);
    g.fillStyle = ironFill(g, 0, 7, 10, iron); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    rivet(g, -4, 7, 1.5); rivet(g, 4, 7, 1.5);
    if (lvl >= 1) { plate(g, -8, 0, 6, 10, 0, lvl, iron); plate(g, 8, 0, 6, 10, 0, lvl, iron); }
    if (lvl >= 2) rune(g, 0, 8, 3.2, '#ffc44a');
  }

  function crucible(g, lvl) {
    const iron = lvl >= 2 ? '#8a6a40' : '#6a5a48';
    // bellows
    const bel = (sx) => {
      g.save(); g.translate(sx * 11, 6);
      g.beginPath(); g.moveTo(0, -6); g.lineTo(sx * 8, -2); g.lineTo(sx * 8, 6); g.lineTo(0, 8); g.closePath();
      g.fillStyle = ironFill(g, sx * 3, 0, 8, '#5a3a28'); g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(sx * 1, -3); g.lineTo(sx * 7, 0); g.moveTo(sx * 1, 2); g.lineTo(sx * 7, 4);
      g.strokeStyle = OUT; g.lineWidth = 1.1; g.stroke();
      g.restore();
    };
    bel(-1); bel(1);
    // pot body (mouth points up)
    g.beginPath();
    g.moveTo(-11, 4); g.lineTo(-13, -6); g.quadraticCurveTo(0, -12, 13, -6); g.lineTo(11, 4);
    g.quadraticCurveTo(0, 10, -11, 4);
    g.closePath();
    g.fillStyle = ironFill(g, 0, 0, 14, iron); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    // molten mouth
    g.beginPath(); g.ellipse(0, -8, 9 + lvl, 4.2, 0, 0, 7);
    const melt = g.createRadialGradient(0, -8, 1, 0, -8, 9);
    melt.addColorStop(0, '#fff0a0'); melt.addColorStop(0.4, '#ff8a20'); melt.addColorStop(1, '#8a2008');
    g.fillStyle = melt; g.fill();
    g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    rivet(g, -8, -1, 1.5); rivet(g, 8, -1, 1.5); rivet(g, 0, 5, 1.5);
    if (lvl >= 1) { plate(g, -10, 2, 6, 8, -0.2, lvl, iron); plate(g, 10, 2, 6, 8, 0.2, lvl, iron); }
    if (lvl >= 2) rune(g, 0, 3, 3.4, '#ffc44a');
  }

  function quench(g, lvl) {
    const metal = lvl >= 2 ? '#6a8a9a' : '#5a7488';
    // 3/4 tank body
    rrect(g, -11, -10, 22, 24, 6);
    g.fillStyle = ironFill(g, 0, 2, 16, metal); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    // top ellipse (3/4 lean)
    g.beginPath(); g.ellipse(0, -10, 11, 5, 0, 0, 7);
    g.fillStyle = ironFill(g, -2, -11, 10, shade(metal, 0.15)); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    // frost coils
    g.strokeStyle = '#7fe0ff'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-9, -4); g.bezierCurveTo(-13, 2, 13, 4, 9, 10); g.stroke();
    g.beginPath(); g.moveTo(9, -4); g.bezierCurveTo(13, 2, -13, 4, -9, 10); g.stroke();
    g.strokeStyle = OUT; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-9, -4); g.bezierCurveTo(-13, 2, 13, 4, 9, 10); g.stroke();
    // nozzle
    rrect(g, -3.5, -18, 7, 9, 2);
    g.fillStyle = ironFill(g, 0, -14, 6, shade(metal, -0.1)); g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
    g.beginPath(); g.ellipse(0, -18, 4.2, 2.2, 0, 0, 7);
    g.fillStyle = '#c8f0ff'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = OUT; g.stroke();
    // baked steam
    g.globalAlpha = 0.4;
    circ(g, 8, -20, 3.2, '#e8f6fc', 0);
    circ(g, 12, -24, 2.2, '#f2faff', 0);
    circ(g, -7, -19, 2.6, '#e8f6fc', 0);
    g.globalAlpha = 1;
    rivet(g, -7, 2, 1.5); rivet(g, 7, 2, 1.5); rivet(g, 0, 10, 1.5);
    if (lvl >= 1) plate(g, 0, 4, 12, 7, 0, lvl, shade(metal, -0.08));
    if (lvl >= 2) rune(g, 0, 4, 3.2, '#b8f0ff');
    // ice crust along the base
    g.beginPath(); g.moveTo(-11, 10); g.lineTo(-7, 14); g.lineTo(-2, 11); g.lineTo(3, 15); g.lineTo(8, 11); g.lineTo(11, 13); g.lineTo(11, 14); g.lineTo(-11, 14); g.closePath();
    g.fillStyle = 'rgba(180,230,255,0.55)'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = OUT; g.stroke();
  }

  /* v0.6 Smelter: a squat furnace with a molten grate and a coiled heat lance (faces up; the client rotates it). */
  function smelter(g, lvl) {
    const iron = lvl >= 2 ? '#7a5a3a' : '#5a4a40', coil = lvl >= 2 ? '#ffc44a' : '#d0782a', len = 20 + lvl * 1.5;
    // exhaust stacks
    for (const sx of [-1, 1]) {
      rrect(g, sx * 13 - 2.6, -7, 5.2, 10, 1.6);
      g.fillStyle = ironFill(g, sx * 13, -3, 5, shade(iron, -0.06)); g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.ellipse(sx * 13, -7, 2.6, 1.2, 0, 0, 7); g.fillStyle = '#ff8a1a'; g.fill(); g.lineWidth = 1; g.strokeStyle = OUT; g.stroke();
    }
    // furnace drum
    rrect(g, -12, -5, 24, 19, 7);
    g.fillStyle = ironFill(g, 0, 2, 16, iron); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    // molten grate
    rrect(g, -7.5, 2, 15, 8.5, 3);
    const gr = g.createRadialGradient(0, 7, 1, 0, 6, 9);
    gr.addColorStop(0, '#fff0a0'); gr.addColorStop(0.45, '#ff8a20'); gr.addColorStop(1, '#8a2008');
    g.fillStyle = gr; g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
    g.beginPath(); for (const x of [-3.5, 0, 3.5]) { g.moveTo(x, 2.6); g.lineTo(x, 10); }
    g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
    // tapered lance
    g.beginPath(); g.moveTo(-4.6, -3); g.lineTo(-3, -len + 2); g.lineTo(3, -len + 2); g.lineTo(4.6, -3); g.closePath();
    g.fillStyle = ironFill(g, 0, -10, 10, shade(iron, 0.08)); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    // copper (T3: gold) coils
    const bands = 2 + lvl;
    for (let i = 0; i < bands; i++) {
      const y = -6 - i * ((len - 10) / bands), w = 4.9 - i * 0.35;
      rrect(g, -w, y - 1.5, w * 2, 3, 1.4);
      g.fillStyle = coil; g.fill(); g.lineWidth = 1.1; g.strokeStyle = OUT; g.stroke();
    }
    // white-hot emitter
    const tip = g.createRadialGradient(0, -len, 0.5, 0, -len, 4.2 + lvl * 0.4);
    tip.addColorStop(0, '#ffffff'); tip.addColorStop(0.4, '#ffe070'); tip.addColorStop(1, '#ff6a1a');
    g.beginPath(); g.arc(0, -len, 3.8 + lvl * 0.4, 0, 7); g.fillStyle = tip; g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
    rivet(g, -8.5, -1, 1.4); rivet(g, 8.5, -1, 1.4);
    if (lvl >= 1) { plate(g, -10.5, 8, 5, 8, -0.15, lvl, iron); plate(g, 10.5, 8, 5, 8, 0.15, lvl, iron); }
    if (lvl >= 2) rune(g, 0, -1, 2.6, '#ffc44a');
  }

  A.tower = function (type, lvl) {
    const L = Math.max(0, Math.min(2, lvl || 0));
    return sprite(`tw|${type}|${L}`, 52, 52, (g) => {
      if (type === 'cannon') crucible(g, L);
      else if (type === 'frost') quench(g, L);
      else if (type === 'smelter') smelter(g, L);
      else ballista(g, L);
    });
  };
  A.hasTower = function (type) { return type === 'arrow' || type === 'cannon' || type === 'frost' || type === 'smelter'; };
  /* Smelter heat beam, one cached strip per heat stage (0 cold .. 3 white-hot). The client stretches it along the beam
     with a single drawImage. Thickness and brightness both rise with the stage (luminance cue, CVD-safe). */
  const BEAM = [
    { h: 7, glow: 'rgba(190,40,10,0.30)', body: '#b83a14', core: '#ff8a3a', cw: 1.2 },
    { h: 10, glow: 'rgba(240,80,20,0.34)', body: '#ff5a14', core: '#ffb050', cw: 1.8 },
    { h: 13, glow: 'rgba(255,130,30,0.40)', body: '#ff8a1a', core: '#ffe890', cw: 2.6 },
    { h: 17, glow: 'rgba(255,190,70,0.48)', body: '#ffb030', core: '#ffffff', cw: 3.6 }
  ];
  A.beamStyle = function (stage) { return BEAM[Math.max(0, Math.min(3, stage | 0))]; }; // stroke styles for the per-frame beam
  A.beam = function (stage) {
    const S = Math.max(0, Math.min(3, stage | 0)), b = BEAM[S];
    return sprite(`beam|${S}`, 32, b.h, (g) => {
      const H = b.h, bw = H * 0.46;
      g.fillStyle = b.glow; g.fillRect(-16, -H / 2, 32, H);
      g.fillStyle = 'rgba(26,21,18,0.75)'; g.fillRect(-16, -bw / 2 - 0.9, 32, bw + 1.8); // dark edge keeps it readable on light ground
      g.fillStyle = b.body; g.fillRect(-16, -bw / 2, 32, bw);
      g.fillStyle = b.core; g.fillRect(-16, -b.cw / 2, 32, b.cw);
    });
  };
  A.beamHit = function (stage) {
    const S = Math.max(0, Math.min(3, stage | 0)), r = 5 + S * 2.6;
    return sprite(`bhit|${S}`, r * 2 + 4, r * 2 + 4, (g) => {
      const gr = g.createRadialGradient(0, 0, 0.5, 0, 0, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, S >= 2 ? '#ffe070' : '#ffb050'); gr.addColorStop(0.65, 'rgba(255,110,20,0.55)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = '#fff0a0'; g.lineWidth = 1.1;
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35); g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); g.stroke(); }
    });
  };
  /* Splitter burst: a star of molten cracks + white flash, drawn once and scaled by the client. */
  A.splitBurst = function () {
    return sprite('sburst', 64, 64, (g) => {
      const gr = g.createRadialGradient(0, 0, 1, 0, 0, 16);
      gr.addColorStop(0, 'rgba(255,255,240,0.95)'); gr.addColorStop(0.5, 'rgba(255,180,60,0.6)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fill();
      const rg = rng(91);
      for (let i = 0; i < 7; i++) {
        const a = i * 0.8976 + rg() * 0.3, r1 = 22 + rg() * 8, mid = r1 * 0.5, wob = (rg() - 0.5) * 6;
        const path = () => { g.beginPath(); g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); g.lineTo(Math.cos(a) * mid + Math.cos(a + 1.57) * wob, Math.sin(a) * mid + Math.sin(a + 1.57) * wob); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); };
        path(); g.strokeStyle = OUT; g.lineWidth = 4.2; g.stroke();
        path(); g.strokeStyle = '#ff8a1a'; g.lineWidth = 2.6; g.stroke();
        path(); g.strokeStyle = '#ffe890'; g.lineWidth = 1.1; g.stroke();
      }
    });
  };
  A.rotates = function (type) { return type !== 'frost'; };
  A.pad = function (ownerColor, lvl, cell) {
    const s = Math.max(22, cell * 0.82), L = lvl || 0;
    return sprite(`pad|${ownerColor}|${L}|${s}`, s, s * 0.78, (g) => {
      const w = s * 0.5, h = s * 0.28;
      // light plinth disc so the anvil reads against dark basalt
      g.beginPath(); g.ellipse(0, h * 0.72, w * 0.95, h * 0.55, 0, 0, 7);
      g.fillStyle = 'rgba(255,230,170,0.55)'; g.fill();
      g.beginPath();
      g.moveTo(-w * 0.95, -h * 0.15);
      g.lineTo(-w * 0.2, -h * 0.7);
      g.lineTo(w * 0.55, -h * 0.7);
      g.lineTo(w * 0.95, -h * 0.1);
      g.lineTo(w * 0.35, -h * 0.1);
      g.lineTo(w * 0.28, h * 0.35);
      g.lineTo(w * 0.7, h * 0.85);
      g.lineTo(-w * 0.7, h * 0.85);
      g.lineTo(-w * 0.28, h * 0.35);
      g.lineTo(-w * 0.35, -h * 0.1);
      g.closePath();
      g.fillStyle = glossy(g, 0, -h * 0.2, s * 0.5, '#9a8e80'); g.fill();
      g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
      // bright top-face rim
      g.beginPath();
      g.moveTo(-w * 0.18, -h * 0.68);
      g.lineTo(w * 0.52, -h * 0.68);
      g.lineTo(w * 0.88, -h * 0.12);
      g.lineTo(-w * 0.32, -h * 0.12);
      g.closePath();
      g.strokeStyle = 'rgba(255,244,210,0.85)'; g.lineWidth = 2; g.stroke();
      // owner-color inlay on the face
      rrect(g, -w * 0.18, -h * 0.55, w * 0.55, h * 0.32, 1.2);
      g.fillStyle = ownerColor; g.fill();
      g.lineWidth = 1.2; g.strokeStyle = OUT; g.stroke();
      if (L > 0) { g.fillStyle = '#ffc44a'; for (let i = 0; i < L; i++) circ(g, -4 + i * 8, h * 0.55, 2.1, '#ffc44a', 1); }
    });
  };

  A.dart = function (gold) {
    return sprite(`dart|${gold ? 1 : 0}`, 18, 8, (g) => {
      g.strokeStyle = OUT; g.lineWidth = 3; g.beginPath(); g.moveTo(-7, 0); g.lineTo(5, 0); g.stroke();
      g.strokeStyle = gold ? '#c4923a' : '#6a6258'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.moveTo(4, -2.6); g.lineTo(9, 0); g.lineTo(4, 2.6); g.closePath();
      g.fillStyle = gold ? '#ffc44a' : '#c8d0d8'; g.fill(); g.lineWidth = 1; g.strokeStyle = OUT; g.stroke();
      g.fillStyle = gold ? '#ff8a20' : '#8a3a28';
      g.beginPath(); g.moveTo(-8.5, -2.6); g.lineTo(-5, 0); g.lineTo(-8.5, 2.6); g.closePath(); g.fill();
      g.lineWidth = 0.9; g.strokeStyle = OUT; g.stroke();
    });
  };
  A.ball = function () {
    return sprite('ball', 14, 14, (g) => {
      circ(g, 0, 0, 5, glossy(g, 0, 0, 5, '#ff8a20'), 1.5);
      g.beginPath(); g.arc(-1.2, -1.4, 2, 0, 7); g.fillStyle = 'rgba(255,245,180,0.8)'; g.fill();
    });
  };
  A.shard = function () {
    return sprite('shard', 12, 14, (g) => {
      g.beginPath(); g.moveTo(0, -6); g.lineTo(3.4, 0); g.lineTo(0, 6); g.lineTo(-3.4, 0); g.closePath();
      g.fillStyle = glossy(g, 0, 0, 5, '#7fe0ff'); g.fill();
      g.lineWidth = 1.3; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(0, -3); g.lineTo(0, 3);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.stroke();
    });
  };
  A.coin = function () {
    return sprite('coin', 16, 16, (g) => {
      circ(g, 0, 0, 6.3, glossy(g, 0, 0, 6.3, '#ffc44a'), 1.6);
      g.fillStyle = OUT; g.font = 'bold 9px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 0.6);
    });
  };
  A.heart = function () {
    return sprite('heart', 18, 16, (g) => {
      g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-9, -1, -5, -8, 0, -3.5); g.bezierCurveTo(5, -8, 9, -1, 0, 6); g.closePath();
      g.fillStyle = glossy(g, 0, 0, 6, '#c42818'); g.fill();
      g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke();
    });
  };

  function rng(seed) { let s = (seed || 1) >>> 0 || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  A.rng = rng;

  A.drawGrass = function (g, w, h, cell, seed) {
    const R = rng(seed);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#7eab6c');
    sky.addColorStop(0.55, '#6b9a5c');
    sky.addColorStop(1, '#5a8a4e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const cols = ['#74a062', '#6b9658', '#7eaa6c', '#649256'];
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        if (((x / cell + y / cell) | 0) % 2) {
          g.fillStyle = cols[(R() * cols.length) | 0];
          g.globalAlpha = 0.5;
          g.fillRect(x, y, cell + 1, cell + 1);
        }
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 90; i++) {
      const x = R() * w, y = R() * h, r = 4 + R() * 10;
      g.fillStyle = R() > 0.5 ? 'rgba(110,180,80,0.5)' : 'rgba(80,150,70,0.4)';
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, R() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 28; i++) {
      const x = R() * w, y = R() * h, s = 3 + R() * 5;
      g.beginPath();
      g.moveTo(x - s, y); g.lineTo(x - s * 0.3, y - s * 0.8); g.lineTo(x + s * 0.6, y - s * 0.5); g.lineTo(x + s, y + s * 0.2); g.lineTo(x, y + s * 0.5);
      g.closePath();
      g.fillStyle = R() > 0.5 ? '#2a3230' : '#5a6258'; g.fill();
      g.strokeStyle = '#1a1512'; g.lineWidth = 1; g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const x = R() * w, y = R() * h;
      g.fillStyle = 'rgba(255,120,30,0.55)';
      g.beginPath(); g.arc(x, y, 1.2 + R(), 0, 7); g.fill();
    }
  };

  A.drawPath = function (g, pts, cell) {
    if (!pts.length) return;
    const X = (p) => (p.x != null ? p.x : p[0]), Y = (p) => (p.y != null ? p.y : p[1]);
    const w = Math.max(18, cell * 0.58);
    const stroke = (width, style) => {
      g.beginPath(); g.moveTo(X(pts[0]), Y(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i]), Y(pts[i]));
      g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
    };
    // dark outer edge (luminance contrast vs the lighter moss, under every CVD filter)
    stroke(w + 12, '#1a120c');
    // molten-orange rune rim — the path preview reads at a glance
    stroke(w + 8, '#ff7a18');
    stroke(w + 5, '#ffc44a');
    // raised basalt body, still darker than the ground
    stroke(w, '#3a3028');
    stroke(w - 5, '#5a4a3c');
    stroke(Math.max(2.4, w * 0.18), 'rgba(255,170,50,0.7)');
    for (let i = 3; i < pts.length - 2; i += 3) {
      const p = pts[i], q = pts[i + 1] || p, dx = X(q) - X(p), dy = Y(q) - Y(p), len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      rune(g, X(p) + nx * (w * 0.28), Y(p) + ny * (w * 0.28), Math.max(3, cell * 0.11), '#ffc44a');
    }
    g.fillStyle = '#1a120c';
    g.strokeStyle = '#ffb020';
    g.lineWidth = 1.2;
    for (let i = 6; i < pts.length - 4; i += 5) {
      const p = pts[i], q = pts[i + 1], dx = X(q) - X(p), dy = Y(q) - Y(p), len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, s = Math.max(5.5, cell * 0.22);
      g.beginPath();
      g.moveTo(X(p) + ux * s, Y(p) + uy * s);
      g.lineTo(X(p) - uy * s * 0.7, Y(p) + ux * s * 0.7);
      g.lineTo(X(p) + uy * s * 0.7, Y(p) - ux * s * 0.7);
      g.closePath(); g.fill(); g.stroke();
    }
  };

  A.drawPortal = function (g, x, y, cell) {
    const r = cell * 0.46;
    g.save(); g.translate(x, y);
    circ(g, 0, 0, r + 3, '#2a2420', 0);
    circ(g, 0, 0, r, '#1a1512', 2.4);
    const melt = g.createRadialGradient(-r * 0.15, -r * 0.15, r * 0.1, 0, 0, r * 0.85);
    melt.addColorStop(0, '#fff0a0'); melt.addColorStop(0.35, '#ff8a20'); melt.addColorStop(0.75, '#8a2008'); melt.addColorStop(1, '#1a1010');
    circ(g, 0, 0, r * 0.78, melt, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rivet(g, Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), 1.7);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      rune(g, Math.cos(a) * (r + 6), Math.sin(a) * (r + 6), 3, 'rgba(255,180,60,0.8)');
    }
    g.restore();
  };

  A.drawCastle = function (g, x, y, cell, teamCol) {
    const s = cell, team = forgeTeam(teamCol);
    g.save(); g.translate(x, y);
    // keep body
    rrect(g, -s * 0.88, -s * 0.12, s * 1.76, s * 1.08, 4);
    g.fillStyle = glossy(g, 0, s * 0.3, s, '#4a4440'); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    // upper keep
    rrect(g, -s * 0.62, -s * 0.95, s * 1.24, s * 0.92, 3);
    g.fillStyle = glossy(g, 0, -s * 0.5, s * 0.8, '#3a3632'); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    // chimney
    rrect(g, s * 0.3, -s * 1.38, s * 0.3, s * 0.55, 2);
    g.fillStyle = glossy(g, s * 0.45, -s * 1.1, s * 0.3, '#2a2622'); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    g.beginPath(); g.ellipse(s * 0.45, -s * 1.4, s * 0.16, s * 0.08, 0, 0, 7);
    g.fillStyle = '#ff8a20'; g.fill();
    g.globalAlpha = 0.45;
    circ(g, s * 0.45, -s * 1.55, s * 0.16, '#ffb020', 0);
    circ(g, s * 0.52, -s * 1.7, s * 0.1, '#ff6a1a', 0);
    g.globalAlpha = 1;
    // team roof / cap
    g.beginPath();
    g.moveTo(-s * 0.7, -s * 0.9); g.lineTo(0, -s * 1.28); g.lineTo(s * 0.7, -s * 0.9); g.closePath();
    g.fillStyle = glossy(g, 0, -s * 1.05, s * 0.6, team.metal); g.fill();
    g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    // furnace door
    g.beginPath(); g.moveTo(-s * 0.28, s * 0.78); g.lineTo(-s * 0.28, s * 0.18); g.quadraticCurveTo(0, -s * 0.12, s * 0.28, s * 0.18); g.lineTo(s * 0.28, s * 0.78); g.closePath();
    const door = g.createLinearGradient(0, 0, 0, s * 0.78);
    door.addColorStop(0, '#ffc44a'); door.addColorStop(0.45, '#ff6a1a'); door.addColorStop(1, '#3a1008');
    g.fillStyle = door; g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    // banner
    g.fillStyle = team.metal;
    g.fillRect(s * 0.55, -s * 0.7, s * 0.08, s * 0.55);
    g.beginPath(); g.moveTo(s * 0.63, -s * 0.68); g.lineTo(s * 0.95, -s * 0.55); g.lineTo(s * 0.63, -s * 0.4); g.closePath();
    g.fill(); g.lineWidth = 1.4; g.strokeStyle = OUT; g.stroke();
    rivet(g, -s * 0.7, s * 0.15, 1.7); rivet(g, s * 0.7, s * 0.15, 1.7);
    rivet(g, -s * 0.45, -s * 0.55, 1.5); rivet(g, s * 0.45, -s * 0.55, 1.5);
    g.restore();
  };

  A.drawCastleLives = function (g, x, y, cell, lives, leak) {
    const s = cell, pw = Math.max(36, s * 1.05), ph = Math.max(16, s * 0.42);
    const py = y - s * 1.62, rad = Math.min(6, ph * 0.4);
    g.save();
    rrect(g, x - pw / 2, py, pw, ph, rad);
    g.fillStyle = leak ? '#3a1810' : '#2a2420'; g.fill();
    g.lineWidth = 2.2; g.strokeStyle = leak ? '#c42818' : OUT; g.stroke();
    g.font = `700 ${Math.max(11, s * 0.32)}px Fredoka, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = leak ? '#ffb0a0' : '#f0e6d4';
    g.fillText('❤ ' + lives, x, py + ph / 2 + 0.5);
    g.restore();
  };

  A.drawFrame = function (g, x, y, w, h) {
    const t = 9;
    g.save();
    g.beginPath();
    g.rect(x - t, y - t, w + t * 2, h + t * 2);
    rrect(g, x, y, w, h, 6);
    g.fillStyle = '#2a2420';
    g.fill('evenodd');
    g.beginPath();
    g.rect(x - 4, y - 4, w + 8, h + 8);
    rrect(g, x, y, w, h, 6);
    g.fillStyle = '#4a3020';
    g.fill('evenodd');
    rrect(g, x - 1, y - 1, w + 2, h + 2, 6);
    g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
    const spots = [
      [x - 5, y - 5], [x + w + 5, y - 5], [x - 5, y + h + 5], [x + w + 5, y + h + 5],
      [x + w / 2, y - 5], [x + w / 2, y + h + 5], [x - 5, y + h / 2], [x + w + 5, y + h / 2]
    ];
    for (const p of spots) rivet(g, p[0], p[1], 2.2);
    g.restore();
  };

  A.OUT = OUT; A.BALLOON = BALLOON;

  A.iconURL = function (spr, size, zoom) {
    const s = size || 40, z = zoom || 1, pad = 2;
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d');
    const cx = s / 2, cy = s / 2, pr = s * 0.48;
    const bg = g.createRadialGradient(cx, cy - 1, 1, cx, cy, pr);
    bg.addColorStop(0, '#fff3c8');
    bg.addColorStop(0.55, '#f0b44a');
    bg.addColorStop(1, 'rgba(180,90,20,0)');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy + 1, pr, 0, 7); g.fill();
    g.strokeStyle = 'rgba(26,21,18,0.55)'; g.lineWidth = 1.2; g.stroke();
    const sc = Math.min((s - pad * 2) / spr.w, (s - pad * 2) / spr.h) * z;
    g.drawImage(spr.c, (s - spr.w * sc) / 2, (s - spr.h * sc) / 2 - 1, spr.w * sc, spr.h * sc);
    return c.toDataURL();
  };

  A.paintOver = function (g, w, h, kind) {
    const mid = w / 2, cy = h * 0.58;
    g.clearRect(0, 0, w, h);
    if (kind === 'win') {
      const k = A.tower('arrow', 2); g.drawImage(k.c, mid - 110 - k.w / 2, cy - k.h / 2, k.w, k.h);
      const c = A.tower('cannon', 2); g.drawImage(c.c, mid - c.w / 2, cy - c.h / 2 - 6, c.w, c.h);
      const f = A.tower('frost', 2); g.drawImage(f.c, mid + 110 - f.w / 2, cy - f.h / 2, f.w, f.h);
      const starSpr = A.creep('runner', 3, 16);
      g.drawImage(starSpr.c, mid - 50 - starSpr.w / 2, 8, starSpr.w, starSpr.h);
      g.drawImage(starSpr.c, mid + 50 - starSpr.w / 2, 8, starSpr.w, starSpr.h);
    } else if (kind === 'lose') {
      const b = A.creep('boss', 0, 22); g.drawImage(b.c, mid - b.w / 2, cy - b.h / 2 - 4, b.w, b.h);
      const r = A.creep('brute', 3, 14); g.drawImage(r.c, mid - 80 - r.w / 2, cy - r.h / 2 + 8, r.w, r.h);
      const s = A.creep('swarm', 3, 12); g.drawImage(s.c, mid + 80 - s.w / 2, cy - s.h / 2 + 10, s.w, s.h);
    } else {
      const a = A.tower('arrow', 1); g.drawImage(a.c, mid - 70 - a.w / 2, cy - a.h / 2, a.w, a.h);
      const r = A.creep('runner', 2, 14); g.drawImage(r.c, mid + 70 - r.w / 2, cy - r.h / 2, r.w, r.h);
    }
  };

  A.warmup = function (cell) {
    const C = cell || 32;
    const kinds = ['neutral', 'runner', 'brute', 'swarm', 'boss', 'splitter', 'shard'];
    for (const k of kinds) {
      const vmax = k === 'neutral' ? 8 : k === 'boss' ? 1 : 4;
      const vmin = k === 'neutral' ? 1 : 0;
      for (let v = vmin; v < vmin + vmax; v++) {
        const R = k === 'splitter' ? A.creepR(k, 0.3, C) : k === 'shard' ? A.creepR(k, 0.15, C) : A.creepR(k, k === 'boss' ? 1.1 : 1, C);
        A.creep(k, v, R); A.creepFlash(R); A.creepIce(R); A.shadow(R);
      }
    }
    for (const t of ['arrow', 'cannon', 'frost', 'smelter']) for (let l = 0; l < 3; l++) A.tower(t, l);
    for (const k of ['splitter', 'shard']) { const R = A.creepR(k, k === 'splitter' ? 0.3 : 0.15, C); A.creep(k, 99, R); A.creepFlash(R); A.creepIce(R); A.creepIceLite(R); A.shadow(R); }
    for (let h = 0; h < 4; h++) A.beamHit(h);
    A.splitBurst();
    A.pad('#c4923a', 0, C); A.pad('#7a96aa', 0, C);
    A.dart(false); A.dart(true); A.ball(); A.shard(); A.coin(); A.heart();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { try { A.warmup(32); } catch (e) { /* headless / no canvas */ } });

  root.ART = A;
})(typeof window !== 'undefined' ? window : globalThis);
