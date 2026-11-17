// Forge TD art: every sprite is drawn procedurally on canvas (no image assets), cached in offscreen canvases.
// Style: bright cartoon, thick dark outlines, glossy highlights, soft shadows. Original designs ("inspired by"
// classic cartoon tower defense, no third-party assets, names or logos).
(function (root) {
  const S = root.SHARED;
  const OUT = '#26203a';           // outline colour
  const SS = 3;                    // sprite supersampling (crisp on hi-dpi screens and when scaled)
  const A = {};
  const cache = new Map();

  // ---------- colour helpers ----------
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(c, k) { // k in -1..1: darken / lighten
    const [r, g, b] = hex(c); const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  A.shade = shade;
  function sprite(key, w, h, draw) {
    let s = cache.get(key); if (s) return s;
    const c = document.createElement('canvas'); c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
    const g = c.getContext('2d'); g.scale(SS, SS); g.translate(w / 2, h / 2); g.lineJoin = 'round'; g.lineCap = 'round';
    draw(g);
    s = { c, w, h }; cache.set(key, s); return s;
  }
  A.sprite = sprite;
  function circ(g, x, y, r, fill, lw, stroke) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (lw) { g.lineWidth = lw; g.strokeStyle = stroke || OUT; g.stroke(); }
  }
  function glossy(g, x, y, r, col) {
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    gr.addColorStop(0, shade(col, 0.45)); gr.addColorStop(0.5, col); gr.addColorStop(1, shade(col, -0.3));
    return gr;
  }
  function shine(g, x, y, r) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(x - r * 0.38, y - r * 0.46, r * 0.27, r * 0.15, -0.6, 0, 7); g.fill(); }
  // Cached unit-star coordinates so per-frame particle stars skip trig (hot path: pops/flakes/muzzles).
  // A.star() still builds the current path so existing fill/stroke call sites keep working.
  const STAR_PTS = new Map();
  function starPts(n, inner) {
    const inn = inner == null ? 0.5 : inner, key = n + ':' + inn;
    let p = STAR_PTS.get(key);
    if (!p) {
      p = new Float64Array(n * 4);
      for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? inn : 1; p[i * 2] = Math.cos(a) * rr; p[i * 2 + 1] = Math.sin(a) * rr; }
      STAR_PTS.set(key, p);
    }
    return p;
  }
  function star(g, x, y, r, n, inner) {
    const p = starPts(n, inner);
    g.beginPath(); g.moveTo(x + p[0] * r, y + p[1] * r);
    for (let i = 2; i < p.length; i += 2) g.lineTo(x + p[i] * r, y + p[i + 1] * r);
    g.closePath();
  }
  A.star = star;
  // Pre-rendered white 8-point star (and a few others) for callers that can drawImage instead of path-fill.
  A.starSpr = function (n, inner, fill, stroke, r) {
    const rr = r || 12, inn = inner == null ? 0.45 : inner, f = fill || '#fff', k = `ss|${n}|${inn}|${f}|${stroke || ''}|${rr}`;
    return sprite(k, rr * 2 + 6, rr * 2 + 6, (g) => {
      star(g, 0, 0, rr, n, inn);
      g.fillStyle = f; g.fill();
      if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
    });
  };
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  A.rrect = rrect;

  // ---------- creeps ----------
  const BALLOON = ['#ff4d4d', '#3d9bff', '#3fd16a', '#ffd23f', '#ff6fd0', '#ff9733', '#9d6bff', '#25d9c9'];
  // Tier colours separated by luminance (dark / mid / bright), not just hue — holds up in deutan, tritan and grayscale.
  const TIER_RING = [null, '#3a2416', '#8a96aa', '#fff6a8'];
  // Type colours also split by luminance: runners stay light, swarms stay dark (so T3 yellow vs pink still differ under tritanopia).
  const KIND = {
    runner: ['#9aee6a', '#4edc6a', '#ffc44a', '#fff38a'],
    swarm: ['#5a2fa0', '#4a1e90', '#8a1868', '#6a0e50'],
    brute: ['#ff6b5b', '#e8453c', '#c42a3a', '#8e1428'],
  };
  A.creepColor = function (kind, v) {
    if (kind === 'neutral') return BALLOON[((v || 1) - 1) % BALLOON.length];
    if (kind === 'boss') return '#7c3aed';
    const k = KIND[kind]; return k ? k[Math.min(3, v || 0)] : '#ccc';
  };
  // visual radius (px) for a creep with sim radius r (cells)
  A.creepR = function (kind, r, cell) { return Math.max(kind === 'swarm' ? 7 : 5.5, r * cell * (kind === 'swarm' ? 1.7 : kind === 'boss' ? 1.25 : 1.4)); };

  function eyes(g, R, angry, look) {
    const ex = R * 0.33, ey = -R * 0.08, er = Math.max(1.5, R * 0.28);
    if (R < 6) { circ(g, -ex, ey, Math.max(1.15, R * 0.2), OUT); circ(g, ex, ey, Math.max(1.15, R * 0.2), OUT); }
    else {
      for (const s of [-1, 1]) {
        circ(g, s * ex, ey, er, '#fff', Math.max(0.9, R * 0.08));
        circ(g, s * ex + (look || 0) * er * 0.25, ey + er * 0.22, er * 0.52, OUT);
        circ(g, s * ex - er * 0.18, ey - er * 0.12, er * 0.2, '#fff');
      }
    }
    if (angry) {
      g.strokeStyle = OUT; g.lineWidth = Math.max(1.3, R * 0.16);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * (ex + er * 1.05), ey - er * 1.3); g.lineTo(s * (ex - er * 0.7), ey - er * 0.5); g.stroke(); }
    }
  }
  function mouth(g, R, kind) {
    g.strokeStyle = OUT; g.lineWidth = Math.max(1, R * 0.11);
    if (kind === 'angry') { g.fillStyle = OUT; g.beginPath(); g.ellipse(0, R * 0.42, R * 0.28, R * 0.14, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(-R * 0.16, R * 0.32, R * 0.32, R * 0.08); }
    else if (kind === 'grin') { g.beginPath(); g.arc(0, R * 0.18, R * 0.32, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
    else { g.beginPath(); g.arc(0, R * 0.2, R * 0.22, 0.12 * Math.PI, 0.88 * Math.PI); g.stroke(); }
  }
  function body(g, R, col, lw, kind) {
    // Distinct silhouettes so types still read when hue collapses (tall runner, flat swarm, round brute).
    g.beginPath();
    if (kind === 'runner') g.ellipse(0, -R * 0.04, R * 0.82, R * 1.06, 0, 0, Math.PI * 2);
    else if (kind === 'swarm') g.ellipse(0, R * 0.08, R * 1.1, R * 0.8, 0, 0, Math.PI * 2);
    else g.ellipse(0, 0, R, R * 0.95, 0, 0, Math.PI * 2);
    g.fillStyle = glossy(g, 0, 0, R, col); g.fill(); g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
  }
  function wing(g, R, s) {
    g.save(); g.translate(s * R * 0.98, -R * 0.1); g.scale(s, 1); g.rotate(-0.35);
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(R * 0.55, -R * 0.75, R * 0.85, -R * 0.35); g.quadraticCurveTo(R * 0.6, -R * 0.1, R * 0.7, R * 0.15); g.quadraticCurveTo(R * 0.35, R * 0.1, 0, R * 0.2); g.closePath();
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(0.9, R * 0.1); g.strokeStyle = OUT; g.stroke(); g.restore();
  }
  // Colorblind-friendly tier language: shape (not just bronze/silver/gold colour).
  // T1 = single ring + triangle pip, T2 = double ring + diamond, T3 = spiked ring + star.
  function tierRing(g, R, tier, lw) {
    const col = TIER_RING[tier];
    if (tier === 1) {
      // dark, thick single ring
      circ(g, 0, 0, R + lw * 1.85, null, Math.max(2.2, lw * 1.55), col);
      circ(g, 0, 0, R + lw * 2.55, null, Math.max(0.8, lw * 0.45), OUT);
    } else if (tier === 2) {
      // mid-luminance double ring
      circ(g, 0, 0, R + lw * 1.5, null, Math.max(1.3, lw * 0.9), col);
      circ(g, 0, 0, R + lw * 2.4, null, Math.max(1.5, lw * 1.05), col);
      circ(g, 0, 0, R + lw * 3.0, null, Math.max(0.8, lw * 0.45), OUT);
    } else if (tier === 3) {
      // very bright, thick spiked ring with a dark outline
      const rr = R + lw * 2.05, spikes = 8, pts = starPts(spikes, 0.86);
      g.beginPath(); g.moveTo(pts[0] * rr, pts[1] * rr);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * rr, pts[i + 1] * rr);
      g.closePath();
      g.strokeStyle = OUT; g.lineWidth = Math.max(3.2, lw * 1.8); g.stroke();
      g.strokeStyle = col; g.lineWidth = Math.max(2.2, lw * 1.25); g.stroke();
    }
  }
  function tierBadge(g, R, tier, lw) {
    if (!tier) return;
    const col = TIER_RING[tier], bx = R * 0.88, by = R * 0.92, br = Math.max(4.4, R * 0.5);
    circ(g, bx, by, br + 0.7, '#fff8e6', Math.max(1.1, lw * 0.65));
    g.fillStyle = col; g.strokeStyle = OUT; g.lineWidth = Math.max(1.15, lw * 0.65);
    if (tier === 1) { // triangle
      g.beginPath(); g.moveTo(bx, by - br * 0.78); g.lineTo(bx + br * 0.78, by + br * 0.55); g.lineTo(bx - br * 0.78, by + br * 0.55); g.closePath();
    } else if (tier === 2) { // diamond
      g.beginPath(); g.moveTo(bx, by - br * 0.82); g.lineTo(bx + br * 0.78, by); g.lineTo(bx, by + br * 0.82); g.lineTo(bx - br * 0.78, by); g.closePath();
    } else { star(g, bx, by, br * 0.82, 5, 0.45); }
    g.fill(); g.stroke();
  }
  function drawCreep(g, kind, v, R) {
    const col = A.creepColor(kind, v), lw = Math.max(1.5, R * 0.2), tier = kind === 'neutral' || kind === 'boss' ? 0 : Math.min(3, v || 0);
    tierRing(g, R, tier, lw);
    if (kind === 'runner') { // pointed tail + T2+ wings: tall balloon silhouette
      g.beginPath(); g.moveTo(-R * 0.22, R * 0.9); g.lineTo(0, R * 1.45); g.lineTo(R * 0.22, R * 0.9); g.closePath();
      g.fillStyle = shade(col, -0.2); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      if (tier >= 2) { wing(g, R, -1); wing(g, R, 1); }
    }
    if (kind === 'neutral') { // balloon knot + string nub
      g.beginPath(); g.moveTo(0, R * 0.85); g.lineTo(-R * 0.24, R * 1.28); g.lineTo(R * 0.24, R * 1.28); g.closePath(); g.fillStyle = shade(col, -0.25); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      g.strokeStyle = shade(col, -0.35); g.lineWidth = Math.max(0.8, lw * 0.45); g.beginPath(); g.moveTo(0, R * 1.28); g.quadraticCurveTo(R * 0.12, R * 1.55, 0, R * 1.7); g.stroke();
    }
    if (kind === 'boss') { // horns
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * R * 0.35, -R * 0.75); g.quadraticCurveTo(s * R * 0.95, -R * 1.25, s * R * 0.95, -R * 1.45); g.quadraticCurveTo(s * R * 0.75, -R * 0.95, s * R * 0.75, -R * 0.5); g.closePath(); g.fillStyle = '#fff3d6'; g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke(); }
    }
    if (kind === 'swarm') { // antennae on every tier — the swarm silhouette (previously only T2+ and ~7 px)
      g.strokeStyle = OUT; g.lineWidth = Math.max(1.6, lw * 0.85);
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(s * R * 0.3, -R * 0.55); g.quadraticCurveTo(s * R * 0.7, -R * 1.45, s * R * 1.05, -R * 1.7); g.stroke();
        circ(g, s * R * 1.05, -R * 1.7, Math.max(2.4, R * 0.32), '#ffe14a', Math.max(1, lw * 0.55));
      }
    }
    body(g, R, col, lw, kind);
    if (kind === 'swarm') { // dark belly bands — readable when pink hue collapses
      g.save(); g.beginPath(); g.ellipse(0, R * 0.08, R * 1.1, R * 0.8, 0, 0, 7); g.clip();
      g.strokeStyle = 'rgba(38,32,58,0.5)'; g.lineWidth = Math.max(2, R * 0.24);
      for (const y of [-R * 0.12, R * 0.22]) { g.beginPath(); g.moveTo(-R * 1.2, y); g.lineTo(R * 1.2, y); g.stroke(); }
      g.restore();
    }
    if (kind === 'brute' && tier >= 2) { // shoulder armour plates
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * R * 0.82, R * 0.28, R * 0.34, R * 0.42, s * 0.4, 0, 7); g.fillStyle = tier === 3 ? '#ffd23a' : '#c9d3df'; g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke(); }
    }
    shine(g, 0, 0, R);
    const angry = kind === 'brute' || kind === 'boss';
    eyes(g, R, angry, 0);
    mouth(g, R, angry ? 'angry' : kind === 'runner' ? 'grin' : 'smile');
    // accessories
    if (kind === 'runner' && tier >= 1 && tier < 3) { // headband
      g.strokeStyle = '#ff3b3b'; g.lineWidth = R * 0.26; g.beginPath(); g.arc(0, R * 0.55, R * 1.05, -Math.PI * 0.78, -Math.PI * 0.22); g.stroke();
      g.lineWidth = R * 0.16; g.beginPath(); g.moveTo(R * 0.8, -R * 0.42); g.lineTo(R * 1.25, -R * 0.2); g.moveTo(R * 0.8, -R * 0.42); g.lineTo(R * 1.2, -R * 0.55); g.stroke();
    }
    if (kind === 'runner' && tier === 3) { // golden winged helmet with lightning bolt
      g.beginPath(); g.arc(0, -R * 0.15, R * 0.98, Math.PI * 1.08, Math.PI * 1.92); g.closePath(); g.fillStyle = glossy(g, 0, -R * 0.6, R * 0.8, '#ffd23a'); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(R * 0.1, -R * 1.0); g.lineTo(-R * 0.15, -R * 0.62); g.lineTo(R * 0.05, -R * 0.62); g.lineTo(-R * 0.12, -R * 0.3); g.lineTo(R * 0.25, -R * 0.72); g.lineTo(R * 0.05, -R * 0.72); g.closePath(); g.fillStyle = '#fff'; g.fill();
    }
    if (kind === 'swarm' && tier === 1) { // bigger bow, sits between the antennae
      g.fillStyle = '#ff7ac0'; g.strokeStyle = OUT; g.lineWidth = Math.max(1.1, lw * 0.6);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, -R * 0.55); g.lineTo(s * R * 0.7, -R * 1.05); g.lineTo(s * R * 0.7, -R * 0.2); g.closePath(); g.fill(); g.stroke(); }
      circ(g, 0, -R * 0.55, Math.max(2, R * 0.22), '#ff7ac0', Math.max(1, lw * 0.55));
    }
    if (kind === 'swarm' && tier === 3) { // bigger crown
      g.beginPath(); g.moveTo(-R * 0.7, -R * 0.45); g.lineTo(-R * 0.78, -R * 1.15); g.lineTo(-R * 0.32, -R * 0.8); g.lineTo(0, -R * 1.3); g.lineTo(R * 0.32, -R * 0.8); g.lineTo(R * 0.78, -R * 1.15); g.lineTo(R * 0.7, -R * 0.45); g.closePath();
      g.fillStyle = '#fff6a8'; g.fill(); g.lineWidth = Math.max(1.2, lw * 0.65); g.strokeStyle = OUT; g.stroke();
    }
    if (kind === 'brute' && tier === 1) { // sticking plaster
      g.save(); g.translate(R * 0.42, -R * 0.55); g.rotate(0.6); g.fillStyle = '#ffe0b3'; g.fillRect(-R * 0.3, -R * 0.1, R * 0.6, R * 0.2); g.lineWidth = Math.max(0.7, lw * 0.4); g.strokeStyle = OUT; g.strokeRect(-R * 0.3, -R * 0.1, R * 0.6, R * 0.2); g.restore();
    }
    if (kind === 'brute' && tier >= 2) { // helmet (steel, gold with spikes at tier 3)
      const hc = tier === 3 ? '#ffd23a' : '#c9d3df';
      if (tier === 3) for (const x of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(R * (x - 0.15), -R * 0.8); g.lineTo(R * x, -R * (x === 0 ? 1.5 : 1.3)); g.lineTo(R * (x + 0.15), -R * 0.8); g.closePath(); g.fillStyle = '#fff6d0'; g.fill(); g.lineWidth = lw * 0.6; g.strokeStyle = OUT; g.stroke(); }
      g.beginPath(); g.arc(0, -R * 0.12, R * 0.98, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fillStyle = glossy(g, 0, -R * 0.6, R * 0.8, hc); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = OUT; g.stroke();
      for (const x of [-0.55, 0, 0.55]) circ(g, R * x, -R * 0.42, Math.max(0.7, R * 0.07), OUT);
    }
    if (kind === 'boss') { circ(g, 0, 0, R + lw * 1.7, null, lw * 1.2, '#ffd23a'); }
    tierBadge(g, R, tier, lw);
  }
  // cached creep sprite: {c,w,h}; draw centred at the creep position with size w x h
  A.creep = function (kind, v, R) {
    const Rq = Math.round(R * 2) / 2, vk = kind === 'neutral' ? ((v || 1) - 1) % BALLOON.length : kind === 'boss' ? 0 : Math.min(3, v || 0);
    const size = Rq * 4.6 + 12;
    return sprite(`c|${kind}|${vk}|${Rq}`, size, size, (g) => drawCreep(g, kind, kind === 'neutral' ? vk + 1 : vk, Rq));
  };
  // hit flash: a soft white rim so the face stays readable
  A.creepFlash = function (R) {
    const Rq = Math.round(R * 2) / 2, size = Rq * 2.6 + 6;
    return sprite(`cf|${Rq}`, size, size, (g) => {
      circ(g, 0, 0, Rq + 1.2, 'rgba(255,255,255,0.55)', Math.max(1.6, Rq * 0.22), 'rgba(255,255,255,0.95)');
    });
  };
  A.creepIce = function (R) {
    const Rq = Math.round(R * 2) / 2, size = Rq * 2 + 8;
    return sprite(`ci|${Rq}`, size, size, (g) => {
      circ(g, 0, 0, Rq + 1, 'rgba(150,225,255,0.14)', Math.max(1, Rq * 0.09), 'rgba(200,240,255,0.75)');
      g.fillStyle = 'rgba(255,255,255,0.85)'; star(g, Rq * 0.55, -Rq * 0.6, Math.max(1.5, Rq * 0.28), 4, 0.35); g.fill();
    });
  };
  A.shadow = function (R) { const Rq = Math.round(R * 2) / 2, w = Rq * 2.4, h = Rq * 1.1; return sprite(`sh|${Rq}`, w, h, (g) => { g.fillStyle = 'rgba(20,40,10,0.28)'; g.beginPath(); g.ellipse(0, 0, Rq * 1.05, Rq * 0.42, 0, 0, 7); g.fill(); }); };

  // ---------- towers (drawn facing up = -y; the client rotates archers and cannons toward their target) ----------
  const SKIN = '#ffd3a1';
  function archer(g, L) {
    const hood = ['#9a6a3a', '#2f9e44', '#5b3fd1'][L], r = 9 + L * 0.8, lw = 1.9;
    if (L === 2) { g.beginPath(); g.moveTo(-r * 0.9, 0); g.quadraticCurveTo(-r * 1.25, r * 1.4, 0, r * 1.55); g.quadraticCurveTo(r * 1.25, r * 1.4, r * 0.9, 0); g.closePath(); g.fillStyle = '#e23b3b'; g.fill(); g.lineWidth = lw; g.strokeStyle = OUT; g.stroke(); }
    if (L >= 1) { // quiver with arrows on the back
      g.save(); g.translate(r * 0.55, r * 0.55); g.rotate(0.5);
      for (const x of [-2, 0, 2]) { g.strokeStyle = OUT; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 7.5); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x - 1.3, 7.5); g.lineTo(x, 10); g.lineTo(x + 1.3, 7.5); g.closePath(); g.fill(); g.stroke(); }
      rrect(g, -3.5, -2, 7, 8, 2); g.fillStyle = '#8b4a24'; g.fill(); g.lineWidth = 1.3; g.strokeStyle = OUT; g.stroke(); g.restore();
    }
    // hood / body
    g.beginPath(); g.moveTo(0, r * 1.35); g.quadraticCurveTo(-r * 0.4, r * 0.9, -r, 0); g.arc(0, 0, r, Math.PI, 0); g.quadraticCurveTo(r * 0.4, r * 0.9, 0, r * 1.35); g.closePath();
    g.fillStyle = glossy(g, 0, 0, r, hood); g.fill(); g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
    // face peeking out of the hood
    circ(g, 0, -r * 0.18, r * 0.62, SKIN, 1.4);
    for (const s of [-1, 1]) { circ(g, s * r * 0.24, -r * 0.28, 1.85, '#fff', 0.85); circ(g, s * r * 0.24, -r * 0.22, 1.05, OUT); circ(g, s * r * 0.18, -r * 0.34, 0.45, '#fff'); }
    g.strokeStyle = OUT; g.lineWidth = 1.05; g.beginPath(); g.arc(0, -r * 0.02, r * 0.22, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    if (L >= 1) { g.beginPath(); g.moveTo(r * 0.55, -r * 0.65); g.quadraticCurveTo(r * 1.35, -r * 1.25, r * 1.1, -r * 0.25); g.quadraticCurveTo(r * 0.9, -r * 0.6, r * 0.55, -r * 0.65); g.fillStyle = L === 2 ? '#ffd23a' : '#ff5a4f'; g.fill(); g.lineWidth = 1.15; g.strokeStyle = OUT; g.stroke(); } // feather
    if (L === 2) { g.beginPath(); g.moveTo(-r * 0.5, -r * 0.72); g.lineTo(-r * 0.55, -r * 1.2); g.lineTo(-r * 0.22, -r * 0.95); g.lineTo(0, -r * 1.3); g.lineTo(r * 0.22, -r * 0.95); g.lineTo(r * 0.55, -r * 1.2); g.lineTo(r * 0.5, -r * 0.72); g.closePath(); g.fillStyle = '#ffd23a'; g.fill(); g.lineWidth = 1.15; g.strokeStyle = OUT; g.stroke(); }
    // bow in front, arrow nocked
    const by = -r - 2.5 - L, bw = r * (1.05 + L * 0.12), bowCol = ['#a0522d', '#7a3e12', '#ffcf33'][L];
    g.strokeStyle = OUT; g.lineWidth = 4.2; g.beginPath(); g.arc(0, by + bw * 0.55, bw, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
    g.strokeStyle = bowCol; g.lineWidth = 2.4; g.beginPath(); g.arc(0, by + bw * 0.55, bw, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
    const ex = Math.cos(Math.PI * 1.18) * bw, ey = by + bw * 0.55 + Math.sin(Math.PI * 1.18) * bw;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(ex, ey); g.lineTo(0, by + 3.5); g.lineTo(-ex, ey); g.stroke();
    g.strokeStyle = OUT; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, by + 4); g.lineTo(0, by - 6); g.stroke();
    g.fillStyle = L === 2 ? '#ffd23a' : '#dfe6ee'; g.beginPath(); g.moveTo(-2.2, by - 5); g.lineTo(0, by - 9); g.lineTo(2.2, by - 5); g.closePath(); g.fill(); g.lineWidth = 1; g.stroke();
    for (const s of [-1, 1]) circ(g, s * 3.2, by + 2.5, 2, SKIN, 1); // hands
  }
  function cannon(g, L) {
    const r = 10 + L * 0.8, lw = 1.9;
    // wooden turntable base
    circ(g, 0, 0, r, glossy(g, 0, 0, r, '#b5733f'), lw);
    g.strokeStyle = 'rgba(70,35,10,0.45)'; g.lineWidth = 1; for (const y of [-r * 0.45, 0, r * 0.45]) { g.beginPath(); g.moveTo(-r * 0.85, y); g.lineTo(r * 0.85, y); g.stroke(); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; circ(g, Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 1.1, '#ffe3a1', 0.6); }
    const barrels = L === 2 ? [-4.3, 4.3] : [0];
    const bw = L === 0 ? 8 : L === 1 ? 9.5 : 7.5, bl = 15 + L * 1.5, bc = L === 2 ? '#d93b3b' : '#3a3f5c';
    for (const x of barrels) {
      rrect(g, x - bw / 2, -bl, bw, bl + 3, bw * 0.35);
      const gr = g.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0); gr.addColorStop(0, shade(bc, -0.35)); gr.addColorStop(0.35, shade(bc, 0.35)); gr.addColorStop(1, shade(bc, -0.2));
      g.fillStyle = gr; g.fill(); g.lineWidth = lw; g.strokeStyle = OUT; g.stroke();
      rrect(g, x - bw / 2 - 1.3, -bl - 1, bw + 2.6, 4.2, 1.6); g.fillStyle = L ? '#ffd23a' : '#5b6380'; g.fill(); g.lineWidth = 1.4; g.stroke(); // muzzle ring
      if (L >= 1) { g.fillStyle = '#ffd23a'; g.fillRect(x - bw / 2 + 0.6, -bl * 0.45, bw - 1.2, 2.2); }
      circ(g, x, -bl + 1, bw * 0.24, '#14121f');
    }
    circ(g, 0, 2, r * 0.48, glossy(g, 0, 2, r * 0.48, bc), 1.5); // hub
    if (L >= 1) { // bomb with fuse sitting on the base
      circ(g, -r * 0.62, r * 0.55, 3.4, glossy(g, -r * 0.62, r * 0.55, 3.4, '#2b2d42'), 1.2);
      g.strokeStyle = '#c98b3b'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-r * 0.62 + 1.8, r * 0.55 - 2.6); g.quadraticCurveTo(-r * 0.3, r * 0.1, -r * 0.35, r * 0.05); g.stroke();
      g.fillStyle = '#ffd23a'; star(g, -r * 0.35, r * 0.05, 2, 5, 0.45); g.fill();
    }
  }
  function snowman(g, L) {
    const lw = 1.85, s = 1 + L * 0.08;
    g.save(); g.scale(s, s);
    if (L === 2) { g.fillStyle = 'rgba(150,225,255,0.32)'; star(g, 0, -1, 15, 6, 0.55); g.fill(); }
    circ(g, 0, 5.2, 8.8, glossy(g, 0, 5.2, 8.8, '#ffffff'), lw);
    for (const y of [2.6, 6.2]) circ(g, 0, y, 1.05, OUT);
    // stick arms so the silhouette reads as a snowman even at button size
    g.strokeStyle = OUT; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-8, 3); g.lineTo(-13.5, -1.5); g.moveTo(8, 3); g.lineTo(13.5, -1.5); g.stroke();
    g.strokeStyle = '#8b5a2b'; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(-8, 3); g.lineTo(-13.5, -1.5); g.moveTo(8, 3); g.lineTo(13.5, -1.5); g.stroke();
    if (L >= 1) { // staff with crystal
      g.strokeStyle = OUT; g.lineWidth = 2.6; g.beginPath(); g.moveTo(8, 10); g.lineTo(11, -6); g.stroke(); g.strokeStyle = '#8b5a2b'; g.lineWidth = 1.4; g.stroke();
      g.beginPath(); g.moveTo(11, -12); g.lineTo(14, -6.5); g.lineTo(11, -2.5); g.lineTo(8, -6.5); g.closePath(); g.fillStyle = glossy(g, 11, -7, 4, '#5fd4ff'); g.fill(); g.lineWidth = 1.2; g.strokeStyle = OUT; g.stroke();
    }
    circ(g, 0, -6.1, 6.5, glossy(g, 0, -6.1, 6.5, '#ffffff'), lw);
    if (L >= 1) { // scarf
      g.fillStyle = L === 2 ? '#3d6dff' : '#2ab3ff'; rrect(g, -6.4, -1.9, 12.8, 3.5, 1.6); g.fill(); g.lineWidth = 1.15; g.strokeStyle = OUT; g.stroke();
      rrect(g, 1.5, -0.5, 3.2, 6, 1.2); g.fill(); g.stroke();
    }
    for (const x of [-2.3, 2.3]) circ(g, x, -7.1, 1.25, OUT);
    g.fillStyle = '#ff8a1f'; g.beginPath(); g.moveTo(-0.3, -5.5); g.lineTo(5.2, -4.4); g.lineTo(-0.3, -3.6); g.closePath(); g.fill(); g.lineWidth = 0.85; g.strokeStyle = OUT; g.stroke();
    // hat / crystals on the head
    if (L === 0) { g.beginPath(); g.moveTo(0, -16.2); g.lineTo(2.8, -12.2); g.lineTo(0, -10.6); g.lineTo(-2.8, -12.2); g.closePath(); g.fillStyle = glossy(g, 0, -13, 3, '#5fd4ff'); g.fill(); g.lineWidth = 1.15; g.strokeStyle = OUT; g.stroke(); }
    else {
      const sp = L === 2 ? [[-4.5, -15.5], [0, -19], [4.5, -15.5]] : [[-3, -14.5], [3, -14.5]];
      for (const [x, y] of sp) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2.3, -11.2); g.lineTo(x - 2.3, -11.2); g.closePath(); g.fillStyle = glossy(g, x, y + 2, 3, L === 2 ? '#9ff0ff' : '#5fd4ff'); g.fill(); g.lineWidth = 1.15; g.strokeStyle = OUT; g.stroke(); }
      rrect(g, -5.5, -12.2, 11, 2.6, 1.2); g.fillStyle = L === 2 ? '#ffd23a' : '#a8e6ff'; g.fill(); g.lineWidth = 1; g.strokeStyle = OUT; g.stroke();
    }
    g.restore();
  }
  A.tower = function (type, lvl) {
    const L = Math.max(0, Math.min(2, lvl | 0));
    return sprite(`t|${type}|${L}`, 46, 46, (g) => { if (type === 'arrow') archer(g, L); else if (type === 'cannon') cannon(g, L); else snowman(g, L); });
  };
  A.rotates = function (type) { return type !== 'frost'; };
  // stone pad under every tower, ringed in the owner's colour, with compact gold level pips (not large stars) so late boards stay readable
  A.pad = function (ownerColor, lvl, cell) {
    return sprite(`p|${ownerColor}|${lvl}|${cell}`, cell + 6, cell + 6, (g) => {
      g.fillStyle = 'rgba(20,40,10,0.28)'; g.beginPath(); g.ellipse(1.4, 2.6, cell * 0.46, cell * 0.36, 0, 0, 7); g.fill();
      circ(g, 0, 0, cell * 0.46, glossy(g, 0, 0, cell * 0.46, '#d9cfb8'), 1.8);
      circ(g, 0, 0, cell * 0.36, null, 2.5, ownerColor);
      g.strokeStyle = 'rgba(90,70,40,0.35)'; g.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; g.beginPath(); g.moveTo(Math.cos(a) * cell * 0.38, Math.sin(a) * cell * 0.38); g.lineTo(Math.cos(a) * cell * 0.45, Math.sin(a) * cell * 0.45); g.stroke(); }
      // compact pip row sitting on the pad, not sticking out past the cell
      const n = lvl + 1, pipR = 2.15, span = Math.min(cell * 0.28, (n - 1) * 5);
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? 0 : -span / 2 + (span / Math.max(1, n - 1)) * i, y = cell * 0.28;
        circ(g, x, y, pipR, '#ffd23a', 0.85);
      }
    });
  };
  // projectiles
  A.dart = function (gold) { return sprite(`dart|${gold ? 1 : 0}`, 16, 6, (g) => { g.strokeStyle = OUT; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-6, 0); g.lineTo(5, 0); g.stroke(); g.strokeStyle = '#a0522d'; g.lineWidth = 1.2; g.stroke(); g.fillStyle = gold ? '#ffd23a' : '#e9eef5'; g.beginPath(); g.moveTo(4, -2.4); g.lineTo(8, 0); g.lineTo(4, 2.4); g.closePath(); g.fill(); g.lineWidth = 0.9; g.strokeStyle = OUT; g.stroke(); g.fillStyle = '#ff5a4f'; g.beginPath(); g.moveTo(-7.5, -2.5); g.lineTo(-4.5, 0); g.lineTo(-7.5, 2.5); g.closePath(); g.fill(); }); };
  A.ball = function () { return sprite('ball', 12, 12, (g) => { circ(g, 0, 0, 4.2, glossy(g, 0, 0, 4.2, '#30324a'), 1.4); shine(g, 0, 0, 4.2); }); };
  A.shard = function () { return sprite('shard', 12, 12, (g) => { g.beginPath(); g.moveTo(0, -5); g.lineTo(3, 0); g.lineTo(0, 5); g.lineTo(-3, 0); g.closePath(); g.fillStyle = glossy(g, 0, 0, 4, '#7fe0ff'); g.fill(); g.lineWidth = 1.1; g.strokeStyle = OUT; g.stroke(); }); };
  A.coin = function () { return sprite('coin', 16, 16, (g) => { circ(g, 0, 0, 6.3, glossy(g, 0, 0, 6.3, '#ffcf33'), 1.6); g.fillStyle = OUT; g.font = 'bold 9px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 0.6); }); };
  A.heart = function () { return sprite('heart', 18, 16, (g) => { g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-9, -1, -5, -8, 0, -3.5); g.bezierCurveTo(5, -8, 9, -1, 0, 6); g.closePath(); g.fillStyle = glossy(g, 0, 0, 6, '#ff4d6d'); g.fill(); g.lineWidth = 1.5; g.strokeStyle = OUT; g.stroke(); }); };

  // ---------- board static art ----------
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  A.rng = rng;
  // grass field with subtle tile hints, tufts and flowers (drawn once per board into an offscreen canvas)
  A.drawGrass = function (g, w, h, cell, seed) {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8ada62'); gr.addColorStop(0.55, '#74c952'); gr.addColorStop(1, '#5fb346');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let r = 0; r < h / cell; r++) for (let c = 0; c < w / cell; c++) if ((r + c) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(c * cell, r * cell, cell, cell); }
    const R = rng(seed);
    for (let i = 0; i < 280; i++) { // grass tufts
      const x = R() * w, y = R() * h, s = 2 + R() * 2.6;
      g.strokeStyle = R() < 0.5 ? 'rgba(50,130,35,0.55)' : 'rgba(175,235,125,0.55)'; g.lineWidth = 1.15;
      g.beginPath(); g.moveTo(x - s * 0.6, y); g.lineTo(x - s * 0.95, y - s); g.moveTo(x, y); g.lineTo(x, y - s * 1.35); g.moveTo(x + s * 0.6, y); g.lineTo(x + s * 0.95, y - s); g.stroke();
    }
    for (let i = 0; i < 30; i++) { // flowers
      const x = R() * w, y = R() * h, col = ['#fff', '#ffe14a', '#ff8fd0', '#9ad7ff'][Math.floor(R() * 4)];
      g.fillStyle = col; for (let k = 0; k < 5; k++) { const a = k * 1.256; g.beginPath(); g.arc(x + Math.cos(a) * 1.7, y + Math.sin(a) * 1.7, 1.3, 0, 7); g.fill(); }
      g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(x, y, 0.95, 0, 7); g.fill();
    }
    for (let i = 0; i < 12; i++) { const x = R() * w, y = R() * h; g.fillStyle = 'rgba(40,110,30,0.16)'; g.beginPath(); g.ellipse(x, y, 8 + R() * 10, 4 + R() * 5, R() * 3, 0, 7); g.fill(); }
    // soft inner vignette so the wooden frame reads as a depth edge
    const vg = g.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.35, w * 0.5, h * 0.55, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,70,10,0.14)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  };
  // sandy dirt trail along the current shortest route (pts: [[x,y],...] in px)
  A.drawPath = function (g, pts, cell) {
    if (pts.length < 2) return;
    const line = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); };
    g.lineJoin = 'round'; g.lineCap = 'round';
    // Dark outer edge stays dark under deuteranopia (where grass and tan fill would otherwise match).
    line(cell * 0.98, '#2a1810');
    line(cell * 0.86, '#5a3218');
    line(cell * 0.68, '#c48948');
    line(cell * 0.24, 'rgba(255,230,180,0.55)');
    const R = rng(7);
    for (let i = 1; i < pts.length; i++) { // pebbles
      if (R() < 0.5) continue;
      const t = R(), x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t + (R() - 0.5) * cell * 0.35, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t + (R() - 0.5) * cell * 0.35;
      g.fillStyle = 'rgba(50,28,12,0.55)'; g.beginPath(); g.ellipse(x, y, 1.7, 1.15, R() * 3, 0, 7); g.fill();
    }
    // filled dark chevrons — luminance contrast, not hue
    g.fillStyle = '#2a1810'; g.strokeStyle = '#2a1810'; g.lineWidth = 1.2;
    for (let i = 2; i < pts.length - 1; i += 2) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]; const a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      g.save(); g.translate(mx, my); g.rotate(a);
      g.beginPath(); g.moveTo(-4, -5.5); g.lineTo(5, 0); g.lineTo(-4, 5.5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  };
  A.drawPortal = function (g, x, y, cell) {
    circ(g, x, y + 2, cell * 0.54, 'rgba(20,10,40,0.28)');
    circ(g, x, y, cell * 0.54, glossy(g, x - 2, y - 2, cell * 0.54, '#6a5478'), 2.2);
    circ(g, x, y, cell * 0.44, null, 3.4, '#3a2458');
    const gr = g.createRadialGradient(x, y, 1, x, y, cell * 0.4); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.22, '#f0c8ff'); gr.addColorStop(0.65, '#9a48ff'); gr.addColorStop(1, '#3d1578');
    circ(g, x, y, cell * 0.4, gr, 0);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [dx, dy, r] of [[-0.28, -0.22, 0.06], [0.26, -0.18, 0.045], [0.18, 0.26, 0.05], [-0.22, 0.2, 0.04]]) {
      star(g, x + dx * cell, y + dy * cell, cell * r, 4, 0.4); g.fill();
    }
  };
  A.drawCastle = function (g, x, y, cell, teamCol) {
    const w = cell * 1.05, h = cell * 0.95;
    const foot = y + cell * 0.42;
    g.fillStyle = 'rgba(20,40,10,0.32)'; g.beginPath(); g.ellipse(x + 2, foot + 1, w * 0.58, h * 0.18, 0, 0, 7); g.fill();
    g.lineWidth = 1.9; g.strokeStyle = OUT;
    // keep
    const ky = foot - h * 0.72, kh = h * 0.72;
    rrect(g, x - w * 0.34, ky, w * 0.68, kh, 2.2); g.fillStyle = glossy(g, x, ky + kh * 0.3, w * 0.5, '#efe6d4'); g.fill(); g.stroke();
    // merlons
    for (const s of [-0.28, 0, 0.28]) {
      rrect(g, x + s * w - w * 0.09, ky - h * 0.14, w * 0.18, h * 0.2, 1.2);
      g.fillStyle = '#f4efe2'; g.fill(); g.stroke();
    }
    // side towers
    for (const s of [-1, 1]) {
      const tx = x + s * w * 0.42, tw = w * 0.32, ty = foot - h * 0.95;
      rrect(g, tx - tw / 2, ty, tw, h * 0.95, 2); g.fillStyle = '#f4efe2'; g.fill(); g.stroke();
      // team-coloured conical roof
      g.beginPath(); g.moveTo(tx - tw * 0.68, ty + 1); g.lineTo(tx, ty - h * 0.28); g.lineTo(tx + tw * 0.68, ty + 1); g.closePath();
      g.fillStyle = glossy(g, tx, ty - h * 0.1, tw, teamCol); g.fill(); g.lineWidth = 1.6; g.stroke();
    }
    // door
    rrect(g, x - w * 0.13, foot - h * 0.42, w * 0.26, h * 0.42, 6);
    g.fillStyle = glossy(g, x, foot - h * 0.2, w * 0.2, '#7a4a22'); g.fill(); g.stroke();
    circ(g, x + w * 0.06, foot - h * 0.2, 1.15, '#ffd23a', 0.7);
    // centre flag
    g.strokeStyle = OUT; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, ky - h * 0.14); g.lineTo(x, ky - h * 0.52); g.stroke();
    g.beginPath(); g.moveTo(x, ky - h * 0.52); g.lineTo(x + w * 0.28, ky - h * 0.4); g.lineTo(x, ky - h * 0.28); g.closePath();
    g.fillStyle = teamCol; g.fill(); g.lineWidth = 1.2; g.stroke();
  };
  // per-frame lives plaque on the castle (lives change often, so this is not baked into the static board)
  A.drawCastleLives = function (g, x, y, cell, lives, leak) {
    // nameplate just under the door so the castle itself stays visible
    const py = y + cell * 0.58, pw = cell * 1.22, ph = cell * 0.44, rad = Math.min(8, ph * 0.45);
    g.save();
    rrect(g, x - pw / 2, py - ph / 2, pw, ph, rad);
    g.fillStyle = leak ? '#ffd0c8' : '#fff8e6'; g.fill();
    g.lineWidth = 2; g.strokeStyle = leak ? '#c81e3a' : OUT; g.stroke();
    const hs = A.heart(), hw = cell * 0.34, hh = hw * (hs.h / hs.w);
    g.drawImage(hs.c, x - pw * 0.42 - hw / 2, py - hh / 2, hw, hh);
    g.font = `700 ${Math.max(11, Math.round(cell * 0.38))}px Fredoka, 'Baloo 2', system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = leak ? '#c81e3a' : OUT;
    g.fillText(String(lives), x + pw * 0.14, py + 0.5);
    g.restore();
  };
  A.drawFrame = function (g, x, y, w, h) { // chunky wooden frame around a board
    g.save(); rrect(g, x - 8, y - 8, w + 16, h + 16, 16); g.fillStyle = '#7a4e24'; g.fill(); g.lineWidth = 3.2; g.strokeStyle = OUT; g.stroke();
    rrect(g, x - 4, y - 4, w + 8, h + 8, 11); g.fillStyle = '#c48645'; g.fill();
    // inner lip
    g.lineWidth = 2; g.strokeStyle = '#5a3414'; rrect(g, x - 1, y - 1, w + 2, h + 2, 8); g.stroke();
    g.restore();
  };
  A.OUT = OUT; A.BALLOON = BALLOON;
  // small data-URL icons for HTML buttons (optional zoom crops padding so sprites fill the button)
  A.iconURL = function (spr, size, zoom) {
    const c = document.createElement('canvas'); c.width = c.height = size * 2; const g = c.getContext('2d');
    const k = Math.min(size * 2 / spr.w, size * 2 / spr.h) * (zoom || 1);
    g.drawImage(spr.c, (size * 2 - spr.w * k) / 2, (size * 2 - spr.h * k) / 2, spr.w * k, spr.h * k);
    return c.toDataURL();
  };
  // game-over banner art (drawn once when the overlay opens)
  A.paintOver = function (g, w, h, kind) {
    g.clearRect(0, 0, w, h);
    g.save(); rrect(g, 2, 2, w - 4, h - 4, 16); g.clip();
    A.drawGrass(g, w, h, 28, kind === 'win' ? 3 : kind === 'lose' ? 9 : 6);
    const pts = []; for (let x = -16; x <= w + 16; x += 18) pts.push([x, h * 0.62 + Math.sin(x / 50) * 8]);
    A.drawPath(g, pts, 28);
    A.drawPortal(g, 36, h * 0.62, 28);
    A.drawCastle(g, w - 44, h * 0.62, 28, kind === 'lose' ? '#ff5d5d' : '#4fa3ff');
    const blobs = kind === 'win'
      ? [['neutral', 1, 8], ['runner', 3, 9], ['swarm', 2, 7], ['neutral', 4, 8], ['brute', 1, 10]]
      : kind === 'lose'
        ? [['boss', 0, 12], ['brute', 3, 11], ['swarm', 3, 7], ['runner', 3, 8]]
        : [['neutral', 2, 8], ['neutral', 5, 8], ['runner', 1, 8], ['swarm', 1, 7]];
    blobs.forEach((b, i) => {
      const [k, v, R] = b, x = 70 + i * ((w - 140) / Math.max(1, blobs.length - 1)), y = h * 0.58 + (i % 2 ? 6 : -4);
      const sp = A.creep(k, v, R), sh = A.shadow(R);
      g.drawImage(sh.c, x - sh.w / 2, y + R * 0.5 - sh.h / 2, sh.w, sh.h);
      g.drawImage(sp.c, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
    });
    const towers = kind === 'lose' ? [['cannon', 2, w * 0.3, 28], ['frost', 1, w * 0.7, 30]] : [['arrow', 2, w * 0.28, 26], ['cannon', 2, w * 0.5, 24], ['frost', 2, w * 0.72, 26]];
    for (const [t, l, x, y] of towers) { const pd = A.pad('#4fa3ff', l, 26), sp = A.tower(t, l); g.drawImage(pd.c, x - pd.w / 2, y - pd.h / 2 + 8, pd.w, pd.h); g.drawImage(sp.c, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h); }
    g.restore();
    rrect(g, 2, 2, w - 4, h - 4, 16); g.lineWidth = 3.5; g.strokeStyle = OUT; g.stroke();
  };
  root.ART = A;
})(typeof window !== 'undefined' ? window : this);
